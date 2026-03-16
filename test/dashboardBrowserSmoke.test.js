import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { chromium } from 'playwright-core';
import { findSupportedBrowserExecutable } from '../server/browser-detection.js';
import { createTempSmokeCodexHome, spawnCodexmeter, terminateProcessTree, waitForCodexmeterUrl } from '../scripts/ci/smoke-runtime.js';

test('dashboard tabs render and basic interactions survive in a real browser', async (t) => {
  const browserPath = findSupportedBrowserExecutable();
  if (!browserPath) {
    if (process.env.CI) {
      assert.fail('No supported browser executable was found for dashboard smoke in CI.');
    }
    t.skip('No supported browser executable was found for dashboard smoke.');
    return;
  }

  const fixture = await createTempSmokeCodexHome('codexmeter-browser-');
  const proc = spawnCodexmeter({ codexHome: fixture.codexHome, cwd: process.cwd() });
  let browser = null;

  try {
    const url = await waitForCodexmeterUrl(proc);
    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(url, { waitUntil: 'networkidle' });

    await page.getByText('Top Repos', { exact: true }).waitFor();
    await page.getByText('Work Type', { exact: true }).waitFor();
    await page.locator('.chart-title').filter({ hasText: 'Models' }).waitFor();

    await page.getByRole('button', { name: 'Daily' }).click();
    await page.getByText('Daily Usage', { exact: true }).waitFor();
    await page.getByRole('button', { name: '7d' }).click();
    await page.getByText('Daily Usage', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Repos' }).click();
    await page.getByRole('cell', { name: /nextide-web|nextide-api|codexmeter/ }).first().click();
    await page.getByText('Models in repo', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Models' }).click();
    await page.locator('tbody tr').first().click();
    await page.getByText('Sessions by effort', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByPlaceholder('Search sessions...').waitFor();
    const scroller = page.locator('div').filter({ has: page.locator('table') }).nth(1);
    await scroller.evaluate((node) => { node.scrollTop = 400; });
    await page.getByText('root sessions').waitFor();
    const rows = await page.locator('tbody tr').count();
    assert.ok(rows > 0);
  } finally {
    await browser?.close().catch(() => {});
    await terminateProcessTree(proc);
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
