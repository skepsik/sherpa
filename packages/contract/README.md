# @sherpa/contract

Контракт границы транспорт ↔ раннер: типы и схемы протокола между `apps/bot` и `apps/runner`.

## Границы ответственности

- **Фильтр отправителя.** Рамки: один пользователь, ввод из своего Telegram. Отсечь чужие апдейты — обязанность транспорта (`apps/bot`). В inbound нет идентификатора отправителя: раннер события от «своих» и «чужих» не различит.
- **`answerCallbackQuery`.** Id callback-запроса Telegram на провод не выносится. Бот отвечает на callback локально; на раннер уходит только `callback` с `requestId` / `data` / `place`.
- **Идемпотентность inbound.** В envelope обязателен `eventId` (для Telegram — строка из `update_id`). Канал at-least-once (реконнект раннера): раннер дедуплицирует по `eventId`, иначе повторная доставка снова запустит агента.
- **Длина `send_text` / `edit_text`.** Лимит Telegram — 4096 символов на сообщение. Бот **не** режет текст: слишком длинное → исход `error` с `transport_rejected`. Нарезка на несколько сообщений — зона раннера; один успешный `send_*` / `edit_text` → один `messageId` в `send_ok`.
- **`callback_data` ≤ 64 байт (Telegram).** Бот без состояния: `requestId` и `data` должны уместиться в один `callback_data`. Слишком длинная пара → отказ отправки кнопок (`transport_rejected` или не слать). Лимиты длины полей на проводе контракт не фиксирует — это ограничение транспорта при упаковке.
- **Соответствие исхода команде.** Декодер не связывает тип команды с типом результата (`create_topic` теоретически может прийти как `send_ok`). Раннер **обязан** сверять исход с ожидаемым типом команды по `id` корреляции; иначе расхождение будет тихим.

## Inbound (транспорт → раннер)

`encodeInbound(eventId, event)` / `tryDecodeInbound` → `{ eventId, event }`.

Места `direct` | `topic`, события `user_message` | `callback`.

## Outbound (раннер → транспорт)

`encodeOutbound` / `tryDecodeOutbound` — команды `send_text` | `send_buttons` | `edit_text` | `create_topic`.

Исходы — `encodeOutboundResult` / `tryDecodeOutboundResult` (`send_ok` | `create_topic_ok` | `error`).

- `send_ok.messageId` — id сообщения в транспорте (для последующего `edit_text`).
- `edit_text.buttons`: поле отсутствует — markup не трогать; `[]` — убрать inline-кнопки; иначе заменить.

Envelope: `v` / `direction` / `id` + `command` или `result` (inbound: ещё `eventId`).
