# @sherpa/contract

Контракт границы транспорт ↔ раннер: типы и схемы протокола между `apps/bot` и `apps/runner`.

## Границы ответственности

- **Фильтр отправителя.** Рамки: один пользователь, ввод из своего Telegram. Отсечь чужие апдейты — обязанность транспорта (`apps/bot`). В inbound нет идентификатора отправителя: раннер события от «своих» и «чужих» не различит.
- **`answerCallbackQuery`.** Id callback-запроса Telegram на провод не выносится. Бот отвечает на callback локально; на раннер уходит только `callback` с `requestId` / `data` / `place`.

## Inbound (транспорт → раннер)

`encodeInbound` / `tryDecodeInbound`, места `direct` | `topic`, события `user_message` | `callback`.

## Outbound (раннер → транспорт)

`encodeOutbound` / `tryDecodeOutbound` — команды `send_text` | `send_buttons` | `edit_text` | `create_topic`.

Исходы — `encodeOutboundResult` / `tryDecodeOutboundResult` (`send_ok` | `create_topic_ok` | `error`).

- `send_ok.messageId` — id сообщения в транспорте (стрим / снятие кнопок через `edit_text`).
- `edit_text.buttons`: поле отсутствует — markup не трогать; `[]` — убрать inline-кнопки; иначе заменить.

Envelope: `v` / `direction` / `id` + `command` или `result`.
