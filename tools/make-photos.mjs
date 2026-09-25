// Готовит фото пары для сайта: пастельные мягкие цвета, WebP в двух размерах.
// Запуск: npm run photos   (исходники — ~/photo_in_svadba или путь в $PHOTOS)
import sharp from 'sharp';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SRC = process.env.PHOTOS || join(homedir(), 'photo_in_svadba');
const OUT = new URL('../assets/img/', import.meta.url);

// Порядок = порядок рамок на странице
const PHOTOS = [
  ['photo_2026-09-25_13-06-58 (2).jpg', 'photo-1'],  // щекой к щеке — большая рамка слева
  ['photo_2026-09-25_13-06-59.jpg', 'photo-2'],      // объятия, взгляд в камеру — малая справа
  ['photo_2026-09-25_13-06-58.jpg', 'photo-3'],      // объятия со спины — после цитаты
];

// Пастельная цветокоррекция: цвета сохраняем, но делаем мягче
const SATURATION = 0.58;  // насыщенность 58% от исходной
const MATTE = { mul: 0.86, add: 28 }; // тени приподняты (черный → ~28), света чуть приглушены — мягкий контраст

for (const [file, name] of PHOTOS) {
  for (const width of [480, 960]) {
    const out = new URL(`${name}-${width}.webp`, OUT);
    await sharp(join(SRC, file))
      .rotate()                                            // учесть EXIF-ориентацию
      .resize({ width, height: Math.round(width * 4 / 3), fit: 'cover' })
      .modulate({ saturation: SATURATION, brightness: 1.03 })
      .linear(MATTE.mul, MATTE.add)
      .webp({ quality: 84 })
      .toFile(out.pathname);
    console.log('готово:', `${name}-${width}.webp`);
  }
}
