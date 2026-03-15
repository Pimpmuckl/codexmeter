import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { OVERVIEW_INGEST_ANIMATION } from '../src/utils/animationsDefault.js';

const EXPORT_WIDTH = OVERVIEW_INGEST_ANIMATION.videoExport?.width ?? 1080;
const EXPORT_HEIGHT = OVERVIEW_INGEST_ANIMATION.videoExport?.height ?? 864;
const EXPORT_FPS = OVERVIEW_INGEST_ANIMATION.videoExport?.fps ?? 60;
const EXPORT_START_HOLD_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.startHoldDurationMs ?? 500;
const EXPORT_REPLAY_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.replayDurationMs ?? 8000;
const EXPORT_TAIL_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.tailDurationMs ?? 5000;
const EXPORT_FINAL_HOLD_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.finalHoldDurationMs ?? 3500;
const EXPORT_TOTAL_DURATION_MS =
  EXPORT_START_HOLD_DURATION_MS + EXPORT_REPLAY_DURATION_MS + EXPORT_TAIL_DURATION_MS + EXPORT_FINAL_HOLD_DURATION_MS;
const EXPORT_TAIL_SOURCE_FRACTION = OVERVIEW_INGEST_ANIMATION.videoExport?.tailSourceFraction ?? 0.035;
const EXPORT_CRF = OVERVIEW_INGEST_ANIMATION.videoExport?.crf ?? 20;
const EXPORT_ENCODER_PRESET = OVERVIEW_INGEST_ANIMATION.videoExport?.encoderPreset ?? 'fast';

