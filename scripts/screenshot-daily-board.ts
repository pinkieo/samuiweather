/**
 * Capture /board/today at 1280×720.
 * Start Next first (`npm run dev`), then:
 *   BOARD_URL=http://127.0.0.1:3000/board/today?sample=1 npm run board:screenshot
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const url = process.env.BOARD_URL || 'http://127.0.0.1:3000/board/today?sample=1';
const out =
  process.env.BOARD_SCREENSHOT ||
  path.resolve('/opt/cursor/artifacts/daily-board-1280x720.png');

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    const box = await page.$eval('[data-daily-board]', (el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, x: rect.x, y: rect.y };
    });
    if (Math.round(box.width) !== 1280 || Math.round(box.height) !== 720) {
      throw new Error(`Board is ${box.width}×${box.height}, expected 1280×720`);
    }
    const credit = await page.$eval('[data-daily-board]', (el) => {
      const board = el.getBoundingClientRect();
      const node = el.querySelector('[data-board-credit]');
      if (!node) return 'missing credit';
      const rect = node.getBoundingClientRect();
      if (rect.bottom > board.bottom + 1 || rect.top < board.top) {
        return `credit clipped (${Math.round(rect.top)}–${Math.round(rect.bottom)} vs board ${Math.round(board.bottom)})`;
      }
      const text = node.textContent || '';
      if (!text.includes('Not live radar')) return 'credit text incomplete';
      return 'ok';
    });
    if (credit !== 'ok') throw new Error(credit);
    await mkdir(path.dirname(out), { recursive: true });
    await page.screenshot({
      path: out,
      type: 'png',
      clip: { x: box.x, y: box.y, width: 1280, height: 720 },
    });
    console.log(`Wrote ${out} from ${url} (${box.width}×${box.height})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
