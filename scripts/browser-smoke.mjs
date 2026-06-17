import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = readArg('--url');
if (!url) {
  console.error('Usage: npm run browser:smoke -- --url http://127.0.0.1:5173');
  process.exit(2);
}

const outputDir = path.join(process.cwd(), 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'browser-smoke.png');
await fs.mkdir(outputDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (!response || response.status() >= 400) {
    throw new Error(`Unexpected page response: ${response?.status() || 'none'}`);
  }

  await page.locator('body').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.app-content-revealed').waitFor({ state: 'visible', timeout: 120_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (pageErrors.length) {
    throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
  }
  if (consoleErrors.length) {
    throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
  }

  console.log(`Browser smoke OK: ${url}`);
  console.log(`Screenshot: ${path.relative(process.cwd(), screenshotPath)}`);
} finally {
  await browser?.close().catch(() => {});
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}
