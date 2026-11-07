# Rivet Web

Web console for [Rivet](https://github.com/PavluninVladimir/rivet), an
orchestrator for autonomous software development with AI coding agents. It is
a React single-page app; its production build is embedded into the `rivetd`
binary. The backend and the project overview live in the main repository.
Documentation is in Russian.

Веб-консоль [Rivet](https://github.com/PavluninVladimir/rivet) —
оркестратора автономной разработки с помощью AI-агентов: проекты и Epic'и,
план и DAG задач, runner'ы, сессии агентов, шаги, ждущие человека, расход
токенов, процессы и политики, управление установкой.

Стек: **React**, TypeScript, Vite. Внешних UI-библиотек нет: дизайн-система
(тёмная тема, цветовые токены в oklch) лежит в `src/styles.css` и
`src/forms.css`.

## Разработка

Консоль ходит в API rivetd. Dev-сервер Vite проксирует `/api` на
`http://localhost:8181` (`vite.config.ts`), поэтому rivetd для разработки
удобно запускать на этом порту:

```sh
# в rivet/rivet-service: свой пароль администратора, пароли из
# документации rivetd отклоняет
export RIVET_ADMIN_PASSWORD="$(openssl rand -base64 18)"; echo "$RIVET_ADMIN_PASSWORD"
# gRPC на своём порту: 127.0.0.1:8090 занят, если поднят compose-стенд
RIVET_HTTP_ADDR=127.0.0.1:8181 RIVET_GRPC_ADDR=127.0.0.1:8191 RIVET_SCM=fake RIVET_ADMIN_LOGIN=admin \
  go run ./cmd/rivetd

# здесь
npm ci
npm run dev
```

Как поднять Postgres и S3-хранилище для rivetd, в README
[основного репозитория](https://github.com/PavluninVladimir/rivet).

## Сборка и тесты

```sh
npm run build   # tsc -b && vite build → dist/
npm test        # юнит-тесты на node --test
```

Прод-сборка встраивается в rivetd: репозиторий клонируется внутрь клона
`rivet` (`rivet/rivet-web`), а `make ui` в `rivet-service` собирает консоль и
копирует `dist/` в `internal/webui/dist`.

Сборка кладёт в `dist/third-party-licenses.md` имена, версии и тексты
лицензий всех пакетов, попавших в бандл (`build.license` в
`vite.config.ts`), а рядом `dist/NOTICE`. Rollup выбрасывает лицензионные
комментарии из кода пакетов, поэтому лицензии живут отдельными файлами.
rivetd отдаёт их вместе с консолью (`/third-party-licenses.md`, `/NOTICE`),
а `make third-party` в rivet собирает из них раздел консоли своих NOTICE и
THIRD_PARTY.

Ссылка «Исходный код · версия» под формой входа и в профиле берёт версию и
адрес у rivetd (`GET /api/v1/about`), а не из сборки консоли: так она ведёт
на исходники той версии, что работает.

Сквозные сценарии консоли — в
[rivet-e2e](https://github.com/PavluninVladimir/rivet-e2e).

## Участие

Порядок правок, проверки и CLA описаны в [CONTRIBUTING.md](CONTRIBUTING.md).
Об уязвимостях сообщайте приватно, как описано в [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Vladimir Pavlunin. Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only),
with an additional permission under section 7 ([LICENSE-EXCEPTION](LICENSE-EXCEPTION)).

Полный текст лицензии в файле [LICENSE](LICENSE), дополнительное
разрешение по разделу 7 в [LICENSE-EXCEPTION](LICENSE-EXCEPTION), сторонние
пакеты в [NOTICE](NOTICE) и [THIRD_PARTY](THIRD_PARTY). Основной
репозиторий проекта: [PavluninVladimir/rivet](https://github.com/PavluninVladimir/rivet).
