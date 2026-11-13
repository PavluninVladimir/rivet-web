import type { BacklogRow, DiscoveryOutcome } from '../api/client'
export const OUTCOME_LABEL: Record<DiscoveryOutcome, string> = {
  backlog_ready: 'Бэклог готов к рассмотрению',
  needs_clarification: 'Нужны уточнения',
  no_development_recommended: 'Новая разработка не рекомендована'
}
// Explicit null/unknown outcomes fail closed. Compatibility is only for an
// older server that omitted the field entirely and a usable non-empty backlog.
export function discoveryOutcome(run: {
  outcome?: string | null
  outcome_error?: string
  backlog?: BacklogRow[] | null
}): DiscoveryOutcome | null {
  if (run.outcome_error) return null
  if (
    run.outcome === 'backlog_ready' ||
    run.outcome === 'needs_clarification' ||
    run.outcome === 'no_development_recommended'
  )
    return run.outcome
  if (run.outcome !== undefined) return null
  const b = run.backlog
  return b &&
    b.length >= 1 &&
    b.length <= 12 &&
    b.every(
      e =>
        typeof e.key === 'string' &&
        !!e.key &&
        typeof e.title === 'string' &&
        !!e.title.trim() &&
        typeof e.goal === 'string' &&
        e.goal.trim().length >= 40 &&
        ['must', 'should', 'could'].includes(e.priority) &&
        ['S', 'M', 'L'].includes(e.size)
    )
    ? 'backlog_ready'
    : null
}
export function canEditDiscovery(run: {
  outcome?: string | null
  outcome_error?: string
  backlog?: BacklogRow[] | null
  status: string
  outdated: boolean
}): boolean {
  return run.status === 'ready' && !run.outdated && discoveryOutcome(run) === 'backlog_ready'
}
export function answerMaterial(
  run: { id: string; version: number },
  question: { id: string; text: string }
): string {
  return `Ответ на исследование v${run.version}, run ${run.id}, вопрос ${question.id}\n${question.text}\n\nОтвет: `
}
