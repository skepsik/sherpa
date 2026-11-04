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

Таблицы: `workdirs`, `places`, `roles`, `grant`, `deny`, `deny_global` ([`design/data-schema.md`](../../design/data-schema.md)). Миграции идемпотентны при открытии.

Запись `workdirs.cwd` и `grant.path` — только через слой реестра с нормализацией (`realpath`: абсолютный путь, без хвостового `/`, без `.` / `..`). Seed сырым SQL в обход слоя — запрещён (в т.ч. для `grant.path` и pattern).

Lookup: `findCwdByPlaceKey(place)` → `cwd` или `null` (нет ключа).
`getPlaceSessionId` / `setPlaceSessionId` — `places.session_id` (нет ключа — `PlaceNotFoundError`; пустая строка — сессии нет).

Права cwd: `loadWorkdirRights(cwd)` — одной транзакцией все `grant` / `deny` этого cwd и все `deny_global`. Нет workdir — ошибка `workdir_not_found`. Кэша между вызовами нет.

Резолв: `resolvePathAccess(cwd, targetPath, snapshot, { registryPath })` — вердикт уровня; `buildLaunchRights(snapshot, { registryPath })` — плоский снимок для адаптера (shell выкл; константный запрет файла реестра + sidecar; `foreignClosures` для вложенного `none` под чужим корнем). Реальный путь — walk как open(2) (follow symlink по сегментам, `..` после follow). Grant внутри каталога, закрытого обычным deny целиком — `RightsConfigError`. Кэша снимка между запусками нет: каждый раз load + resolve.

OpenCode: `expressLaunchRights(launchRights)` — снимок → `permissions` для запуска (без живой сессии). Живой старт сессии — `issue-5-2`; ask UI и `append_file` — не здесь. Подробнее: [`src/adapters/opencode/README.md`](src/adapters/opencode/README.md).

## Порт сессии

Узкий порт харнесса (`SessionPort`): `start` / `resume` → `OpenSession` (`pushMessage`, `subscribe`, `abort`). События стрима: `turn_started` / `assistant_text` / `turn_ended` / `error` / `permission_ask` / `closed`. Нормальный конец хода сессию не закрывает.

Слот места (`createPlaceSessionSlots`): ≤1 живой handle и generation; после смерти handle писать в старый канал нельзя. Drain очереди `message`: живой handle → push сразу (в т.ч. mid-run); мёртвый → resume по `places.session_id` или cold `start`, затем push. Resume-fail → сброс `session_id` + cold start. `set_status` busy/idle — по `turn_started` / `turn_ended`, не на каждый push job.

Пока нет OpenCode (`issue-5-2`), в процессе раннера — **test double** (`createSessionTestDouble`): фиксирует вызовы, эхо `echo:<text>` в Place. Permission ask UI — `issue-5-3`.

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

### Grant / deny / deny_global вручную

Админки в MVP нет — строки прав заводятся через тот же CLI (слой реестра: нормализация path, валидация pattern).

```bash
npm run seed -w @sherpa/runner -- grant \
  --cwd /path/to/workdir \
  --path /path/to/target \
  --level ro

npm run seed -w @sherpa/runner -- deny \
  --cwd /path/to/workdir \
  --pattern 'write:.onto/**'

npm run seed -w @sherpa/runner -- deny-global \
  --pattern 'read:**/.env*'
```

Типичные шаблоны защиты (`.onto/**`, `CLAUDE.md`, `AGENTS.md`, `.claude/`, секреты) в `deny_global` **не подмешиваются кодом** адаптера/раннера — только руками (или клиентом БД через API). Перед агентом проекта (эпик 6) закрой инструкции в `deny_global`.

Примеры pattern: `write:.onto/**`, `read:**/.env*`, `write:!**/.env.example`, `//absolute/path/**`; без префикса = `write:`.

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

## Маршрутизация inbound

Процесс: connect канала → открыть реестр → подписка на inbound.

1. Дедуп `eventId` (in-memory набор на процесс). Повтор — тихий drop + лог; lookup и ответы не делаются. После рестарта раннера набор пуст: тот же `eventId` с бота после рестарта бота+раннера может обработаться снова.
2. Lookup `places` по opaque `Place`.
3. Нет строки — `send_message` «место вне реестра» **с id этого места** в тексте; в очередь сообщений не ставится.
4. `message` при наличии строки — job в очередь сообщений места; serial drain = ensure handle + `pushMessage` в порт (ход не ждём). Busy-reject пользователю нет.
5. `question_answer` — **не** в FIFO сообщений; stub-ack «Принято.» по отдельному пути (permission UI — 5-3).
6. Сбой outbound на стриме — лог; push job при исключении — следующий job всё же берётся.

Проверка вручную: поднять бота и раннер, seed места (`npm run seed -w @sherpa/runner`), написать в seed-Place — эхо double (`echo:…`); в неизвестный Place — ответ «вне реестра» с id.

## Запуск

```bash
# из корня репо (бот уже слушает канал)
cp .env.example .env   # канал + SHERPA_REGISTRY_PATH
npm run seed -w @sherpa/runner -- --cwd … --name … --description … --place …
npm run dev:runner
```

## API (пакет)

- `loadRunnerConfig` / `loadChannelConfig` / `loadRegistryConfig` — env.
- `openRegistry` → `{ seedWorkdirPlace, findCwdByPlaceKey, getPlaceSessionId, setPlaceSessionId, insertWorkdir, insertPlace, upsertGrant, insertDeny, insertDenyGlobal, loadWorkdirRights, … }`.
- `normalizeWorkdirPath` — нормализация `cwd` / `grant.path` перед записью.
- `validateDenyPattern` — fail-fast валидация диалекта deny.
- `resolvePathAccess` / `buildLaunchRights` / `RightsConfigError` — резолв вердикта пути и плоского снимка запуска.
- `expressLaunchRights` / `OpenCodeExpressError` — выражение снимка в permissions OpenCode (`src/adapters/opencode`).
- `createSessionTestDouble` / `createPlaceSessionSlots` / `SessionResumeError` — порт (double) и слот места.
- `createChannelClient({ config, onInbound })` → `{ start, stop, send }`.
- `createInboundRouter({ findCwdByPlaceKey, getPlaceSessionId, setPlaceSessionId, sessionPort, send })` → `{ handleInbound }`.
- `classifyOutboundOutcome` — сверка исхода с командой.
