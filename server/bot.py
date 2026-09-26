"""
Бэкенд приглашения Иван & София: прием RSVP с сайта + Telegram-бот.

Один процесс:
  * HTTP  POST /api/rsvp  — ответ гостя из формы (nginx проксирует на 127.0.0.1:8081)
  * бот   long polling    — уведомления и команды для молодоженов

Ответы хранятся в SQLite. Повторный ответ с тем же именем заменяет прежний.
Настройки — переменные окружения (см. .env.example).
"""

import asyncio
import csv
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import closing, contextmanager
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import BotCommand, BufferedInputFile, Message

log = logging.getLogger("wedding-bot")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
ADMIN_CODE = os.environ.get("ADMIN_CODE", "").strip()
ADMIN_IDS = {int(x) for x in re.findall(r"\d+", os.environ.get("ADMIN_IDS", ""))}
DB_PATH = os.environ.get("DB_PATH", "/var/lib/wedding-bot/rsvp.sqlite3")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8081"))
TZ = ZoneInfo(os.environ.get("TZ_NAME", "Asia/Yekaterinburg"))  # Оренбург, UTC+5

STATUS = {
    "alone": "Приду один",
    "plus": "Буду с парой / семьей",
    "decline": "Не смогу прийти",
}
GOING = ("alone", "plus")

MAX_NAME = 100
MAX_COMMENT = 500
MAX_COUNT = 10

# Не больше 5 ответов с одного IP за 10 минут (nginx режет еще раньше)
RATE_LIMIT = 5
RATE_WINDOW = 600


# ---------------------------------------------------------------- база

