# Адаптер OpenCode: выражение прав запуска

Чистая функция `expressLaunchRights(LaunchRights) → OpenCodeLaunchPermissions`.

- Вход — плоский снимок `buildLaunchRights` (issue-4-2).
- Выход — массив `permissions` OpenCode V2 (`allow` / `deny` / `ask`, last match wins).
- Эпик 5 подставляет этот конфиг при старте сессии; permission ask → Telegram — не здесь.
- `append_file` / уровни append сверх закрытия стандартного `edit` — эпик 8.
- Рекомендуемые шаблоны `deny_global` адаптер в снимок/БД не дописывает.
