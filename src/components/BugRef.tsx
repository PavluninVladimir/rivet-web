import { bugLabel, bugOpen, type BugTaskRef } from './bugState'

// Задача-баг в списках инцидентов: номер, а у отменённой и смерженной — статус.
export function BugRef({ bug }: { bug: BugTaskRef | null | undefined }) {
  return <span className={bugOpen(bug) ? 'mono' : 'muted'}>{bugLabel(bug)}</span>
}
