# @sherpa/runner

Демон рядом с проектами: канал с ботом, реестр, маршрутизация, запуск агентов.

## Env

См. корневой `.env.example`.

| Переменная                | Обязательна | Смысл                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------- |
| `SHERPA_CHANNEL_URL`      | да          | полный `ws://…` / `wss://…` URL канала бота                   |
| `SHERPA_CHANNEL_SECRET`   | да          | секрет рукопожатия (тот же, что у бота)                       |
| `SHERPA_REGISTRY_PATH`    | да          | путь к файлу SQLite реестра                                   |
| `SHERPA_MID_RUN_DELIVERY` | нет         | дефолт mid-run: `interject` \| `after`; нет ключа — interject |

Локально канал: `ws://127.0.0.1:8787/v1/channel` (host/port/path — у бота).

Реестр: файл на диске (`node:sqlite`). Данные не коммитить (см. корневой `.gitignore`). Для не-файлового движка тот же ключ env — connection string.

## Реестр

Таблицы: `workdirs`, `places`, `roles`, `grant`, `deny`, `deny_global` ([`design/data-schema.md`](../../design/data-schema.md)). Миграции идемпотентны при открытии.

Запись `workdirs.cwd` и `grant.path` — только через слой реестра с нормализацией (`realpath`: абсолютный путь, без хвостового `/`, без `.` / `..`). Seed сырым SQL в обход слоя — запрещён (в т.ч. для `grant.path` и pattern).

Lookup: `findCwdByPlaceKey(place)` → `cwd` или `null` (нет ключа).
`getPlaceSessionId` / `setPlaceSessionId` — `places.session_id` (нет ключа — `PlaceNotFoundError`; пустая строка — сессии нет).

Права cwd: `loadWorkdirRights(cwd)` — одной транзакцией все `grant` / `deny` этого cwd и все `deny_global`. Нет workdir — ошибка `workdir_not_found`. Кэша между вызовами нет.

Резолв: `resolvePathAccess(cwd, targetPath, snapshot, { registryPath })` — вердикт уровня; `buildLaunchRights(snapshot, { registryPath })` — плоский снимок для адаптера (shell выкл; константный запрет файла реестра + sidecar; `foreignClosures` для вложенного `none` под чужим корнем). Реальный путь — walk как open(2) (follow symlink по сегментам, `..` после follow). Grant внутри каталога, закрытого обычным deny целиком — `RightsConfigError`. Кэша снимка между запусками нет: каждый раз load + resolve.

OpenCode (embedded `@opencode/sdk`): `createOpenCodeSessionPort` — порт 5-1 поверх in-process host. На cold `start`: `ensureDenyGlobalMvp` (недостающие шаблоны MVP в `deny_global`) → `loadWorkdirRights` → `buildLaunchRights` → `expressLaunchRights` → `permissions` в create. Shared host; права Place A не на сессию Place B. Стрим: текст хода собирается (`session.text.ended`) и уходит кусками ≤4096 без потери. Mid-run: `interject`→steer, `after`→queue, `session_break`→interrupt. Permission ask → `send_question` / `question_answer` / `answerPermission` (см. ниже). Idle-timeout вне эпика 5. Кэш сессий — `opencode.sqlite` рядом с файлом реестра. Подробнее: [`src/adapters/opencode/README.md`](src/adapters/opencode/README.md).

Conformance suite (матрица allow/deny/ask без диалекта харнесса): [`src/conformance/README.md`](src/conformance/README.md); драйвер OpenCode fake — `createOpenCodeConformanceDriver`; `npm run test:conformance -w @sherpa/runner` (также в общем `npm test`).

## Mid-run

Дефолт доставки текста без `delivery` на wire — `SHERPA_MID_RUN_DELIVERY` (или `interject`). Разовый override — поле `message.delivery` с бота (`/interject` / `/after`). `session_break` (`/stop`): при активном ходе → `interruptTurn` (сессию не закрывает); без живой сессии или без хода — no-op + log. Очередь `message` раннера — pre-harness / serial drain; поверх OpenCode queue второй очереди нет. `question_answer` — не mid-run текст.

## Порт сессии

Узкий порт харнесса (`SessionPort`): `start` / `resume` → `OpenSession` (`pushMessage(text, delivery)`, `interruptTurn`, `subscribe`, `abort`, `answerPermission`). События стрима: `turn_started` / `assistant_text` / `turn_ended` / `error` / `permission_ask` / `closed`. Нормальный конец хода сессию не закрывает.

### Permission ask

Харнесс → событие `permission_ask` (action + resource + requestId харнесса) → раннер шлёт `send_question` в Place: кнопки с `data` из алфавита **`allow` | `deny` | `always`** (текст смысла не в `data`). На проводе — короткий wire `requestId` (`pN`); бюджет `requestId`+`data` ≤48 байт UTF-8 на кнопку. Ответ `question_answer` → маппинг в решение порта: `allow`→`once`, `always`→`always`, `deny`→`reject` → `answerPermission` → харнесс; UI закрывается `resolve_question`. `deny` / `deny_global` / константный запрет реестра / явный `grant none` / shell подтверждением не снимаются (`resolvePathAccess` + сверка): даже на `allow`/`always` в харнесс уходит `reject`. Нет pending (рестарт / повтор / чужой id) — drop + log, без stub-ack. Teardown (closed / error / abort) снимает pending, best-effort `resolve_question`, поздний ответ — как «нет pending». Pending ask — память процесса; после рестарта раннера из БД не восстанавливается.

