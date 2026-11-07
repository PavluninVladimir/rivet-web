# Как участвовать

Консоль Rivet живёт по общим правилам проекта: язык, OpenSpec, ветки,
коммиты и CLA описаны в
[CONTRIBUTING.md основного репозитория](https://github.com/PavluninVladimir/rivet/blob/main/CONTRIBUTING.md).
Здесь только то, что относится к консоли.

*English speakers: issues and pull requests in English are welcome, but the
project language is Russian. Contributions require signing the
[CLA](https://github.com/PavluninVladimir/rivet/blob/main/CLA.md).*

## Правила консоли

- **UX сверяется со спеками** и с дизайн-прототипом консоли: тёмная тема,
  цветовые токены в oklch (`src/styles.css`, `src/forms.css`), без новых
  экранов сверх спеки. Внешних UI-библиотек нет, новая появляется только
  отдельным решением.
- **Строки интерфейса по-русски**, имена в коде латиницей.
- **Данные только от rivetd.** Консоль не вычисляет за бэкенд статусы,
  права и адреса (например, ссылку на исходный код), а берёт их из API.
- **Ошибка API показывается причиной**, а не пустым экраном. Старый rivetd
  без нового эндпоинта не должен ломать экран.
- **Зависимости только с совместимой лицензией** (MIT, ISC, BSD,
  Apache-2.0 и подобные). Новая production-зависимость обновляет `NOTICE` и
  `THIRD_PARTY`: `npm run build && npm run third-party`.

## Проверки перед PR

```sh
npm ci
npx tsc -b
npm test
npm run build
npm run third-party -- --check
```

Поведение, видимое в браузере, проверяют сценарии
[rivet-e2e](https://github.com/PavluninVladimir/rivet-e2e). Если правка его
меняет, сценарии правятся в ветке с тем же именем: CI e2e берёт
одноимённые ветки rivet и rivet-web.

## Безопасность

Об уязвимостях не пишите в issues и PR, только приватным отчётом, как
описано в [SECURITY.md](SECURITY.md).
