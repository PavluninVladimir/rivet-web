import type { Route } from '../store'

// Ключ границы ошибок экрана (App, #viewport): переход на другой экран
// сбрасывает упавший экран. Ключ меняется там, где меняются данные экрана:
// экраны проекта по проекту из адреса (упавший на проекте A экран не
// остаётся заглушкой для проекта B), Epic по id, релиз и инцидент ещё и по
// id. Открытие задачи в дашборде, вкладки настроек или вкладки
// архитектуры ключ не меняет и состояние экрана не сбрасывает.
export function boundaryKey(r: Route): string {
  switch (r.view) {
    case 'epic':
      return `epic/${r.id}`
    case 'releases':
    case 'incidents':
      return `${r.view}/${r.pid}/${r.id ?? ''}`
    default:
      return 'pid' in r ? `${r.view}/${r.pid}` : r.view
  }
}
