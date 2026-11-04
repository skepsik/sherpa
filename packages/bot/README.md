# @sherpa/bot

Транспорт Telegram: приём Update, исполнение outbound-команд, WebSocket-канал границы (`@sherpa/contract`).

## Env

См. корневой `.env.example`.

| Переменная                  | Обязательна | Смысл                                    |
| --------------------------- | ----------- | ---------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | да          | токен бота                               |
| `TELEGRAM_USER_ID`          | да          | единственный допустимый отправитель      |
| `TELEGRAM_ALLOWED_CHAT_IDS` | да          | allowlist chat id через запятую          |
| `SHERPA_CHANNEL_SECRET`     | да          | секрет рукопожатия канала (не коммитить) |
| `SHERPA_CHANNEL_HOST`       | нет         | bind host, по умолчанию `127.0.0.1`      |
| `SHERPA_CHANNEL_PORT`       | нет         | bind port, по умолчанию `8787`           |
| `SHERPA_CHANNEL_PATH`       | нет         | path upgrade, по умолчанию `/v1/channel` |

## Opaque `Place`

На проводе — непрозрачная строка (`Place`). Кодек Telegram ↔ id только в боте (`src/place-id.ts`); раннер строку не разбирает.

Формат (версия кодека `tg1`; смена, ломающая уже выданные id, — только с явной миграцией):

| Telegram-место                      | Id                         |
| ----------------------------------- | -------------------------- |
| личка `chatId`                      | `tg1:d:<chatId>`           |
| форумный топик `chatId` + `topicId` | `tg1:t:<chatId>:<topicId>` |

Неизвестный / недекодируемый id на outbound → `place_unavailable`.

## Канал WebSocket

Бот слушает. Клиент канала — исходящее соединение.

- URL (локально): `ws://<host>:<port><path>`
- Секрет рукопожатия — **только** заголовок `Authorization: Bearer <SHERPA_CHANNEL_SECRET>` на HTTP upgrade. Query-параметр не принимается.
- Без верного секрета — HTTP `401`, upgrade не завершается, обмена envelope нет.
- Одно активное соединение: новое успешное рукопожатие вытесняет старое.
- Кадр: одно текстовое JSON-сообщение = один envelope `@sherpa/contract` (`encodeInbound` / `encodeOutbound` / `encodeOutboundResult`).
- Inbound: **at-most-once** (один send без ack). Обрыв / полумёртвый сокет — heartbeat. Нет клиента — inbound не буферизуется; в тот же Place уходит фиксированный текст «Раннер недоступен. Попробуй позже.» (и для текста, и для `question_answer` после локального `answerCallbackQuery`). Кадр, уже ушедший в мёртвый сокет, не переигрывается.
- Outbound: команда → `execute` → исход с тем же `id`. Дедупа по `id` нет. Команды **одного** `Place` сериализуются: следующий `execute` только после завершения предыдущего (успех или отказ); разные `Place` — параллельно.

### TLS / WSS

Процесс бота слушает **plain `ws://`**. Снаружи (VPS) трафик должен быть **WSS**: TLS терминирует reverse proxy (nginx/caddy/…), до бота — `ws://` на loopback. Локальная разработка — `ws://127.0.0.1:…` без TLS.

### Пример обмена

1. Клиент подключается с `Authorization: Bearer …`.
2. Бот шлёт inbound (после сообщения пользователя):

```json
{
  "v": 1,
  "direction": "inbound",
  "eventId": "42",
  "event": {
    "type": "message",
    "place": "tg1:d:123",
    "text": "привет"
  }
}
```

3. По каналу приходит команда:

```json
{
  "v": 1,
  "direction": "outbound",
  "id": "cmd-1",
  "command": {
    "type": "send_message",
    "place": "tg1:d:123",
    "text": "ок"
  }
}
```

4. Бот исполняет и отвечает результатом с тем же `id`:

```json
{
  "v": 1,
  "direction": "outbound",
  "id": "cmd-1",
  "result": { "type": "send_ok", "commandType": "send_message" }
}
```

Heartbeat: серверный WebSocket ping ~30 с; молчание → terminate.

## Запуск

```bash
# из корня репо
cp .env.example .env   # заполнить токен, user id, allowlist, SHERPA_CHANNEL_SECRET
npm run dev:bot
```

## Ручной чек-лист (реальный токен)

Автотесты — на моках. Перед проверкой на живом Telegram:

1. Бот добавлен в супергруппу с топиками (forum); у бота есть право создавать топики.
2. В `.env`: `TELEGRAM_USER_ID`, `TELEGRAM_ALLOWED_CHAT_IDS` (личка и/или супергруппа).
3. Поднять бот; подключить тестовый WS-клиент с `Authorization: Bearer …`.
4. Личка: текст → inbound на канале; без клиента — текст недоступности в Place.
5. Топик: то же для текста и для `question_answer` (кнопка).
6. С канала глазами: `send_message`, `send_question`, `resolve_question`, `set_status` (заглушка), `create_place`.
7. Второй WS-клиент вытесняет первый.
