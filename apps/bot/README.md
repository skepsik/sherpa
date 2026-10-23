# @sherpa/bot

Транспорт Telegram: приём Update, исполнение outbound-команд, WebSocket-канал к раннеру.

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

## Канал WebSocket (для раннера / эпик 3)

Бот **слушает**; раннер — исходящий клиент.

- URL (локально): `ws://<host>:<port><path>`
- Секрет рукопожатия — **только** заголовок `Authorization: Bearer <SHERPA_CHANNEL_SECRET>` на HTTP upgrade. Query-параметр не принимается.
- Без верного секрета — HTTP `401`, upgrade не завершается, обмена envelope нет.
- Одно активное соединение: новое успешное рукопожатие вытесняет старое.
- Кадр: одно текстовое JSON-сообщение = один envelope `@sherpa/contract` (`encodeInbound` / `encodeOutbound` / `encodeOutboundResult`).
- Inbound: **at-most-once** (один send без ack). Обрыв / полумёртвый сокет — heartbeat; «раннер недоступен» — только когда клиента нет. Кадр, уже ушедший в мёртвый сокет, не переигрывается.
- Outbound: дедуп по `id` команды. Повтор в полёте — один execute. После исхода в окне TTL: в кэш кладутся успех и **неопределённый** `error` (сеть / `GrammyError` с `error_code >= 500`) — повтор `id` вернёт кэш без второго вызова Telegram; **определённый** `error` (`transport_rejected` или `GrammyError` с `error_code < 500`) не кэшируется — тот же `id` снова execute. Очереди исполнения нет; порядок в `Place` обеспечивает раннер (см. `@sherpa/contract`).

### TLS / WSS

Процесс бота слушает **plain `ws://`**. Снаружи (VPS) трафик должен быть **WSS**: TLS терминирует reverse proxy (nginx/caddy/…), до бота — `ws://` на loopback. Локальная разработка — `ws://127.0.0.1:…` без TLS.

### Пример обмена

1. Раннер подключается с `Authorization: Bearer …`.
2. Бот шлёт inbound (после сообщения пользователя):

```json
{
  "v": 1,
  "direction": "inbound",
  "eventId": "42",
  "event": {
    "type": "message",
    "place": { "kind": "direct", "chatId": "123" },
    "text": "привет"
  }
}
```

3. Раннер отвечает командой:

```json
{
  "v": 1,
  "direction": "outbound",
  "id": "cmd-1",
  "command": {
    "type": "send_message",
    "place": { "kind": "direct", "chatId": "123" },
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

Нет раннера / канал упал: inbound не буферизуется; бот сам пишет в тот же Place: «Раннер недоступен. Попробуй позже.» (и для текста, и для `question_answer` после локального `answerCallbackQuery`).

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
3. Поднять бот; подключить тестовый WS-клиент с `Authorization: Bearer …` (или раннер, когда будет).
4. Личка: текст → inbound на канале; без клиента — «Раннер недоступен».
5. Топик: то же для текста и для `question_answer` (кнопка).
6. С канала глазами: `send_message`, `send_question`, `resolve_question`, `set_status` (заглушка), `create_topic`.
7. Повтор команды с тем же `id` — без второго сообщения в чат.
8. Второй WS-клиент вытесняет первый.
