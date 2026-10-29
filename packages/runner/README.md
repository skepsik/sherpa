# @sherpa/runner

Демон рядом с проектами: канал с ботом, реестр, маршрутизация, запуск агентов.

## Env

См. корневой `.env.example`.

| Переменная              | Обязательна | Смысл                                       |
| ----------------------- | ----------- | ------------------------------------------- |
| `SHERPA_CHANNEL_URL`    | да          | полный `ws://…` / `wss://…` URL канала бота |
| `SHERPA_CHANNEL_SECRET` | да          | секрет рукопожатия (тот же, что у бота)     |
| `SHERPA_REGISTRY_PATH`  | да          | путь к файлу SQLite реестра                 |

Локально канал: `ws://127.0.0.1:8787/v1/channel` (host/port/path — у бота).

Реестр: файл на диске (`node:sqlite`). Данные не коммитить (см. корневой `.gitignore`). Для не-файлового движка тот же ключ env — connection string.

## Реестр

Таблицы: `workdirs`, `places`, `roles` ([`design/data-schema.md`](../../design/data-schema.md)). Миграции идемпотентны при открытии.

Запись `cwd` — только через слой реестра с нормализацией (`realpath`: абсолютный путь, без хвостового `/`, без `.` / `..`). Seed сырым SQL в обход слоя — запрещён.

Lookup: `findCwdByPlaceKey(place)` → `cwd` или `null` (нет ключа).

### Seed одного каталога и места

Opaque `Place` для `--place` — тот же id, что на проводе (в проверке e2e: id из ответа «вне реестра», issue-3-4).

```bash
cp .env.example .env   # в т.ч. SHERPA_REGISTRY_PATH=data/registry.sqlite

npm run seed -w @sherpa/runner -- \
  --cwd /absolute/or/relative/existing/dir \
  --name my-project \
  --description 'когда сюда' \
  --place '<opaque-Place>'
```

Скрипт печатает JSON `{ "cwd", "placeKey" }` с нормализованным `cwd`.

## Канал WebSocket (клиент)

Раннер **сам** подключается к боту (исходящее соединение). Один клиент канала на процесс.

- Рукопожатие: заголовок `Authorization: Bearer <SHERPA_CHANNEL_SECRET>`.
- Inbound: decode → подписчик верхнего слоя (`onInbound`).
- Outbound: `send(command)` → wait исхода с тем же `id`.
- Сериализация: ключ = строка `Place`. Один Place — следующая команда только после завершения текущей. Разные Place — параллель ок.
- Невалидный кадр — лог, процесс не роняется.

### Классы завершения ожидания outbound

| Класс               | Когда                                                          | Ретрай той же команды (с точки зрения клиента) |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `success`           | исход совместим с отправленной командой                        | —                                              |
| `transport_reject`  | `error` с кодом отказа и тем же `commandType`                  | возможен (на проводе не зависло)               |
| `protocol_mismatch` | тот же `id`, тип/поля не совместимы; для ретраев как `unknown` | не как «неисполненную»                         |
| `unknown`           | таймаут / обрыв / displaced до исхода                          | не ретраить молча из клиента канала            |

Default таймаут ожидания исхода — 60 с.

### Reconnect / displaced

- Обычный обрыв: backoff reconnect; pending → `unknown`.
- Close `1000` / reason `displaced`: **без** auto-reconnect. Клиент останавливается; **процесс раннера жив** (лог). Восстановление — рестарт процесса.

## Запуск

```bash
# из корня репо (бот уже слушает канал)
cp .env.example .env   # канал + SHERPA_REGISTRY_PATH
npm run dev:runner
```

## API (пакет)

- `loadRunnerConfig` / `loadChannelConfig` / `loadRegistryConfig` — env.
- `openRegistry` → `{ seedWorkdirPlace, findCwdByPlaceKey, insertWorkdir, insertPlace, … }`.
- `normalizeWorkdirPath` — нормализация `cwd` перед записью.
- `createChannelClient({ config, onInbound })` → `{ start, stop, send }`.
- `classifyOutboundOutcome` — сверка исхода с командой.
