import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import Overview from './Overview';
import { api } from '../api';
import { buildLiveDataEnvelope, mergeLiveEvent } from '../live-state';

export default function OverviewVideoExport({ jobId }) {
  const [renderData, setRenderData] = useState(null);
  const [error, setError] = useState(null);
  const [seekMs, setSeekMs] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(api.url(`/api/export/${encodeURIComponent(jobId)}/render-data`));
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const payload = await res.json();
        if (!alive) return;
        setRenderData(payload);
      } catch (nextError) {
        if (!alive) return;
        setError(nextError.message || String(nextError));
      }
    })();

    return () => {
      alive = false;
    };
  }, [jobId]);

  const frameState = useMemo(() => {
    if (!renderData?.replay?.bootstrap?.payload) {
      return { liveData: null, progress: null };
    }

    let progress = renderData.replay.bootstrap.payload.progress || null;
    let liveState = mergeLiveEvent(null, renderData.replay.bootstrap.payload, 'bootstrap');

    for (const event of renderData.replay.events || []) {
      if ((event.at_ms || 0) > seekMs) break;
      progress = event.payload?.progress || progress;
      if (event.event === 'patch') {
        liveState = mergeLiveEvent(liveState, event.payload, 'patch');
      }
    }

    return {
      liveData: buildLiveDataEnvelope(liveState),
      progress,
    };
  }, [renderData, seekMs]);

  useEffect(() => {
    window.__CODEXMETER_EXPORT__ = {
      ready: Boolean(renderData && !error),
      jobId,
      seek(ms) {
        flushSync(() => {
          setSeekMs(Math.max(0, Number(ms) || 0));
        });
      },
    };

    return () => {
      delete window.__CODEXMETER_EXPORT__;
    };
  }, [error, jobId, renderData]);

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={statusStyle}>Export error: {error}</div>
      </div>
    );
  }

  if (!frameState.liveData) {
    return (
      <div style={containerStyle}>
        <div style={statusStyle}>Preparing export…</div>
      </div>
    );
  }

  const progress = frameState.progress;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <Overview
          data={frameState.liveData.overview}
          heatmap={frameState.liveData.heatmap}
          daily={frameState.liveData.daily}
          families={frameState.liveData.families}
          repos={frameState.liveData.repos}
          models={frameState.liveData.models}
          range="total"
          ingestProgress={Math.min(Math.max(progress?.percent || 0, 0), 1)}
          isIngestActive={Boolean(progress && !progress.complete)}
        />
      </div>
    </div>
  );
}

const containerStyle = {
  width: '100vw',
  minHeight: '100vh',
  background: '#06080f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const frameStyle = {
  width: 1080,
  height: 864,
  padding: '24px 28px 20px',
  background: '#06080f',
  overflow: 'hidden',
};

const statusStyle = {
  color: '#8b949e',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 18,
};
