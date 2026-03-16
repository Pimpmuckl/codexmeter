import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import process from 'process';
import { createRequire } from 'module';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { OVERVIEW_INGEST_ANIMATION } from '../src/utils/animationsDefault.js';

const EXPORT_WIDTH = OVERVIEW_INGEST_ANIMATION.videoExport?.width ?? 1080;
const EXPORT_HEIGHT = OVERVIEW_INGEST_ANIMATION.videoExport?.height ?? 864;
const EXPORT_FPS = OVERVIEW_INGEST_ANIMATION.videoExport?.fps ?? 60;
const EXPORT_SUPERSAMPLE_SCALE = Math.max(1, Number(OVERVIEW_INGEST_ANIMATION.videoExport?.supersampleScale ?? 1) || 1);
const EXPORT_FRONTLOAD_SETTLED_FRAME_COUNT = Math.max(0, Math.round(OVERVIEW_INGEST_ANIMATION.videoExport?.frontloadSettledFrameCount ?? 1));
const EXPORT_FRONTLOAD_SETTLED_DURATION_MS = EXPORT_FRONTLOAD_SETTLED_FRAME_COUNT > 0
  ? Math.max(1, Math.round((EXPORT_FRONTLOAD_SETTLED_FRAME_COUNT * 1000) / Math.max(EXPORT_FPS, 1)))
  : 0;
const EXPORT_START_HOLD_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.startHoldDurationMs ?? 500;
const EXPORT_REPLAY_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.replayDurationMs ?? 8000;
const EXPORT_TAIL_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.tailDurationMs ?? 5000;
const EXPORT_FINAL_HOLD_DURATION_MS = OVERVIEW_INGEST_ANIMATION.videoExport?.finalHoldDurationMs ?? 3500;
const EXPORT_TOTAL_DURATION_MS =
  EXPORT_FRONTLOAD_SETTLED_DURATION_MS + EXPORT_START_HOLD_DURATION_MS + EXPORT_REPLAY_DURATION_MS + EXPORT_TAIL_DURATION_MS + EXPORT_FINAL_HOLD_DURATION_MS;
const EXPORT_TAIL_SOURCE_FRACTION = OVERVIEW_INGEST_ANIMATION.videoExport?.tailSourceFraction ?? 0.035;
const EXPORT_CRF = OVERVIEW_INGEST_ANIMATION.videoExport?.crf ?? 20;
const EXPORT_ENCODER_PRESET = OVERVIEW_INGEST_ANIMATION.videoExport?.encoderPreset ?? 'fast';
let portableBrowserSupportCache = null;
const require = createRequire(import.meta.url);

