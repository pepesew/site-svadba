// Картинка-превью для мессенджеров (Open Graph): tools/og.html → assets/img/og-image.jpg (1200×630)
// Запуск: npm run og   (нужен Firefox; путь — в $FIREFOX)
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'wedding-og-'));
const browser = await puppeteer.launch({
  browser: 'firefox', executablePath: process.env.FIREFOX || '/usr/bin/firefox', headless: true,
  userDataDir: profile, defaultViewport: null, args: ['--width=1300', '--height=900'],
});
try {
  const page = await browser.newPage();
  await page.goto('file://' + join(root, 'tools/og.html'));
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));
  const r = await page.evaluate(() => { const b = document.querySelector('.og').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const png = await page.screenshot({ captureBeyondViewport: false });
  const out = join(root, 'assets/img/og-image.jpg');
  await sharp(png).extract({ left: Math.round(r.x), top: Math.round(r.y), width: 1200, height: 630 })
    .jpeg({ quality: 86, mozjpeg: true }).toFile(out);
  console.log('готово:', out);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
