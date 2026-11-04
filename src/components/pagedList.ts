// Постраничный список с перечитыванием по событиям (релизы, инциденты):
// событие обновляет только первую страницу и сливает её с показанным
// списком по id, догруженный «Ещё» хвост сохраняется.

export interface Page<T> {
  rows: T[]
  next: string | null
}

// mergeHead — свежая первая страница поверх показанного списка. Строки
// головы заменяют свои прежние версии. Строки прежнего списка, которых
// нет в голове и которые по порядку сервера идут после её последней
// строки, остаются хвостом, курсор «Ещё» остаётся прежним. Строки из
// диапазона головы, которых в ней больше нет, ушли из фильтра и
// отбрасываются. Голова без продолжения (next=null) — весь список.
export function mergeHead<T extends { id: string }>(prev: Page<T>, head: Page<T>, after: (a: T, b: T) => boolean): Page<T> {
  if (head.next === null || head.rows.length === 0) return head
  const ids = new Set(head.rows.map(x => x.id))
  const last = head.rows[head.rows.length - 1]
  const tail = prev.rows.filter(x => !ids.has(x.id) && after(x, last))
  if (tail.length === 0) return head
  return { rows: [...head.rows, ...tail], next: prev.next }
}

// appendPage — страница «Ещё» в конец списка без повторов.
export function appendPage<T extends { id: string }>(prev: Page<T>, page: Page<T>): Page<T> {
  const ids = new Set(prev.rows.map(x => x.id))
  return { rows: [...prev.rows, ...page.rows.filter(x => !ids.has(x.id))], next: page.next }
}

const ts = (s: string) => Date.parse(s) || 0

// releaseAfter — порядок релизов сервера: created_at DESC, id DESC.
export function releaseAfter(a: { id: string; created_at: string }, b: { id: string; created_at: string }): boolean {
  const d = ts(a.created_at) - ts(b.created_at)
  return d !== 0 ? d < 0 : a.id < b.id
}

const RANK: Record<string, number> = { open: 0, mitigated: 1 }

// incidentAfter — порядок инцидентов сервера: открытые, смягчённые,
// закрытые, внутри — last_seen DESC, затем id.
export function incidentAfter(a: { id: string; status: string; last_seen: string }, b: { id: string; status: string; last_seen: string }): boolean {
  const r = (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2)
  if (r !== 0) return r > 0
  const d = ts(a.last_seen) - ts(b.last_seen)
  return d !== 0 ? d < 0 : a.id > b.id
}