@contextmanager
def db():
    """Соединение с базой: транзакция коммитится при выходе, соединение закрывается."""
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        with conn:
            yield conn


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS guests (
                key        TEXT PRIMARY KEY,   -- нормализованное имя
                name       TEXT NOT NULL,
                status     TEXT NOT NULL,
                count      INTEGER NOT NULL,
                comment    TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                ip         TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS admins (
                user_id  INTEGER PRIMARY KEY,
                name     TEXT NOT NULL DEFAULT '',
                added_at TEXT NOT NULL
            );
            """
        )


def now_local() -> datetime:
    return datetime.now(TZ)


def fmt_time(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(TZ).strftime("%d.%m.%Y %H:%M")


def name_key(name: str) -> str:
    """«  Пётр   ПЕТРОВ » и «петр петров» — один и тот же гость."""
    return re.sub(r"\s+", " ", name).strip().lower().replace("ё", "е")


def save_answer(answer: dict) -> dict | None:
    """Сохраняет ответ. Возвращает прежний ответ гостя (если он отвечал раньше) или None.

    Если гость исправил имя при редактировании (previous_name), старая запись
    заменяется новой — иначе он посчитался бы дважды.
    """
    key = name_key(answer["name"])
    old_key = name_key(answer.get("previous_name") or "") or key
    stamp = now_local().isoformat()
    with db() as conn:
        prev = conn.execute("SELECT * FROM guests WHERE key = ?", (key,)).fetchone()
        created = prev["created_at"] if prev else stamp
        if old_key != key:
            old = conn.execute("SELECT * FROM guests WHERE key = ?", (old_key,)).fetchone()
            if old:
                conn.execute("DELETE FROM guests WHERE key = ?", (old_key,))
                prev = prev or old
                created = old["created_at"]
        previous = dict(prev) if prev else None
        conn.execute(
            """
            INSERT INTO guests (key, name, status, count, comment, created_at, updated_at, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                name = excluded.name, status = excluded.status, count = excluded.count,
                comment = excluded.comment, updated_at = excluded.updated_at, ip = excluded.ip
            """,
            (key, answer["name"], answer["status"], answer["count"], answer["comment"], created, stamp, ""),
        )
    return previous


def delete_guest(name: str) -> str | None:
    """Удаляет ответ по имени (без учета регистра, пробелов и ё/е). Возвращает имя удаленного."""
    key = name_key(name)
    with db() as conn:
        row = conn.execute("SELECT name FROM guests WHERE key = ?", (key,)).fetchone()
        if row:
            conn.execute("DELETE FROM guests WHERE key = ?", (key,))
            return row["name"]
    return None


def all_guests() -> list[sqlite3.Row]:
    with db() as conn:
        return conn.execute("SELECT * FROM guests ORDER BY updated_at").fetchall()


def totals() -> dict:
    rows = all_guests()
    going = [r for r in rows if r["status"] in GOING]
    return {
        "answers": len(rows),
        "going_answers": len(going),
        "people": sum(r["count"] for r in going),
        "declined": sum(1 for r in rows if r["status"] == "decline"),
    }


def admin_ids() -> set[int]:
    with db() as conn:
        return ADMIN_IDS | {r["user_id"] for r in conn.execute("SELECT user_id FROM admins")}


def add_admin(user_id: int, name: str) -> None:
    with db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO admins (user_id, name, added_at) VALUES (?, ?, ?)",
            (user_id, name, now_local().isoformat()),
        )


# ---------------------------------------------------------------- проверка ответа

class Invalid(ValueError):
    pass


def validate(data: dict) -> dict:
    if not isinstance(data, dict):
        raise Invalid("Некорректный запрос")

    name = re.sub(r"\s+", " ", str(data.get("name", ""))).strip()
    if not 2 <= len(name) <= MAX_NAME:
        raise Invalid("Укажите имя и фамилию")

    status = data.get("status")
    if status not in STATUS:
        raise Invalid("Выберите один из вариантов")

    if status == "alone":
        count = 1
    elif status == "decline":
        count = 0
    else:
        try:
            count = int(data.get("count"))
        except (TypeError, ValueError):
            raise Invalid("Укажите число от 2 до 10") from None
        if not 2 <= count <= MAX_COUNT:
            raise Invalid("Укажите число от 2 до 10")

    comment = str(data.get("comment", "") or "").strip()[:MAX_COMMENT]
    previous_name = re.sub(r"\s+", " ", str(data.get("previousName", "") or "")).strip()[:MAX_NAME]
    return {"name": name, "status": status, "count": count, "comment": comment, "previous_name": previous_name}


# ---------------------------------------------------------------- тексты для Telegram

def plural(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if n10 in (2, 3, 4) and not 12 <= n100 <= 14:
        return few
    return many


def people(n: int) -> str:
    return f"{n} {plural(n, 'человек', 'человека', 'человек')}"


def answers(n: int) -> str:
    return f"{n} {plural(n, 'ответ', 'ответа', 'ответов')}"


def answer_message(answer: dict, previous: dict | None) -> str:
    t = totals()
    changed = previous is not None
    icon = "✏️" if changed else ("💌" if answer["status"] in GOING else "🕊")
    title = "Изменение ответа" if changed else "Новое подтверждение присутствия"
    lines = [
        f"{icon} <b>{title}</b>",
        "",
        f"<b>Гость:</b> {escape(answer['name'])}",
        f"<b>Решение:</b> {STATUS[answer['status']]}",
        f"<b>Количество:</b> {people(answer['count'])}",
    ]
    if answer["comment"]:
        lines.append(f"<b>Комментарий:</b> {escape(answer['comment'])}")
    if changed:
        was = f"{STATUS[previous['status']]}, {people(previous['count'])}"
        if previous["name"] != answer["name"]:
            was = f"{escape(previous['name'])} — {was}"
        lines.append(f"<i>Было: {was}</i>")
    lines += [
        f"<b>Время ответа:</b> {now_local().strftime('%d.%m.%Y %H:%M')} (Оренбург)",
        "",
        f"Всего придут: <b>{people(t['people'])}</b> · {answers(t['answers'])}",
    ]
    return "\n".join(lines)


def stats_message() -> str:
    t = totals()
    return "\n".join([
        "📊 <b>Итоги</b>",
        "",
        f"Придут: <b>{people(t['people'])}</b> ({answers(t['going_answers'])})",
        f"Не смогут: {t['declined']}",
        f"Всего: {answers(t['answers'])}",
    ])


def list_messages() -> list[str]:
    rows = all_guests()
    going = [r for r in rows if r["status"] in GOING]
    declined = [r for r in rows if r["status"] == "decline"]

    lines = [f"💌 <b>Придут — {people(sum(r['count'] for r in going))}</b>"]
    if not going:
        lines.append("пока никого")
    for i, r in enumerate(going, 1):
        line = f"{i}. {escape(r['name'])} — {people(r['count'])}"
        if r["comment"]:
            line += f"\n    <i>{escape(r['comment'])}</i>"
        lines.append(line)

    lines += ["", f"🕊 <b>Не смогут — {len(declined)}</b>"]
    if not declined:
        lines.append("никого")
    for i, r in enumerate(declined, 1):
        line = f"{i}. {escape(r['name'])}"
        if r["comment"]:
            line += f"\n    <i>{escape(r['comment'])}</i>"
        lines.append(line)

    # Telegram ограничивает сообщение 4096 символами — режем по строкам
    chunks, current = [], ""
    for line in lines:
        if len(current) + len(line) + 1 > 3900:
            chunks.append(current)
            current = ""
        current += line + "\n"
    chunks.append(current)
    return chunks


def csv_safe(value) -> str:
    """Текст гостя, начинающийся с = + - @, Excel выполнит как формулу — экранируем."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def export_csv() -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Имя", "Решение", "Количество", "Комментарий", "Первый ответ", "Последнее изменение"])
    for r in all_guests():
        writer.writerow([
            csv_safe(r["name"]), STATUS[r["status"]], r["count"], csv_safe(r["comment"]),
            fmt_time(r["created_at"]), fmt_time(r["updated_at"]),
        ])
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM — чтобы Excel понял кириллицу


