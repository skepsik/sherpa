# @sherpa/contract

Контракт границы транспорт ↔ раннер: типы и схемы протокола между `apps/bot` и `apps/runner`.

Inbound (транспорт → раннер): `encodeInbound` / `tryDecodeInbound`, места `direct` | `topic`, события `user_message` | `callback`.
