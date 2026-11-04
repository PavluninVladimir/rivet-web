import { useEffect, useState } from 'react'
import { api, apiCurrent, type ModelChoice, type Task, type TeamAgent, type TeamAgentInput } from '../api/client'
import { useStore } from '../store'
import { Button, Select, errText } from './form'
import { CtxBar, StBadge } from './ui'
import { agentModelLabel, choiceLabel, mergeDraft, roleColorVar, runnerName, stepVerb, tripleKey, tripleOf } from './roleLabels'

// Панель «Команда» дашборда Epic (add-agent-roles, спека web «Команда
// агентов на дашборде Epic»): агенты команды, а не runner'ы. На карточке
// имя, роль цветом шаблона, модель, что агент делает, над какой задачей и
// на каком runner'е. Тимлид — агент команды с отметкой о плане.
// Администратор меняет модель агента прямо на карточке.

export function teamInput(a: TeamAgent, patch: Partial<TeamAgentInput> = {}): TeamAgentInput {
  return {
    name: a.name, role_id: a.role_id, agent: a.agent, connection_id: a.connection_id, model: a.model,
    instruction_extra: a.instruction_extra, enabled: a.enabled, position: a.position, updated_at: a.updated_at, ...patch,
  }
}

// Статус карточки в системе статусов консоли: вид шага → статус задачи.
function agentStatus(a: TeamAgent): string {
  if (!a.enabled) return 'offline'
  if (!a.busy) return 'idle'
  if (a.step === 'decompose') return 'running'
  if (a.step === 'code') return a.step_entry === 'changes' ? 'fixing' : 'running'
  if (a.step === 'test') return 'testing'
  if (a.step === 'review') return 'review'
  return 'running'
}

// Поля агента, которые правит консоль; модель — ключ тройки (атомарно).
export type AgentFields = { name: string; role_id: string; model: string; instruction_extra: string; enabled: boolean }
export const AGENT_FIELD_LABEL: Record<keyof AgentFields, string> = {
  name: 'имя', role_id: 'шаблон', model: 'модель', instruction_extra: 'дополнение инструкции', enabled: 'включение',
}
export const agentFields = (a: TeamAgent): AgentFields => ({
  name: a.name, role_id: a.role_id, model: tripleKey(a), instruction_extra: a.instruction_extra, enabled: a.enabled,
})
// Тело запроса. Модель агента-тимлида — модель планировщика: пара уходит,
// только если администратор явно выбрал другую (не текущую модель агента и
// не модель планировщика из шаблона lead), иначе планировщик не трогается.
export function leadTriple(model: string, kept: string[]): { agent: string; connection_id: string; model: string } {
  return kept.includes(model) ? { agent: '', connection_id: '', model: '' } : tripleOf(model)
}
function agentBody(f: AgentFields, target: TeamAgent, planner: string): TeamAgentInput {
  const base = teamInput(target, { name: f.name, role_id: f.role_id, instruction_extra: f.instruction_extra, enabled: f.enabled })
  if (f.role_id === 'lead') return { ...base, ...leadTriple(f.model, [tripleKey(target), planner]) }
  return { ...base, ...tripleOf(f.model) }
}

export type AgentSaveResult = { saved: TeamAgent } | { conflicts: (keyof AgentFields)[]; current: TeamAgent }
// Сохранение агента от версии base с разбором 409 stale: свои правки
// накладываются на актуальную версию, общие с чужими поля требуют решения
// администратора (force). Подтверждение действует только для версии
// current: новая чужая правка показывает конфликты заново.
// planner — ключ модели планировщика (шаблон lead), нужен агенту-тимлиду.
export async function saveAgent(base: TeamAgent, draft: AgentFields, opts: { force?: boolean; current?: TeamAgent; planner?: string } = {}, depth = 0): Promise<AgentSaveResult> {
  const { force = false, current, planner = '' } = opts
  let fields = draft
  let target = base
  if (current) {
    const m = mergeDraft(agentFields(base), agentFields(current), draft)
    if (m.conflicts.length && !force) return { conflicts: m.conflicts, current }
    fields = m.fields
    target = current
  }
  try {
    return { saved: await api.updateTeamAgent(base.id, agentBody(fields, target, planner)) }
  } catch (e) {
    const cur = apiCurrent<TeamAgent>(e)
    if (!cur || depth >= 3) throw e
    return saveAgent(base, draft, { current: cur, planner }, depth + 1)
  }
}

