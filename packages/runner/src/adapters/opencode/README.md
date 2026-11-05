# Адаптер OpenCode

Embedded runtime (`@opencode/sdk`): in-memory router в процессе раннера, без обязательного `opencode serve`.

## Права на старте

`createOpenCodeSessionPort`: на cold `start` — `ensureDenyGlobalMvp` → `loadWorkdirRights` → `buildLaunchRights` → `expressLaunchRights` → `permissions` в `createSession`. Ensure пишет недостающие шаблоны MVP в `deny_global` через API реестра; express их не хардкодит. Shell deny в снимке. Shared host на процесс; права Place A не применяются к сессии Place B (отдельный `createSession`).

Чистая функция `expressLaunchRights(LaunchRights)` — без живой сессии и без побочной записи в БД (issue-4-3).

## Сессия и стрим

Порт 5-1: `start` / `resume` / `pushMessage` / `interruptTurn` / `subscribe` / `abort`.

- Resume по `places.session_id`; любая ошибка get → `SessionResumeError` (слот сбросит id и cold start).
- `pushMessage` / prompt: `SessionNotFoundError` → тот же `SessionResumeError`; слот сбрасывает id, cold start и **один** повторный push. Инвентарь кейсов — `design/session.md` «Кейсы потери сессии».
- `pushMessage` delivery: `interject` → OpenCode **steer**, `after` → **queue**; `interruptTurn` → host interrupt (ход, не closed).
- Ассистентский текст: `session.text.ended` → собранный текст → `assistant_text` кусками ≤4096 (мульти-`send_message` у роутера).
- Нормальный конец хода (`execution.succeeded`) сессию не закрывает; `session_id` сохраняется.
- Закрытие handle: `abort` / обрыв потока событий / ошибка pump.
- Permission ask → событие порта `permission_ask`; ответ — `OpenSession.answerPermission` → host `replyPermission` (`once` / `always` / `reject`). UI кнопок — inbound-router (issue-5-3). На abort/closed незакрытые ask → `reject`.
- Idle-timeout без хода — **вне** эпика 5 (принятый риск).

## Зависимость

`@opencode/sdk` — см. `package.json` runner (`2.2.5`). Живой host требует Node с `await using` (проверено на 26+; на 22 runtime SDK падает). CI-тесты порта — fake host без модели. БД сессий OpenCode — файл `opencode.sqlite` рядом с `SHERPA_REGISTRY_PATH` (не новая таблица шерпы).

## Conformance

Suite + интерфейс драйвера — [`../../conformance/README.md`](../../conformance/README.md). Драйвер OpenCode: `createOpenCodeConformanceDriver()` (fake: express + last-match + ask; CI без модели).

## Вне скоупа здесь

in-process tools раннера (эпик 8), MCP-сервер как путь.