export function createExportManager({ getReplay, getSettledEnvelope, getBaseUrl }) {
  const jobs = new Map();

  return {
    async startOverviewVideoJob(clientBaseUrl, opts = {}) {
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

      const initialBrowserPath = findSupportedBrowserExecutable();
      const willDownloadPortableBrowser = Boolean(opts.installPortableBrowser) && !initialBrowserPath;
      const job = {
        id: jobId,
        type: 'overview-video',
        status: willDownloadPortableBrowser ? 'running' : 'queued',
        phase: willDownloadPortableBrowser ? 'downloading_browser' : 'preparing',
        progress: willDownloadPortableBrowser ? 0.03 : 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        replay_ingest_id: replay.ingest_id,
        replay,
        settled_envelope: settledEnvelope,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        fps: EXPORT_FPS,
        supersample_scale: EXPORT_SUPERSAMPLE_SCALE,
        frontload_settled_frame_count: EXPORT_FRONTLOAD_SETTLED_FRAME_COUNT,
        frontload_settled_duration_ms: EXPORT_FRONTLOAD_SETTLED_DURATION_MS,
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
        install_portable_browser: Boolean(opts.installPortableBrowser),
        portable_browser_dir: null,
        portable_browser_executable: null,
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
        supersampleScale: job.supersample_scale,
        frontloadSettledFrameCount: job.frontload_settled_frame_count,
        frontloadSettledDurationMs: job.frontload_settled_duration_ms,
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
    let portableBrowserDir = null;
    try {
      const baseUrl = await getBaseUrlFn(job.client_base_url);
      let browserPath = findSupportedBrowserExecutable();
      if (!browserPath && job.install_portable_browser) {
        updateJob(job, 'downloading_browser', 0.03, 'running');
        const portableBrowser = await installSingleUsePortableBrowser(job.temp_dir, (percent) => {
          updateJob(job, 'downloading_browser', 0.03 + (Math.max(0, Math.min(percent, 100)) / 100) * 0.22, 'running');
        });
        portableBrowserDir = portableBrowser.dir;
        job.portable_browser_dir = portableBrowser.dir;
        job.portable_browser_executable = portableBrowser.executablePath;
        browserPath = portableBrowser.executablePath;
      }
      if (!browserPath) {
        await detectBrowserExecutable();
      }
      updateJob(job, 'rendering', Math.max(job.progress || 0, 0.24), 'running');
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
          deviceScaleFactor: job.supersample_scale || 1,
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        let frameIndex = 0;
        let captureError = null;
        let frameWriteChain = Promise.resolve();
        const captureTrace = [];
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
              captureTrace.push({
                frameIndex,
                relativeTimestampMs: Math.round(relativeTimestampMs),
                bucketMs: Math.round(nextFrameBucketMs),
                screencastTimestampMs: Math.round(screencastTimestampMs),
              });
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
        await page.evaluate(async () => {
          if (document.fonts?.ready) {
            try {
              await document.fonts.ready;
            } catch {}
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
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
        const exportDebug = await page.evaluate(() => ({
          debugState: window.__CODEXMETER_EXPORT__?.getDebugState?.() || null,
          debugTrace: window.__CODEXMETER_EXPORT__?.getDebugTrace?.() || [],
        }));
        const debugAnalysis = analyzeExportTrace(exportDebug?.debugTrace || [], captureTrace);
        await fs.writeFile(
          path.join(job.temp_dir, 'capture-trace.json'),
          JSON.stringify(captureTrace, null, 2),
          'utf8'
        );
        await fs.writeFile(
          path.join(job.temp_dir, 'simulation-trace.json'),
          JSON.stringify(exportDebug, null, 2),
          'utf8'
        );
        await fs.writeFile(
          path.join(job.temp_dir, 'analysis-trace.json'),
          JSON.stringify(debugAnalysis, null, 2),
          'utf8'
        );
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
        outputWidth: job.width,
        outputHeight: job.height,
      });
      updateJob(job, 'complete', 1, 'complete');
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      updateJob(job, 'failed', job.progress || 0, 'failed');
    } finally {
      if (portableBrowserDir) {
        try {
          await fs.rm(portableBrowserDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

function analyzeExportTrace(debugTrace, captureTrace) {
  const phaseTransitions = [];
  const stalls = [];
  const snaps = [];
  let longestNearFlatMs = 0;
  let currentFlatStart = null;

  for (let i = 1; i < debugTrace.length; i += 1) {
    const prev = debugTrace[i - 1];
    const curr = debugTrace[i];
    if (curr.phase !== prev.phase) {
      phaseTransitions.push({
        atMs: curr.seekMs,
        from: prev.phase,
        to: curr.phase,
      });
    }

    const dt = Math.max(1, curr.seekMs - prev.seekMs);
    const delta = computeSignatureDelta(prev.signature, curr.signature);
    const deltaPerMs = delta / dt;

    if (deltaPerMs < 0.005) {
      if (currentFlatStart == null) currentFlatStart = prev.seekMs;
    } else if (currentFlatStart != null) {
      const durationMs = prev.seekMs - currentFlatStart;
      if (durationMs >= 180) {
        stalls.push({
          startMs: currentFlatStart,
          endMs: prev.seekMs,
          durationMs,
          phase: prev.phase,
        });
      }
      longestNearFlatMs = Math.max(longestNearFlatMs, durationMs);
      currentFlatStart = null;
    }

    if (deltaPerMs > 1.2) {
      snaps.push({
        atMs: curr.seekMs,
        phase: curr.phase,
        delta,
        deltaPerMs: Number(deltaPerMs.toFixed(4)),
        signature: curr.signature,
      });
    }
  }

  if (currentFlatStart != null && debugTrace.length) {
    const last = debugTrace[debugTrace.length - 1];
    const durationMs = last.seekMs - currentFlatStart;
    if (durationMs >= 180) {
      stalls.push({
        startMs: currentFlatStart,
        endMs: last.seekMs,
        durationMs,
        phase: last.phase,
      });
    }
    longestNearFlatMs = Math.max(longestNearFlatMs, durationMs);
  }

  return {
    frameCount: debugTrace.length,
    captureFrameCount: captureTrace.length,
    phaseTransitions,
    longestNearFlatMs,
    stallCount: stalls.length,
    snapCount: snaps.length,
    topStalls: stalls.sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
    topSnaps: snaps.sort((a, b) => b.deltaPerMs - a.deltaPerMs).slice(0, 8),
  };
}

function computeSignatureDelta(prev = {}, curr = {}) {
  const weights = {
    totalTokens: 1 / 1000000,
    totalCost: 25,
    totalSessions: 0.5,
    dailyPoints: 1,
    lastDailyTotal: 1 / 1000000,
    topRepoValue: 1 / 1000000,
    topModelValue: 1 / 1000000,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const left = Number.isFinite(prev[key]) ? prev[key] : 0;
    const right = Number.isFinite(curr[key]) ? curr[key] : 0;
    total += Math.abs(right - left) * weight;
  }
  if ((prev.topRepo || null) !== (curr.topRepo || null)) total += 4;
  if ((prev.topModel || null) !== (curr.topModel || null)) total += 4;
  if ((prev.lastDailyDate || null) !== (curr.lastDailyDate || null)) total += 2;
  return total;
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

export function startOverviewVideoExport(manager, { replay, settledEnvelope, appBaseUrl, installPortableBrowser = false }) {
  manager.setReplayGetter(() => replay);
  manager.setSettledEnvelopeGetter(() => settledEnvelope);
  manager.setBaseUrlResolver(async (clientBaseUrl) => clientBaseUrl || appBaseUrl);
  return manager.startOverviewVideoJob(appBaseUrl, { installPortableBrowser });
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

export async function getVideoExportSupport() {
  const browserPath = findSupportedBrowserExecutable();
  if (browserPath) {
    return {
      available: true,
      browser_path: browserPath,
      reason: null,
      portable_download: null,
    };
  }
  const portableDownload = await getPortableBrowserSupport();
  return {
    available: false,
    browser_path: null,
    reason: 'No supported Chrome/Chromium/Edge browser was found for video export.',
    portable_download: portableDownload,
  };
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
  const browserPath = findSupportedBrowserExecutable();
  if (browserPath) return browserPath;

  const err = new Error('No supported Chrome/Chromium/Edge executable was found for video export.');
  err.statusCode = 500;
  throw err;
}

async function getPortableBrowserSupport() {
  if (process.env.CODEXMETER_EXPORT_DEBUG_DISABLE_PORTABLE === '1') {
    return {
      available: false,
      label: null,
      approx_size_mb: null,
      reason: 'Portable browser download disabled by debug flag.',
      platform_id: getPortableBrowserPlatformId(),
    };
  }
  if (portableBrowserSupportCache) return portableBrowserSupportCache;
  const platformId = getPortableBrowserPlatformId();
  if (!platformId) {
    portableBrowserSupportCache = {
      available: false,
      label: null,
      approx_size_mb: null,
      reason: `Portable browser download is not supported on ${process.platform}/${process.arch}.`,
      platform_id: null,
    };
    return portableBrowserSupportCache;
  }

  try {
    const spec = await resolvePortableBrowserSpec();
    portableBrowserSupportCache = {
      available: true,
      label: spec.label,
      approx_size_mb: spec.approxSizeMb,
      reason: null,
      platform_id: spec.platformId,
    };
    return portableBrowserSupportCache;
  } catch (err) {
    portableBrowserSupportCache = {
      available: false,
      label: null,
      approx_size_mb: null,
      reason: err instanceof Error ? err.message : String(err),
      platform_id: platformId,
    };
    return portableBrowserSupportCache;
  }
}

async function resolvePortableBrowserSpec() {
  const platformId = getPortableBrowserPlatformId();
  if (!platformId) {
    throw new Error(`Portable browser download is not supported on ${process.platform}/${process.arch}.`);
  }
  const probeRoot = path.join(os.tmpdir(), 'codexmeter-playwright-probe');
  const cliPath = resolvePlaywrightCliPath();
  const dryRun = await runNodeCommand(cliPath, ['install', 'chromium-headless-shell', '--dry-run'], {
    PLAYWRIGHT_BROWSERS_PATH: probeRoot,
  });
  const output = `${dryRun.stdout}\n${dryRun.stderr}`;
  const urls = [...output.matchAll(/Download url:\s+(\S+)/g)].map((match) => match[1]).filter(Boolean);
  if (!urls.length) {
    throw new Error('Could not resolve portable Chromium download URL.');
  }
  const approxSizeMb = await fetchCombinedContentLengthMb(urls);
  return {
    browser: 'chromium-headless-shell',
    label: 'Portable Chromium',
    platformId,
    downloadUrls: urls,
    approxSizeMb,
  };
}

async function installSingleUsePortableBrowser(jobTempDir, onProgress = null) {
  const browserRoot = path.join(jobTempDir, 'portable-browser');
  const cliPath = resolvePlaywrightCliPath();
  await fs.mkdir(browserRoot, { recursive: true });
  await runNodeCommand(cliPath, ['install', 'chromium-headless-shell'], {
    PLAYWRIGHT_BROWSERS_PATH: browserRoot,
  }, onProgress);
  const executablePath = await findPortableBrowserExecutable(browserRoot);
  if (!executablePath) {
    throw new Error('Portable Chromium was downloaded but no executable was found.');
  }
  return { dir: browserRoot, executablePath };
}

function getPortableBrowserPlatformId() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'mac-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux64';
  return null;
}

async function fetchCombinedContentLengthMb(urls) {
  try {
    let totalBytes = 0;
    for (const url of urls) {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      const length = Number(res.headers.get('content-length') || 0);
      if (!Number.isFinite(length) || length <= 0) return null;
      totalBytes += length;
    }
    return Math.max(1, Math.round(totalBytes / (1024 * 1024)));
  } catch {
    return null;
  }
}

async function runNodeCommand(scriptPath, args, extraEnv = {}, onProgress = null) {
  return await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const handleChunk = (chunk) => {
      const text = chunk.toString();
      const matches = [...text.matchAll(/(\d{1,3})%/g)];
      if (onProgress && matches.length) {
        const lastMatch = matches[matches.length - 1];
        const percent = Math.max(0, Math.min(100, Number(lastMatch[1]) || 0));
        onProgress(percent);
      }
      return text;
    };
    proc.stdout.on('data', (chunk) => {
      stdout += handleChunk(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += handleChunk(chunk);
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Node command exited with code ${code}`));
    });
  });
}

async function findPortableBrowserExecutable(rootDir) {
  const executableNames = process.platform === 'win32'
    ? ['chrome-headless-shell.exe', 'chrome.exe']
    : ['chrome-headless-shell', 'Chromium', 'Google Chrome for Testing', 'chrome'];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (executableNames.includes(entry.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function resolvePlaywrightCliPath() {
  const packageJsonPath = require.resolve('playwright-core/package.json');
  const packageRoot = path.dirname(packageJsonPath);
  return path.join(packageRoot, 'cli.js');
}

function findSupportedBrowserExecutable() {
  if (process.env.CODEXMETER_EXPORT_DEBUG_FORCE_UNSUPPORTED === '1') {
    return null;
  }
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
  return null;
}

async function encodeFramesToMp4(framesDir, outputPath, { captureFormat, fps, frameCount, durationMs, crf, encoderPreset, outputWidth, outputHeight }) {
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
      '-vf', `scale=${Math.max(1, outputWidth || EXPORT_WIDTH)}:${Math.max(1, outputHeight || EXPORT_HEIGHT)}:flags=lanczos`,
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
