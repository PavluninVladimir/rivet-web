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
# в rivet/rivet-service
RIVET_HTTP_ADDR=:8181 RIVET_SCM=fake RIVET_ADMIN_LOGIN=admin RIVET_ADMIN_PASSWORD=change-me \
  go run ./cmd/rivetd

# здесь
npm ci
npm run dev
```

Как поднять Postgres и MinIO для rivetd — в README
[основного репозитория](https://github.com/PavluninVladimir/rivet).

## Сборка и тесты

```sh
npm run build   # tsc -b && vite build → dist/
npm test        # юнит-тесты на node --test
```

Прод-сборка встраивается в rivetd: репозиторий клонируется внутрь клона
`rivet` (`rivet/rivet-web`), а `make ui` в `rivet-service` собирает консоль и
копирует `dist/` в `internal/webui/dist`.

Сквозные сценарии консоли — в
[rivet-e2e](https://github.com/PavluninVladimir/rivet-e2e).

## License

Copyright (C) 2026 Vladimir Pavlunin. Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only).

Полный текст лицензии — в файле [LICENSE](LICENSE). Основной репозиторий
проекта: [PavluninVladimir/rivet](https://github.com/PavluninVladimir/rivet).
