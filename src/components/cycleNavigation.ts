import type { CyclePeriod, CyclePhaseId, CycleSummary, CycleItemState } from '../api/client.ts'
import type { Route } from '../routes.ts'

export type CycleRoute = Extract<Route, { view: 'cycle' }>
export function phaseDestination(pid: string, phase: CyclePhaseId, period: CyclePeriod, focus?: CycleRoute['focus'], state?: CycleItemState): CycleRoute {
  return { view: 'cycle', pid, phase, period, ...(focus ? { focus } : {}), ...(focus === 'items' && state ? { state } : {}) }
}
export function agentDestination(pid: string, phase: CyclePhaseId, period: CyclePeriod, agentId: string): CycleRoute {
  return { ...phaseDestination(pid, phase, period, 'agents'), agentId }
}
export function summaryDestinations(pid: string, period: CyclePeriod, summary: Pick<CycleSummary, 'last_release'>) {
  return {
    agents: { view: 'team', pid } as Route,
    incidents: { view: 'incidents', pid } as Route,
    release: { view: 'releases', pid, ...(summary.last_release ? { id: summary.last_release.id } : {}) } as Route,
    money: { view: 'overview', pid, period, focus: 'money' } as Route,
  }
}