HELP = (
    "Команды:\n"
    "/list — список гостей (кто придет и кто нет)\n"
    "/stats — итоги: сколько человек придет\n"
    "/export — таблица всех ответов (CSV для Excel)\n"
    "/delete Имя Фамилия — удалить ответ (тестовый, дубль, ошибка)\n"
    "\nНовые ответы с сайта приходят сюда автоматически."
)


# ---------------------------------------------------------------- бот

bot: Bot | None = None
dp = Dispatcher()


async def notify_admins(text: str) -> None:
    if not bot:
        log.warning("BOT_TOKEN не задан — уведомление не отправлено")
        return
    ids = admin_ids()
    if not ids:
        log.warning("Нет ни одного администратора — уведомление не отправлено")
    for chat_id in ids:
        try:
            await bot.send_message(chat_id, text)
        except Exception:  # один недоступный админ не должен мешать остальным
            log.exception("Не удалось отправить уведомление %s", chat_id)


def is_admin(message: Message) -> bool:
    return bool(message.from_user) and message.from_user.id in admin_ids()


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    if is_admin(message):
        await message.answer("Здравствуйте! 💍\n\n" + HELP)
    else:
        await message.answer(
            "Здравствуйте! Это служебный бот свадьбы Ивана и Софии.\n"
            "Подтвердить присутствие можно на сайте-приглашении."
        )


@dp.message(Command("admin"))
async def cmd_admin(message: Message, command: CommandObject) -> None:
    code = (command.args or "").strip()
    if not ADMIN_CODE or not code or not secrets.compare_digest(code.encode(), ADMIN_CODE.encode()):
        await message.answer("Неверный код.")
        return
    user = message.from_user
    add_admin(user.id, user.full_name)
    log.info("Новый администратор: %s (%s)", user.full_name, user.id)
    await message.answer("Готово, теперь вы получаете ответы гостей. 💌\n\n" + HELP)


@dp.message(Command("help"))
async def cmd_help(message: Message) -> None:
    if is_admin(message):
        await message.answer(HELP)


@dp.message(Command("list"))
async def cmd_list(message: Message) -> None:
    if not is_admin(message):
        return
    for chunk in list_messages():
        await message.answer(chunk)


@dp.message(Command("stats"))
async def cmd_stats(message: Message) -> None:
    if is_admin(message):
        await message.answer(stats_message())


