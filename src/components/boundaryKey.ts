import type { Route } from '../store'

// Ключ границы ошибок экрана (App, #viewport): переход на другой экран
// сбрасывает упавший экран. Ключ меняется там, где меняются данные экрана:
// Epic, настройки и цикл проекта по id, экраны проекта по выбранному
// проекту (упавший на проекте A экран не остаётся заглушкой для проекта
// B), релиз и инцидент ещё и по id. Открытие задачи в дашборде, вкладки
// настроек или вкладки архитектуры ключ не меняет и состояние экрана не
// сбрасывает.
export function boundaryKey(r: Route, projectId: string | null): string {
  const project = projectId ?? ''
  switch (r.view) {
    case 'epic':
    case 'project-settings':
    case 'cycle':
      return `${r.view}/${r.id}`
    case 'epics':
    case 'tasks':
    case 'team':
    case 'activity':
    case 'discovery':
    case 'overview':
    case 'architecture':
      return `${r.view}/${project}`
    case 'releases':
    case 'incidents':
      return `${r.view}/${project}/${r.id ?? ''}`
    default:
      return r.view
  }
}