export function createExportManager({ getReplay, getSettledEnvelope, getBaseUrl }) {
  const jobs = new Map();

  return {
    async startOverviewVideoJob(clientBaseUrl) {
      const replay = getReplay();
      const settledEnvelope = getSettledEnvelope ? getSettledEnvelope() : null;
      if (!replay?.bootstrap) {
        const err = new Error('No completed ingest replay is available yet.');
        err.statusCode = 409;
        throw err;
      }

      const jobId = randomUUID();
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmeter-video-'));
      const framesDir = path.join(tempDir, 'frames');
      const outputPath = path.join(tempDir, 'codexmeter-overview.mp4');
      await fs.mkdir(framesDir, { recursive: true });

      const job = {
        id: jobId,
        type: 'overview-video',
        status: 'queued',
        phase: 'preparing',
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        replay_ingest_id: replay.ingest_id,
        replay,
        settled_envelope: settledEnvelope,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        fps: EXPORT_FPS,
        start_hold_duration_ms: EXPORT_START_HOLD_DURATION_MS,
        replay_duration_ms: EXPORT_REPLAY_DURATION_MS,
        tail_duration_ms: EXPORT_TAIL_DURATION_MS,
        final_hold_duration_ms: EXPORT_FINAL_HOLD_DURATION_MS,
        tail_source_fraction: EXPORT_TAIL_SOURCE_FRACTION,
        duration_ms: EXPORT_TOTAL_DURATION_MS,
        capture_format: OVERVIEW_INGEST_ANIMATION.videoExport?.captureFormat ?? 'png',
        jpeg_quality: OVERVIEW_INGEST_ANIMATION.videoExport?.jpegQuality ?? 92,
        crf: EXPORT_CRF,
        encoder_preset: EXPORT_ENCODER_PRESET,
        temp_dir: tempDir,
        frames_dir: framesDir,
        output_path: outputPath,
        file_name: `codexmeter-overview-${jobId.slice(0, 8)}.mp4`,
        client_base_url: clientBaseUrl || null,
        error: null,
      };

      jobs.set(jobId, job);
      void runOverviewVideoJob(job, replay, getBaseUrl);
      return sanitizeJob(job);
    },

    getJob(jobId) {
      return jobs.get(jobId) || null;
    },

    listJobs() {
      return [...jobs.values()];
    },

    getRenderPayload(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      return {
        jobId: job.id,
        width: job.width,
        height: job.height,
        fps: job.fps,
        durationMs: job.duration_ms,
        startHoldDurationMs: job.start_hold_duration_ms,
        replayDurationMs: job.replay_duration_ms,
        replayEasing: OVERVIEW_INGEST_ANIMATION.videoExport?.replayEasing ?? 'cubicInOut',
        tailDurationMs: job.tail_duration_ms,
        tailSourceFraction: job.tail_source_fraction,
        tailEasing: OVERVIEW_INGEST_ANIMATION.videoExport?.tailEasing ?? 'cubicInOut',
        finalHoldDurationMs: job.final_hold_duration_ms,
        replay: job.replay,
        settledEnvelope: job.settled_envelope,
      };
    },

    sanitizeJob,
  };

  function sanitizeJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      created_at: job.created_at,
      updated_at: job.updated_at,
      replay_ingest_id: job.replay_ingest_id,
      file_name: job.file_name,
      download_url: job.status === 'complete' ? `/api/export/${job.id}/file` : null,
      error: job.error,
    };
  }

  async function runOverviewVideoJob(job, replay, getBaseUrlFn) {
    try {
      updateJob(job, 'rendering', 0.02, 'running');

      const baseUrl = await getBaseUrlFn(job.client_base_url);
      const browserPath = await detectBrowserExecutable();
      const browser = await chromium.launch({
        headless: true,
        executablePath: browserPath,
        args: [
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-frame-rate-limit',
          `--window-size=${job.width},${job.height}`,
        ],
      });
      let capturedFrameCount = 0;

      try {
        const context = await browser.newContext({
          viewport: { width: job.width, height: job.height },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        let frameIndex = 0;
        let captureError = null;
        let frameWriteChain = Promise.resolve();
        const frameExt = job.capture_format === 'jpeg' ? 'jpg' : 'png';
        const targetFrameIntervalMs = 1000 / Math.max(job.fps || 60, 1);
        let firstFrameTimestampMs = null;
        let nextFrameBucketMs = 0;
        cdp.on('Page.screencastFrame', (event) => {
          frameWriteChain = frameWriteChain.then(async () => {
            const screencastTimestampMs = Number.isFinite(event?.metadata?.timestamp)
              ? event.metadata.timestamp * 1000
              : Date.now();
            if (firstFrameTimestampMs == null) {
              firstFrameTimestampMs = screencastTimestampMs;
              nextFrameBucketMs = 0;
            }
            const relativeTimestampMs = Math.max(0, screencastTimestampMs - firstFrameTimestampMs);
            const shouldWrite = relativeTimestampMs + 0.5 >= nextFrameBucketMs;
            if (shouldWrite) {
              const framePath = path.join(job.frames_dir, `${String(frameIndex).padStart(5, '0')}.${frameExt}`);
              frameIndex += 1;
              await fs.writeFile(framePath, Buffer.from(event.data, 'base64'));
              while (nextFrameBucketMs <= relativeTimestampMs + 0.5) {
                nextFrameBucketMs += targetFrameIntervalMs;
              }
            }
            await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
          }).catch((err) => {
            captureError = err;
          });
        });

        const exportUrl = `${baseUrl}/?export=overview-video&job=${encodeURIComponent(job.id)}`;
        await page.goto(exportUrl, { waitUntil: 'networkidle' });
        await page.waitForFunction(
          (expectedJobId) => window.__CODEXMETER_EXPORT__?.ready === true && window.__CODEXMETER_EXPORT__?.jobId === expectedJobId,
          job.id,
          { timeout: 30000 }
        );
        await cdp.send('Page.startScreencast', {
          format: job.capture_format === 'jpeg' ? 'jpeg' : 'png',
          quality: job.capture_format === 'jpeg' ? job.jpeg_quality : undefined,
          everyNthFrame: 1,
        });
        await page.evaluate(() => window.__CODEXMETER_EXPORT__?.start());
        const startedAt = Date.now();
        while (true) {
          await page.waitForTimeout(200);
          if (captureError) throw captureError;
          const playback = await page.evaluate(() => ({
            currentTimeMs: window.__CODEXMETER_EXPORT__?.currentTimeMs || 0,
            finished: window.__CODEXMETER_EXPORT__?.finished === true,
          }));
          const ratio = Math.min(1, Math.max(0, (playback.currentTimeMs || 0) / Math.max(job.duration_ms, 1)));
          updateJob(job, 'rendering', 0.05 + ratio * 0.8, 'running');
          if (playback.finished) break;
          if (Date.now() - startedAt > Math.max(30000, job.duration_ms * 4)) {
            throw new Error('Export playback timed out before completion');
          }
        }
        await page.waitForTimeout(250);
        await cdp.send('Page.stopScreencast');
        await frameWriteChain;
        if (frameIndex < 2) {
          throw new Error('Screencast capture produced too few frames');
        }
        capturedFrameCount = frameIndex;
        await context.close();
      } finally {
        await browser.close();
      }

      updateJob(job, 'encoding', 0.9, 'running');
      await encodeFramesToMp4(job.frames_dir, job.output_path, {
        captureFormat: job.capture_format,
        fps: job.fps,
        frameCount: capturedFrameCount,
        durationMs: job.duration_ms,
        crf: job.crf,
        encoderPreset: job.encoder_preset,
      });
      updateJob(job, 'complete', 1, 'complete');
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      updateJob(job, 'failed', job.progress || 0, 'failed');
    }
  }
}

export function createVideoExportManager() {
  let replayGetter = () => null;
  let settledEnvelopeGetter = () => null;
  let baseUrlResolver = async (clientBaseUrl) => clientBaseUrl || null;
  const manager = createExportManager({
    getReplay: () => replayGetter(),
    getSettledEnvelope: () => settledEnvelopeGetter(),
    getBaseUrl: (clientBaseUrl) => baseUrlResolver(clientBaseUrl),
  });
  manager.setReplayGetter = (fn) => {
    replayGetter = fn;
  };
  manager.setSettledEnvelopeGetter = (fn) => {
    settledEnvelopeGetter = fn;
  };
  manager.setBaseUrlResolver = (fn) => {
    baseUrlResolver = fn;
  };
  return manager;
}

export function startOverviewVideoExport(manager, { replay, settledEnvelope, appBaseUrl }) {
  manager.setReplayGetter(() => replay);
  manager.setSettledEnvelopeGetter(() => settledEnvelope);
  manager.setBaseUrlResolver(async (clientBaseUrl) => clientBaseUrl || appBaseUrl);
  return manager.startOverviewVideoJob(appBaseUrl);
}

export function getVideoExportJob(manager, jobId) {
  return manager.getJob(jobId);
}

export function getActiveVideoExportJob(manager) {
  const jobs = manager.listJobs ? manager.listJobs() : [];
  return jobs
    .filter((job) => job.status === 'queued' || job.status === 'running')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
}

export function createJobSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    created_at: job.created_at,
    updated_at: job.updated_at,
    replay_ingest_id: job.replay_ingest_id,
    file_name: job.file_name,
    download_url: job.status === 'complete' ? `/api/export/${job.id}/file` : null,
    error: job.error || null,
  };
}

