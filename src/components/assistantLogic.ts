// Server-generated refs are still treated as data. Never render executable,
// cross-origin or other-project links from a model answer.
export function projectEvidenceHref(url:string,projectId:string):string|null {
 const prefix=`#/p/${encodeURIComponent(projectId)}/`
 if (!url.startsWith(prefix) || /[\u0000-\u0020\\]/.test(url)) return null
 return url
}
export const ACTION_LABEL:Record<string,string>={proposed:'Предложено',executing:'Исполняется',succeeded:'Действие принято',failed:'Ошибка действия',denied:'Запрещено правилом',requires_human:'Нужно решение человека',unknown:'Результат неизвестен'}
export const RUN_LABEL:Record<string,string>={queued:'В очереди',running:'Выполняется',completed:'Завершён',waiting_human:'Нужно решение человека',failed:'Ошибка',stopped:'Остановлен',budget_exhausted:'Лимит исчерпан'}
