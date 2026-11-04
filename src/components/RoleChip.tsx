import type { AgentRole } from '../api/client'
import { useStore } from '../store'
import { performerParts, roleColorVar, runnerName } from './roleLabels'

// Плашка роли (add-agent-roles): точка цветом шаблона, «Роль Имя агента»
// и, если передан, runner мелкой припиской. Без шаблона в каталоге
// показывается название из payload или идентификатор, цвет приглушён.
export function RoleChip({ role, roleId, title, name, runner, small }: {
  role?: AgentRole; roleId?: string; title?: string; name?: string; runner?: string; small?: boolean
}) {
  const { main, sub } = performerParts(role?.title ?? title ?? roleId, name, runner)
  return (
    <span className={'chip role-chip' + (small ? ' sm' : '')} data-role={role?.id ?? roleId}
      title={role?.description || undefined}
      style={{ ['--rc' as string]: roleColorVar(role?.color) }}>
      <span className="dot" />
      <span className="n">{main}</span>
      {sub && <span className="rc-runner">{sub}</span>}
    </span>
  )
}

// Исполнитель строкой «Роль Имя агента» цветом роли и runner мелко.
// Без агента — роль и runner, без роли — прежний вид: имя runner'а (из
// DTO, иначе из списка runner'ов, иначе идентификатор) или запасной символ.
export function Performer({ roleId, agentName, runnerName: rName, runnerId, fallback = '—' }: {
  roleId?: string; agentName?: string; runnerName?: string; runnerId?: string; fallback?: string
}) {
  const { roleOf, runners } = useStore()
  const role = roleOf(roleId)
  const run = rName || (runnerId ? runnerName(runners.find(r => r.ID === runnerId), runnerId) : '')
  const { main, sub } = performerParts(role?.title, agentName, run)
  if (!main) return <span>{fallback}</span>
  if (!role) return <span>{main}{sub && <span className="perf-runner">{sub}</span>}</span>
  return (
    <span className="performer" data-role={role.id} style={{ ['--rc' as string]: roleColorVar(role.color) }}>
      <span className="dot" />{main}{sub && <span className="perf-runner">{sub}</span>}
    </span>
  )
}
