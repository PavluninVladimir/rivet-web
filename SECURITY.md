# Безопасность

Об уязвимостях консоли Rivet сообщайте только приватно, через **GitHub
Security Advisories**: вкладка **Security → Report a vulnerability** этого
репозитория или
[основного репозитория](https://github.com/PavluninVladimir/rivet/security/advisories/new).
Не открывайте issue и PR с описанием дыры, пока она не исправлена.

*English: please report vulnerabilities privately through GitHub Security
Advisories. Do not open public issues for security problems.*

Модель угроз, поддерживаемые версии и что считается уязвимостью описаны в
[SECURITY.md основного репозитория](https://github.com/PavluninVladimir/rivet/blob/main/SECURITY.md).
Для консоли это в первую очередь:

- выполнение чужого кода в консоли: XSS через данные задач, транскрипты
  сессий агентов, описания архитектуры, схемы Mermaid и Markdown интервью
- действие от имени вошедшего человека с чужого сайта (CSRF, clickjacking)
- секрет (токен хостинга, ключ модели, токен runner'а или PAT) виден в
  интерфейсе, в адресе страницы или в журнале браузера после сохранения.

Что приложить: версию из ссылки «Исходный код · версия» на странице входа,
как воспроизвести и что получает нападающий. Только выдуманные данные.
