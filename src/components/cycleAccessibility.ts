import type { CyclePhase } from '../api/client'
import { unaccountedText } from './discovery.ts'

// The phase opener is a separate button from count/material/feedback links.
// Its accessible name must retain the phase state when reached directly by Tab.
export function phaseOpenLabel(
  phase: Pick<CyclePhase, 'title' | 'no_data' | 'hint' | 'counters' | 'feedback_unaccounted'>
): string {
  const { active, waiting, needs_human } = phase.counters
  const state = phase.no_data
    ? `нет данных${phase.hint ? ', ' + phase.hint : ''}`
    : `в работе ${active}, ждут ${waiting}, нужен человек ${needs_human}`
  const feedback = unaccountedText(phase.feedback_unaccounted ?? 0)
  return `Открыть фазу ${phase.title}: ${state}${feedback ? ', ' + feedback : ''}`
}
