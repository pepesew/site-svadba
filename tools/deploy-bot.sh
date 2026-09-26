#!/usr/bin/env bash
# Выкладывает бэкенд (server/) на сервер и перезапускает сервис wedding-bot.
# Запуск: npm run deploy:bot   (сервер: DEPLOY_HOST=user@host)
# Повторный запуск безопасен: настройки (/etc/wedding-bot.env) и база ответов не трогаются.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@77.232.142.88}"
cd "$(dirname "$0")/.."

ssh "$HOST" 'mkdir -p /opt/wedding-bot'
rsync -az --chmod=D755,F644 server/bot.py server/requirements.txt server/wedding-bot.service "$HOST:/opt/wedding-bot/"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Системный пользователь без входа в систему
id weddingbot >/dev/null 2>&1 || useradd --system --home /opt/wedding-bot --shell /usr/sbin/nologin weddingbot

# Изолированное окружение Python
command -v python3 >/dev/null && python3 -c 'import venv, ensurepip' 2>/dev/null || apt-get install -y -qq python3-venv >/dev/null
[ -x /opt/wedding-bot/venv/bin/python ] || python3 -m venv /opt/wedding-bot/venv
/opt/wedding-bot/venv/bin/pip install -q --upgrade pip >/dev/null
/opt/wedding-bot/venv/bin/pip install -q -r /opt/wedding-bot/requirements.txt

# Настройки создаются один раз: код администратора — случайный
if [ ! -f /etc/wedding-bot.env ]; then
  umask 077
  cat > /etc/wedding-bot.env <<ENV
BOT_TOKEN=
ADMIN_CODE=$(python3 -c 'import secrets; print(secrets.token_hex(4))')
ADMIN_IDS=
TZ_NAME=Asia/Yekaterinburg
ENV
fi
chmod 600 /etc/wedding-bot.env

install -m 644 /opt/wedding-bot/wedding-bot.service /etc/systemd/system/wedding-bot.service
systemctl daemon-reload
systemctl enable --now wedding-bot >/dev/null 2>&1
systemctl restart wedding-bot
sleep 3
systemctl is-active wedding-bot
curl -s http://127.0.0.1:8081/api/health; echo
REMOTE