@dp.message(Command("delete"))
async def cmd_delete(message: Message, command: CommandObject) -> None:
    if not is_admin(message):
        return
    name = (command.args or "").strip()
    if not name:
        await message.answer("Напишите имя так же, как в /list, например:\n/delete Тестовый Гость")
        return
    deleted = delete_guest(name)
    if deleted:
        log.info("Удален ответ: %s (админ %s)", deleted, message.from_user.id)
        await message.answer(f"🗑 Ответ «{escape(deleted)}» удален.\n\n" + stats_message())
    else:
        await message.answer("Такого гостя нет. Проверьте имя в /list.")


@dp.message(Command("export"))
async def cmd_export(message: Message) -> None:
    if not is_admin(message):
        return
    stamp = now_local().strftime("%Y-%m-%d_%H-%M")
    await message.answer_document(
        BufferedInputFile(export_csv(), filename=f"гости_{stamp}.csv"),
        caption=stats_message(),
    )


# ---------------------------------------------------------------- HTTP

_hits: dict[str, deque] = defaultdict(deque)
_tasks: set[asyncio.Task] = set()


def rate_limited(ip: str) -> bool:
    now = time.monotonic()
    if len(_hits) > 10_000:  # чистим старые IP, чтобы словарь не рос бесконечно
        for key in [k for k, q in _hits.items() if not q or now - q[-1] > RATE_WINDOW]:
            del _hits[key]
    q = _hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


def reply(status: int, **body) -> web.Response:
    return web.json_response(body, status=status)


async def handle_rsvp(request: web.Request) -> web.Response:
    ip = request.headers.get("X-Real-IP") or request.remote or ""
    if request.content_length is None or request.content_length > 4096:
        return reply(413, ok=False, error="Слишком большой запрос")
    # Только application/json: такой запрос с чужого сайта требует CORS-preflight,
    # который сервер не разрешает, — отправить ответ «от имени» гостя нельзя
    if request.content_type != "application/json":
        return reply(415, ok=False, error="Некорректный запрос")
    try:
        data = json.loads(await request.text())
    except (ValueError, UnicodeDecodeError):
        return reply(400, ok=False, error="Некорректный запрос")

    # Honeypot: скрытое поле заполняют только боты — отвечаем «ок» и ничего не делаем
    if isinstance(data, dict) and str(data.get("website", "")).strip():
        log.info("Honeypot сработал, IP %s", ip)
        return reply(200, ok=True)

    if rate_limited(ip):
        return reply(429, ok=False, error="Слишком много ответов. Попробуйте позже.")

    try:
        answer = validate(data)
    except Invalid as e:
        return reply(400, ok=False, error=str(e))

    previous = save_answer(answer)
    log.info("RSVP: %s — %s (%s)%s", answer["name"], answer["status"], answer["count"], " [изменение]" if previous else "")

    # Ответ уже сохранен — сбой Telegram не должен показывать гостю ошибку.
    # Ссылку на задачу держим, иначе asyncio может удалить ее до завершения.
    task = asyncio.create_task(notify_admins(answer_message(answer, previous)))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return reply(200, ok=True)


async def handle_health(_: web.Request) -> web.Response:
    return reply(200, ok=True, bot=bool(bot))


def make_app() -> web.Application:
    app = web.Application(client_max_size=8 * 1024)
    app.router.add_post("/api/rsvp", handle_rsvp)
    app.router.add_get("/api/health", handle_health)
    return app


# ---------------------------------------------------------------- запуск

async def main() -> None:
    global bot
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()

    runner = web.AppRunner(make_app())
    await runner.setup()
    await web.TCPSite(runner, HOST, PORT).start()
    log.info("HTTP: http://%s:%s/api/rsvp", HOST, PORT)

    if not BOT_TOKEN:
        log.warning("BOT_TOKEN не задан: ответы сохраняются, но в Telegram не отправляются")
        await asyncio.Event().wait()
        return

    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await bot.set_my_commands([
        BotCommand(command="list", description="Список гостей"),
        BotCommand(command="stats", description="Итоги: сколько придет"),
        BotCommand(command="export", description="Таблица ответов (CSV)"),
        BotCommand(command="delete", description="Удалить ответ: /delete Имя Фамилия"),
    ])
    me = await bot.get_me()
    log.info("Бот запущен: @%s", me.username)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
