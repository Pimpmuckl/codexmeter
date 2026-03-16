import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobSummary } from '../server/export-video.js';

test('job summary exposes expiry metadata for completed exports', () => {
  const cleanupAtMs = Date.UTC(2026, 2, 16, 12, 0, 0);
  const summary = createJobSummary({
    id: 'job-1',
    type: 'overview-video',
    status: 'complete',
    phase: 'complete',
    progress: 1,
    created_at: '2026-03-16T11:50:00.000Z',
    updated_at: '2026-03-16T11:51:00.000Z',
    replay_ingest_id: 'ingest-1',
    file_name: 'codexmeter-overview.mp4',
    cleanup_at_ms: cleanupAtMs,
    error: null,
  });

  assert.equal(summary.download_url, '/api/export/job-1/file');
  assert.equal(summary.expires_at, new Date(cleanupAtMs).toISOString());
});