// Смена модели на карточке: чужую правку агента сливает saveAgent; если
// модель уже поменял другой администратор, решение — сообщением.
export async function saveAgentModel(a: TeamAgent, key: string): Promise<TeamAgent> {
  const res = await saveAgent(a, { ...agentFields(a), model: key })
  if ('conflicts' in res) throw new Error(`модель агента ${res.current.name} уже поменял другой администратор: ${agentModelLabel(res.current, undefined)}`)
  return res.saved
}

// Варианты модели для агента. Шаблон control plane (Тимлид, Аналитик)
// работает без runner'а и профиля: модель — пара подключения и модели,
// повторы по профилям схлопываются; у Тимлида это модель планировщика.
export function modelOptions(choices: ModelChoice[], controlPlane: boolean): { key: string; label: string; offline: boolean }[] {
  if (!controlPlane) return choices.map(c => ({ key: tripleKey(c), label: choiceLabel(c) + (c.runner_online ? '' : ' · нет runner’а'), offline: !c.runner_online }))
  const seen = new Set<string>()
  const out: { key: string; label: string; offline: boolean }[] = []
  for (const c of choices) {
    const key = tripleKey({ agent: '', connection_id: c.connection_id, model: c.model })
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, label: `${c.connection_id}/${c.model}`, offline: false })
  }
  return out
}

