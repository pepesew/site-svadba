// Генерирует assets/img/qr-max.svg из maxGroupUrl в js/config.js.
// Запуск: npm run qr
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import QRCode from 'qrcode';

const root = new URL('../', import.meta.url);

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL('js/config.js', root), 'utf8'), sandbox);
const url = sandbox.window.WEDDING.maxGroupUrl;

const INK = '#111111';
const PAPER = '#FFFDF5';
const QUIET = 4; // тихая зона по стандарту — 4 модуля

// Уровень H держит до 30% повреждений — хватает на монограмму в центре
const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
const n = qr.modules.size;
const dark = (r, c) => qr.modules.get(r, c) === 1;
const full = n + QUIET * 2;

// Три угловых «глазка» рисуем отдельно четкими квадратами
const finders = [[0, 0], [0, n - 7], [n - 7, 0]];
const inFinder = (r, c) => finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);

// Пустой квадрат под монограмму: не больше 20% ширины кода, нечетный, по центру
let logo = Math.floor(n * 0.2);
if (logo % 2 === 0) logo -= 1;
const lo = (n - logo) / 2;
const inLogo = (r, c) => r >= lo && r < lo + logo && c >= lo && c < lo + logo;

const parts = [];
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (!dark(r, c) || inFinder(r, c) || inLogo(r, c)) continue;
    parts.push(`<rect x="${c + QUIET + 0.05}" y="${r + QUIET + 0.05}" width="0.9" height="0.9" rx="0.3"/>`);
  }
}

for (const [fr, fc] of finders) {
  const x = fc + QUIET, y = fr + QUIET;
  parts.push(
    `<path d="M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z" fill-rule="evenodd"/>`,
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`
  );
}

const cx = full / 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="geometricPrecision">
<rect width="${full}" height="${full}" fill="${PAPER}"/>
<g fill="${INK}">
${parts.join('\n')}
</g>
<text x="${cx}" y="${cx}" fill="${INK}" font-family="'Cormorant Garamond', Georgia, 'Times New Roman', serif" font-size="${logo * 0.42}" text-anchor="middle" dominant-baseline="central">I&amp;S</text>
</svg>
`;

writeFileSync(new URL('assets/img/qr-max.svg', root), svg);
console.log(`QR готов: ${url} (${n}×${n} модулей, уровень H)`);
