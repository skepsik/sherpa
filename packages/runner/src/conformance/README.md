# Conformance suite

Автоматическая матрица продуктовых вердиктов (`allow` / `deny` / `ask`) против драйвера адаптера. Канон: [`design/adapters/index.md`](../../../../design/adapters/index.md), критерии — [`design/rights.md`](../../../../design/rights.md) «Conformance», ask-круг — [`design/session.md`](../../../../design/session.md).

Suite **не** знает диалекта OpenCode: кейсы формулируют действие (read/write) + путь + ожидание вердикта. Диалект — только внутри драйвера.

## Интерфейс драйвера

`ConformanceDriver.provoke(input)`:

| Поле     | Смысл                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| `rights` | снимок: `cwd`, grants, deny / deny_global (шаблоны раннера), `registryPath`              |
| `action` | `read` \| `write`                                                                        |
| `path`   | абсолютный путь провокации                                                               |
| `onAsk`  | на вердикт `ask` — программный `once` / `always` / `reject`; без колбэка → вернуть `ask` |

Возврат — продуктовый `allow` \| `deny` \| `ask`.

Типы: `src/types/conformance.ts`. MVP-кейсы: `listMvpConformanceCases()`. Прогон: `prepareConformanceCase` → `runConformanceSuite(driver, …)`.

## Драйвер OpenCode

`createOpenCodeConformanceDriver()` — **fake** (по умолчанию в CI):

1. `buildLaunchRights` → `expressLaunchRights`;
2. last-match по permissions OpenCode (`external_directory` + read/edit);
3. ask → `onAsk`; deny таблицы / константный запрет реестра подтверждением не снимаются (`isPermissionConfirmationBlocked`), как на порте.

**Live** embedded SDK / вызов модели — **не** в CI. Opt-in позже через env (когда появится проверка permissions без платной модели); до того README честно: прогон = fake, эквивалентный expression + резолву + ask-эмуляции.

## Запуск

Входит в `npm test -w @sherpa/runner` (`tests/conformance.test.ts`). Отдельно:

```bash
npm run test:conformance -w @sherpa/runner
```

Платный вызов модели не нужен.

## MVP (зелёный набор)

- файл внутри своего cwd — allow read;
- родитель / сосед без grant — deny или ask (не silent allow);
- запись в узел с write-deny / `ro` — блок;
- `read:**/.env*` внутри разрешённого — блок чтения;
- относительный global deny на grant-корень вне cwd;
- ask-круг: вне правил → ask → programmatic once/reject; deny таблицы / константный запрет registry не обходится allow.

## Backlog suite (канон, ещё не в MVP)

Строки [`rights.md`](../../../../design/rights.md) «Conformance», не закрытые MVP:

- поиск по содержимому / по имени — те же границы;
- путь с пробелом и кириллицей в корнях и шаблонах;
- симлинк наружу и `..`;
- сиблинг `cwd` как grant-корень;
- запрет с исключением (`!`): `.env` закрыт, `.env.example` читается;
- запрет сильнее saved-approval харнесса (поверх уже покрытого «deny не обходится allow»);
- поиск по каталогу с запретом: отдельный файл в результатах не протекает.

## Новый харнесс

Новый драйвер с тем же `ConformanceDriver` + зелёный MVP. Матрицу под вендора не переписывать.