export function TeamPanel({ epicId, tasks, planning, admin }: { epicId: string; tasks: Task[]; planning: boolean; admin: boolean }) {
  const { team, roleOf, refreshTeam, runners, refreshRunners, tick } = useStore()
  // Полоса контекста карточки — CtxPct runner'а сессии; он меняется по ходу
  // сессии без событий статуса, поэтому runner'ы перечитываются по tick,
  // пока кто-то работает, и всегда в запасном виде без команды.
  const anyBusy = team.some(a => a.busy)
  useEffect(() => { if (anyBusy || team.length === 0) refreshRunners() }, [tick, anyBusy, team.length, refreshRunners])
  const [choices, setChoices] = useState<ModelChoice[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null)

  // Варианты перечитываются при каждом открытии: runner'ы и привязки
  // профилей меняются, признак «нет runner'а» должен быть свежим.
  const openEditor = (id: string) => {
    setEditing(id); setErr(null)
    api.modelChoices().then(r => setChoices(r?.choices ?? [])).catch(e => setErr({ id, msg: errText(e) }))
  }
  const change = async (a: TeamAgent, key: string) => {
    setSaving(a.id); setErr(null)
    try { await saveAgentModel(a, key); refreshTeam() }
    catch (e) { setErr({ id: a.id, msg: errText(e) }); refreshTeam() }
    finally { setSaving(null) }
  }

  const working = team.filter(a => a.busy).length
  // Бэкенд без команды агентов (/team недоступен): прежний вид — runner'ы.
  if (team.length === 0) {
    const online = runners.filter(r => r.Status !== 'offline')
    return (
      <aside className="rail">
        <div className="rail-head"><h2>Runner’ы</h2><span className="n">{online.length} online</span></div>
        <div className="rail-body">
          {online.map(r => {
            const task = r.TaskID ? tasks.find(t => t.ID === r.TaskID) : undefined
            return (
              <div key={r.ID} className="runner-card" data-runner={r.ID}>
                <div className="rc-top">
                  <span className="name">{runnerName(r)}</span>
                  <span className="muted" style={{ fontSize: 10.5 }}>{r.Model || r.Agent}</span>
                  <StBadge s={r.Status} />
                </div>
                {r.TaskID && <div className="rc-action mono">{task ? `task-${task.Num}` : 'занят'}</div>}
                {r.TaskID && <CtxBar pct={r.CtxPct} />}
              </div>
            )
          })}
        </div>
      </aside>
    )
  }
  return (
    <aside className="rail">
      <div className="rail-head"><h2>Команда</h2><span className="n">{working} в работе · {team.filter(a => a.enabled).length} агентов</span></div>
      <div className="rail-body">
        {team.map(a => {
          const role = roleOf(a.role_id)
          // Тимлид — отметка о плане и модель планировщика; прочие шаблоны
          // control plane — без профиля и runner'а.
          const lead = a.role_id === 'lead'
          const cp = role?.control_plane ?? lead
          const task = a.task_id ? tasks.find(t => t.ID === a.task_id) : undefined
          const runner = a.runner_name || a.runner_id
          // Тимлид составляет план этого Epic: по /team (busy, шаг decompose,
          // Epic агента) — видят все зрители; локальный флаг нажавшего —
          // мгновенная подсказка до прихода события epic.decomposing.
          const planningHere = lead && ((a.busy && a.step === 'decompose' && a.epic_id === epicId) || planning)
          const ctx = a.busy && a.runner_id ? runners.find(r => r.ID === a.runner_id)?.CtxPct ?? null : null
          const opts = choices ? modelOptions(choices, cp) : []
          const cur = cp ? tripleKey({ agent: '', connection_id: a.connection_id, model: a.model }) : tripleKey(a)
          const curOpt = opts.find(o => o.key === cur)
          return (
            <div key={a.id} className={'runner-card team-card' + (a.enabled ? '' : ' off') + (lead ? ' lead-card' : '')}
              data-agent={a.id} data-role={a.role_id} style={{ ['--rc' as string]: roleColorVar(a.color || role?.color) }}>
              <div className="rc-top">
                <span className="rc-who name"><span className="dot" />{a.name}</span>
                <span className="rc-role">{a.role_title || role?.title || a.role_id}</span>
                <StBadge s={lead && planningHere ? 'running' : agentStatus(a)} />
              </div>
              <div className="rc-action">
                {!a.enabled ? 'выключен'
                  : lead ? (planningHere ? 'составляет план…'
                    : a.busy && a.step === 'decompose' ? 'составляет план другого Epic'
                    : tasks.length > 0 ? 'план составлен' : 'план не составлен')
                  : a.busy
                    ? <>
                        {task ? <span className="mono">task-{task.Num}</span>
                          : a.task_num ? <span className="mono" title="задача другого Epic">task-{a.task_num} · другой Epic</span>
                          : a.epic_id && a.epic_id !== epicId ? 'в другом Epic' : null}
                        {(task || a.task_num || (a.epic_id && a.epic_id !== epicId)) ? ' · ' : ''}{stepVerb(a.step, a.step_entry)}
                        {runner && <span className="perf-runner">на {runner}</span>}
                      </>
                    : 'свободен'}
              </div>
              <div className="rc-model">
                {editing === a.id
                  ? <>
                      <Select size="sm" aria-label={`модель агента ${a.name}`} value={cur} disabled={!choices || saving === a.id}
                        onChange={e => change(a, e.target.value)}>
                        {!lead && <option value="">{role?.model ? `как в шаблоне (${role.model})` : 'как в шаблоне'}</option>}
                        {lead && !cur && <option value="">модель из окружения</option>}
                        {cur && !curOpt && <option value={cur}>{agentModelLabel(a, role)}</option>}
                        {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </Select>
                      <Button variant="quiet" size="sm" aria-label="закрыть выбор модели" onClick={() => setEditing(null)}>✕</Button>
                    </>
                  : <>
                      <span title={lead ? 'модель Тимлида — модель планировщика' : undefined}>
                        {lead ? (a.model ? `${a.connection_id}/${a.model}` : 'модель из окружения') : cp && a.model ? `${a.connection_id}/${a.model}` : agentModelLabel(a, role)}
                      </span>
                      {admin && a.enabled && <Button variant="quiet" size="sm" aria-label={`сменить модель агента ${a.name}`} title="сменить модель"
                        onClick={() => openEditor(a.id)}>✎</Button>}
                    </>}
              </div>
              {a.busy && a.runner_id && <CtxBar pct={ctx} />}
              {editing === a.id && curOpt?.offline && (
                <div className="model-warn" role="status">нет online runner’а с профилем {tripleOf(cur).agent}: задачи этого агента будут ждать</div>
              )}
              {err?.id === a.id && <div className="f-error" role="alert">{err.msg}</div>}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
