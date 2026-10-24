# Deploy (VPS)

Только транспорт `@sherpa/bot`. Раннер запускается рядом с проектами и подключается к каналу сам.

## Канал

| Вход  | URL                                                  |
| ----- | ---------------------------------------------------- |
| Канал | `ws://<SHERPA_CHANNEL_PUBLISH_HOST>:8787/v1/channel` |

Секрет: заголовок `Authorization: Bearer <SHERPA_CHANNEL_SECRET>`.  
Публичные интерфейсы порт канала не слушают (`docker-compose.prod.yml` → `${SHERPA_CHANNEL_PUBLISH_HOST}:8787`).

## Env на VPS

Файл `~/sherpa/.env` (не в git). Минимум:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_USER_ID`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `SHERPA_CHANNEL_SECRET`
- `SHERPA_CHANNEL_PUBLISH_HOST` — адрес интерфейса сервера, на котором публикуется порт канала; без него выкат не стартует

`SHERPA_CHANNEL_HOST` в контейнере задаёт compose (`0.0.0.0`).

## Выкат

```bash
cd ~/sherpa && git pull --ff-only
bash deploy/deploy-on-host.sh
```

## CI/CD

После успешного CI на push в `master`/`main` — SSH → `deploy/deploy-on-host.sh`.  
Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT`, `VPS_PATH` (`~/sherpa`).
