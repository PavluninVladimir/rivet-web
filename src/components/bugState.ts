// Состояние задачи-бага инцидента так же, как на бэкенде
// (ops.BugState.Unfinished): баг открыт, пока он не отменён и не завершён.
// Отменённый баг остаётся в DTO ссылкой, но кнопку «создать баг» не прячет.

export interface BugTaskRef { id: string; num: number; status: string }

export function bugOpen(bug: BugTaskRef | null | undefined): boolean {
  return !!bug && bug.status !== 'cancelled' && bug.status !== 'done'
}

// bugLabel — подпись бага в списках: номер и статус, если он закрыт.
export function bugLabel(bug: BugTaskRef | null | undefined): string {
  if (!bug) return 'без бага'
  if (bug.status === 'cancelled') return `task-${bug.num} · отменён`
  if (bug.status === 'done') return `task-${bug.num} · смержен`
  return `task-${bug.num}`
}
