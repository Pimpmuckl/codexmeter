import fsSync from 'fs';
import path from 'path';

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