Слот места (`createPlaceSessionSlots`): ≤1 живой handle и generation; после смерти handle писать в старый канал нельзя. Drain очереди `message`: живой handle → push сразу (в т.ч. mid-run); мёртвый → resume по `places.session_id` или cold `start`, затем сразу user-текст из Place. Resume-fail → сброс `session_id` + cold start. Раннер не добавляет во вход харнесса текстов сверх входящего чата. Каждый `assistant_text` хода зеркалируется в Place (`send_message`). `set_status` busy/idle — по `turn_started` / `turn_ended`, не на каждый push job.

В процессе раннера — OpenCode-порт; для тестов без модели — fake host (`tests/opencode-fake-host.ts`) или прежний `createSessionTestDouble`.

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

Перед каждым cold `start` продуктовый порт вызывает `ensureDenyGlobalMvp`: идемпотентно дописывает в `deny_global` набор MVP (запись `.onto/**` / `AGENTS.md` / `CLAUDE.md` / `.claude/**`; чтение `**/.env*` с исключением `.env.example`; чтение `~/.ssh` / `~/.aws` / `~/.gnupg` как `read://<HOME>/…`). Чужие строки не трогает. Адаптер / `expressLaunchRights` по-прежнему **не** подмешивает шаблоны в express — только то, что уже в БД после ensure. Ручной seed CLI остаётся. Эпик 6 расширяет запись раннера в `deny_global` (отклонение от канона «Роли БД» / «вручную» — fold отдельно). Отказ ensure → отличимый текст в Place, старт неуспешен; очередь Place не сбрасывается.

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
4. `message` при наличии строки — job в очередь сообщений места; serial drain = ensure handle + `pushMessage` с resolved delivery (ход не ждём). Busy-reject пользователю нет.
5. `session_break` — interrupt активного хода или no-op+log (см. Mid-run); не в FIFO сообщений.
6. `question_answer` — **не** в FIFO сообщений; доставка в pending permission ask по wire `requestId` (см. Permission ask).
7. Сбой outbound на стриме — лог; push job при исключении — следующий job всё же берётся.

Проверка вручную: поднять бота и раннер (Node с `await using`, см. адаптер README), seed места (`npm run seed -w @sherpa/runner`), написать в seed-Place — ответ OpenCode; в неизвестный Place — «вне реестра» с id.

## Агент проекта (эпик 6)

Минимальный продуктовый путь **без привратника**: сообщение из уже привязанного места → агент только в своём `cwd`. Роль `gatekeeper`, направление в чужое место и `create_place` — **эпик 7**; seed и раннер эпика 6 на них не ветвятся.

1. Env бота и раннера: `SHERPA_CHANNEL_URL`, `SHERPA_CHANNEL_SECRET`, у раннера ещё `SHERPA_REGISTRY_PATH` (см. Env выше / корневой `.env.example`).
2. Seed workdir+place **без** роли `gatekeeper`:

```bash
cp .env.example .env
npm run seed -w @sherpa/runner -- \
  --cwd /absolute/path/to/project \
  --name my-project \
  --description 'когда сюда' \
  --place '<opaque-Place>'
```

3. Поднять бота (канал) и раннер: `npm run dev:bot` / `npm run dev:runner`.
4. Написать в seed-Place — cold `start` (внутри `ensureDenyGlobalMvp` → права → express) → текст пользователя → ответ ассистента в то же Place; `session_id` в `places`. Permission ask — кнопки в то же Place.

Приёмка happy path (fake host, без сети к модели): `npm run test -w @sherpa/runner -- tests/project-agent-acceptance.test.ts`.

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
- `ensureDenyGlobalMvp` / `listMvpDenyGlobalPatterns` / `EnsureDenyGlobalError` — ensure набора MVP в `deny_global` перед cold `start`.
- `expressLaunchRights` / `OpenCodeExpressError` / `createOpenCodeSessionPort` / `createOpenCodeHost` — адаптер OpenCode (`src/adapters/opencode`).
- `createSessionTestDouble` / `createPlaceSessionSlots` / `SessionResumeError` — double порта и слот места.
- `createChannelClient({ config, onInbound })` → `{ start, stop, send }`.
- `createInboundRouter({ findCwdByPlaceKey, getPlaceSessionId, setPlaceSessionId, loadWorkdirRights, midRunDefaultDelivery, registryPath, sessionPort, send })` → `{ handleInbound }`.
- `loadMidRunDefaultDelivery` — `SHERPA_MID_RUN_DELIVERY` / дефолт `interject`.
- `classifyOutboundOutcome` — сверка исхода с командой.
