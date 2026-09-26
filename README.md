# Иван & София — сайт-приглашение

Одностраничное приглашение на свадьбу 31.10.2026, Оренбург, ресторан «Royal Palace».

Сайт: **https://pepesewwedding.ru**

Статический сайт: `index.html` открывается прямо из папки, сборка для просмотра не нужна.

## Что внутри

- **3D** (Three.js): кольца на первом экране, коробка в блоке «Вместо цветов», сердце у таймера и формы ответа. Исходники — `src/scene/`, собранный файл — `js/scene.js`.
- **Анимации**: прелоадер, плавный скролл (Lenis), появление блоков (GSAP + ScrollTrigger) — `js/motion.js`.
- **Логика**: таймер, форма RSVP, ссылки на карты и календари, копирование ссылки на группу MAX — `js/main.js`.
- **Бэкенд** (`server/`): прием ответов RSVP + Telegram-бот @weddingSofia_Ivan_bot (Python, aiogram, SQLite). Команды для молодоженов: `/list`, `/stats`, `/export`, `/delete Имя Фамилия`.
- **Данные события** (дата, время, место, координаты, ссылка на MAX) — в одном файле `js/config.js`.

## Команды

```bash
npm install          # один раз — зависимости для сборки и генераторов
npm run build        # пересобрать 3D-сцену: src/scene → js/scene.js
npm run qr           # QR-код группы MAX из js/config.js → assets/img/qr-max.svg
npm run photos       # фото пары из ~/photo_in_svadba → assets/img/photo-N-*.webp
npm run fallbacks    # статичные картинки 3D на случай, если WebGL недоступен
npm run og           # картинка-превью для мессенджеров → assets/img/og-image.jpg
npm run deploy       # выложить сайт на сервер
npm run deploy:bot   # выложить бэкенд и перезапустить бота
```

## Сервер

VPS Debian 12: nginx (HTTPS Let's Encrypt с автопродлением, конфиг — `server/nginx-wedding.conf`) и сервис `wedding-bot` (systemd, `server/wedding-bot.service`).
Токен бота и код администратора хранятся только на сервере в `/etc/wedding-bot.env` — в репозиторий они не попадают (шаблон: `server/.env.example`).

При изменении даты или адреса в `js/config.js` нужно вручную обновить и `wedding.ics`.

Разработчик — pepesew
