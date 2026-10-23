# @sherpa/contract

Контракт границы транспорт ↔ раннер: типы и схемы протокола между `apps/bot` и `apps/runner`.

Inbound (транспорт → раннер): `encodeInbound` / `tryDecodeInbound`, места `direct` | `topic`, события `user_message` | `callback`.

Outbound (раннер → транспорт): `encodeOutbound` / `tryDecodeOutbound` — команды `send_text` | `send_buttons` | `create_topic`; исходы — `encodeOutboundResult` / `tryDecodeOutboundResult` (`send_ok` | `create_topic_ok` | `error`). Envelope: `v` / `direction` / `id` + `command` или `result`.
