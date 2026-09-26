#!/usr/bin/env bash
# Выкладывает сайт на сервер (nginx отдает /var/www/wedding).
# Запуск: npm run deploy     (сервер можно переопределить: DEPLOY_HOST=user@host npm run deploy)
set -euo pipefail

HOST="${DEPLOY_HOST:-root@77.232.142.88}"
DEST="/var/www/wedding/"
cd "$(dirname "$0")/.."

# Только то, что нужно браузеру: без исходников, инструментов и node_modules
rsync -az --delete --chmod=D755,F644 \
  index.html wedding.ics css js assets \
  "$HOST:$DEST"

echo "Готово: https://pepesewwedding.ru/"
