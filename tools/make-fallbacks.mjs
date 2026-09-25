// Снимает 3D-объекты в браузере и сохраняет статичные WebP для фолбэка
// (docs_tech_01: если WebGL недоступен или FPS низкий).
// Запуск: npm run fallbacks   (нужен установленный Firefox; путь — в $FIREFOX)
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'wedding-fallbacks-'));
const DPR = 2;

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: process.env.FIREFOX || '/usr/bin/firefox',
  headless: true,
  userDataDir: profile,
  defaultViewport: null,
  args: ['--width=430', '--height=932'],
  // reduced motion: без параллакса, вращения и пульса — объекты в покое
  extraPrefsFirefox: { 'ui.prefersReducedMotion': 1, 'layout.css.devPixelsPerPx': String(DPR) },
});

try {
  const page = await browser.newPage();
  await page.goto('file://' + join(root, 'index.html') + '?fps=off');
  await new Promise((r) => setTimeout(r, 3000));
  // Скрываем текст: в кадре остается только canvas (слоты сохраняют размеры)
  await page.addStyleTag({ content: '.hero, main, .footer { visibility: hidden !important; }' });

  for (const [slot, widthRatio] of [['rings', 1.6], ['gift', 1.3], ['heart', 1.3]]) {
    const rect = await page.evaluate((slot) => {
      const el = document.querySelector(`[data-scene-slot="${slot}"]`);
      const r0 = el.getBoundingClientRect();
      window.scrollTo(0, r0.top + scrollY + r0.height / 2 - innerHeight / 2);
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, slot);
    await new Promise((r) => setTimeout(r, 800));

    const h = rect.h * 1.3;
    const w = rect.h * widthRatio;
    // Снимаем видимую область целиком и вырезаем кадр сами (координаты экрана × DPR)
    const png = await page.screenshot({ captureBeyondViewport: false });
    const out = join(root, `assets/img/3d-${slot}.webp`);
    await sharp(png)
      .extract({
        left: Math.round((rect.x + rect.w / 2 - w / 2) * DPR),
        top: Math.round(rect.y * DPR),
        width: Math.round(w * DPR),
        height: Math.round(h * DPR),
      })
      .webp({ quality: 82 })
      .toFile(out);
    console.log('готово:', out);
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
