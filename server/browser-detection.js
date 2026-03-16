import fsSync from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export function findSupportedBrowserExecutable() {
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
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env['PROGRAMFILES'] ? path.join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
    ]
    : process.platform === 'darwin'
      ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(process.env.HOME || '', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        path.join(process.env.HOME || '', 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        path.join(process.env.HOME || '', 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ]
      : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ];

  for (const candidate of candidates.filter(Boolean)) {
    if (fsSync.existsSync(candidate)) return candidate;
  }

  return findBrowserOnPath();
}

function findBrowserOnPath() {
  const commands = process.platform === 'win32'
    ? ['chrome', 'msedge', 'chromium']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

  for (const command of commands) {
    const resolved = resolveCommand(command);
    if (resolved) return resolved;
  }

  return null;
}

function resolveCommand(command) {
  const lookup = process.platform === 'win32'
    ? spawnSync('where.exe', [command], { encoding: 'utf8' })
    : spawnSync('which', [command], { encoding: 'utf8' });

  if (lookup.status !== 0) return null;

  const firstLine = lookup.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine && fsSync.existsSync(firstLine) ? firstLine : null;
}