function updateJob(job, phase, progress, status) {
  job.phase = phase;
  job.progress = Math.max(0, Math.min(progress, 1));
  job.status = status;
  job.updated_at = new Date().toISOString();
}

async function detectBrowserExecutable() {
  if (process.env.CODEXMETER_EXPORT_BROWSER && fsSync.existsSync(process.env.CODEXMETER_EXPORT_BROWSER)) {
    return process.env.CODEXMETER_EXPORT_BROWSER;
  }

  const candidates = process.platform === 'win32'
    ? [
      process.env['PROGRAMFILES'] ? path.join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env['PROGRAMFILES'] ? path.join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
    ]
    : process.platform === 'darwin'
      ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
      : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
      ];

  for (const candidate of candidates.filter(Boolean)) {
    if (fsSync.existsSync(candidate)) return candidate;
  }

  const err = new Error('No supported Chrome/Chromium/Edge executable was found for video export.');
  err.statusCode = 500;
  throw err;
}

async function encodeFramesToMp4(framesDir, outputPath, { captureFormat, fps, frameCount, durationMs, crf, encoderPreset }) {
  const extension = captureFormat === 'jpeg' ? 'jpg' : 'png';
  const inputPattern = path.join(framesDir, `%05d.${extension}`);
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is unavailable');
  }
  const effectiveInputFps = frameCount > 0 && durationMs > 0
    ? Math.max(1, frameCount / (durationMs / 1000))
    : fps;
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-framerate', String(effectiveInputFps),
      '-i', inputPattern,
      '-c:v', 'libx264',
      '-tune', 'animation',
      '-preset', String(encoderPreset || 'fast'),
      '-crf', String(crf ?? 20),
      '-profile:v', 'high',
      '-r', String(fps),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}
