/**
 * Click /board/today into fullscreen, then leave with a second click and Escape.
 * The 1280×720 board and the 300px presenter gutter stay the layout size.
 *
 *   BOARD_URL=http://127.0.0.1:3000/board/today?sample=1 npx tsx scripts/check-board-fullscreen.ts
 */

import puppeteer from 'puppeteer-core';

const url = process.env.BOARD_URL || 'http://127.0.0.1:3000/board/today?sample=1';

async function layout(page: import('puppeteer-core').Page) {
  return page.evaluate(() => {
    const board = document.querySelector('[data-daily-board]');
    const gutter = document.querySelector('[data-presenter-slot]');
    const hint = document.querySelector('[data-board-fullscreen-hint]');
    const host = document.querySelector('[data-board-fullscreen]');
    if (!(board instanceof HTMLElement) || !(gutter instanceof HTMLElement)) {
      return { error: 'missing board' };
    }
    const boardBox = board.getBoundingClientRect();
    return {
      mode: host?.getAttribute('data-board-fullscreen') ?? '',
      fullscreen: document.fullscreenElement === host,
      hint: hint?.textContent?.trim() ?? '',
      boardW: board.offsetWidth,
      boardH: board.offsetHeight,
      gutterW: gutter.offsetWidth,
      visualW: Math.round(boardBox.width),
    };
  });
}

/** Click inside the board frame. A DOM mouse click is what a TV remote or presenter uses. */
async function clickBoard(page: import('puppeteer-core').Page): Promise<void> {
  const box = await page.$eval('[data-daily-board]', (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  const x = box.x + Math.min(80, box.w / 2);
  const y = box.y + Math.min(80, box.h / 2);
  await page.mouse.click(x, y);
}

/** Escape is a browser shortcut. A page-level key event does not leave fullscreen. */
async function pressEscape(page: import('puppeteer-core').Page): Promise<void> {
  const session = await page.createCDPSession();
  await session.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await session.detach();
}

async function main(): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err: unknown) => {
      console.error('pageerror', err instanceof Error ? err.message : err);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('console', msg.text());
    });
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    const before = await layout(page);
    if ('error' in before) throw new Error(before.error);
    if (before.boardW !== 1280 || before.boardH !== 720) {
      throw new Error(`board layout ${before.boardW}×${before.boardH}`);
    }
    if (before.gutterW !== 300) throw new Error(`gutter ${before.gutterW}px`);
    if (before.hint !== 'Tap for full screen') throw new Error(`hint ${before.hint}`);
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-board-fullscreen]');
      if (!host) return false;
      return Object.keys(host).some((key) => key.startsWith('__reactProps'));
    });

    await clickBoard(page);
    await page.waitForFunction(
      () => document.querySelector('[data-board-fullscreen]')?.getAttribute('data-board-fullscreen') === 'on',
      { timeout: 5_000 },
    );
    const entered = await layout(page);
    if ('error' in entered) throw new Error(entered.error);
    if (!entered.fullscreen) throw new Error('fullscreen element is not the board');
    if (entered.boardW !== 1280 || entered.boardH !== 720) {
      throw new Error(`fullscreen changed layout to ${entered.boardW}×${entered.boardH}`);
    }
    if (entered.visualW <= 1280) throw new Error(`board did not grow to fill the display (${entered.visualW}px)`);
    if (entered.gutterW !== 300) throw new Error(`fullscreen gutter ${entered.gutterW}px`);
    if (entered.hint !== 'Tap to exit') throw new Error(`entered hint ${entered.hint}`);

    await clickBoard(page);
    await page.waitForFunction(
      () => document.querySelector('[data-board-fullscreen]')?.getAttribute('data-board-fullscreen') === 'off',
      { timeout: 5_000 },
    );
    const clickedOff = await layout(page);
    if ('error' in clickedOff || clickedOff.fullscreen) throw new Error('second click did not exit');
    // Chrome ignores a new fullscreen request in the same turn as the exit.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await clickBoard(page);
    await page.waitForFunction(
      () => document.fullscreenElement != null,
      { timeout: 5_000 },
    );
    await pressEscape(page);
    await page.waitForFunction(
      () =>
        document.fullscreenElement == null &&
        document.querySelector('[data-board-fullscreen]')?.getAttribute('data-board-fullscreen') === 'off',
      { timeout: 5_000 },
    );
    const escaped = await layout(page);
    if ('error' in escaped || escaped.fullscreen || escaped.hint !== 'Tap for full screen') {
      throw new Error('Escape did not restore the board');
    }
    console.log(`Fullscreen enter, click-exit, and Escape ok at ${url}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
