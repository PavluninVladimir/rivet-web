import type { AgentRole, ModelChoice, RoleRef, Runner, TeamAgent } from '../api/client'

// Подписи команды агентов (add-agent-roles): чистые функции без React,
// чтобы проверяться юнит-тестом. Всё деградирует к прежнему виду, если
// бэкенд новых полей не отдаёт.

// Имя runner'а (инфраструктура): отображаемое имя, без него идентификатор.
export function runnerName(r: Pick<Runner, 'ID' | 'DisplayName'> | undefined, fallbackId = ''): string {
  return r?.DisplayName?.trim() || r?.ID || fallbackId
}

// Подпись исполнителя: главное — «Роль Имя агента», runner — мелкой
// припиской. Без агента команды — роль и runner, без роли — runner.
export function performerParts(roleTitle: string | undefined, agentName: string | undefined, runner: string | undefined): { main: string; sub: string } {
  const agent = agentName?.trim() ?? ''
  const run = runner?.trim() ?? ''
  if (agent) return { main: roleTitle ? `${roleTitle} ${agent}` : agent, sub: run }
  if (roleTitle) return { main: roleTitle, sub: run }
  return { main: run, sub: '' }
}

// Действие агента по виду шага и входу в него: вход по changes на шаг
// кода — исправление.
export function stepVerb(step: string | undefined, entry?: string): string {
  switch (step) {
    case 'code': return entry === 'changes' ? 'исправляет' : 'пишет код'
    case 'test': return 'пишет тесты'
    case 'review': return 'проверяет'
    case 'prompt': return 'выполняет шаг'
    case 'deploy': return 'выкатывает'
    case 'decompose': return 'составляет план'
    default: return 'работает'
  }
}

// Цвет роли — токен палитры консоли; неизвестный цвет приглушён.
const KNOWN_COLORS = new Set(['blue', 'violet', 'green', 'amber', 'rose', 'teal', 'indigo', 'slate'])
export function roleColorVar(color: string | undefined): string {
  return color && KNOWN_COLORS.has(color) ? `var(--role-${color})` : 'var(--muted)'
}

// ─── модели: тройка «профиль, подключение, модель» ─────────────────────

export interface ModelTriple { agent: string; connection_id: string; model: string }
export const tripleKey = (t: Partial<ModelTriple> | null | undefined): string =>
  t && (t.agent || t.connection_id || t.model) ? `${t.agent ?? ''}|${t.connection_id ?? ''}|${t.model ?? ''}` : ''
export function tripleOf(key: string): ModelTriple {
  const [agent = '', connection_id = '', model = ''] = key ? key.split('|') : []
  return { agent, connection_id, model }
}
export function choiceLabel(c: Pick<ModelChoice, 'agent' | 'agent_name' | 'connection_id' | 'model'>): string {
  return `${c.agent_name || c.agent} / ${c.connection_id}/${c.model}`
}

// Модель агента команды строкой: своя тройка, иначе модель шаблона.
export function agentModelLabel(a: Pick<TeamAgent, 'agent' | 'connection_id' | 'model'>, role: Pick<AgentRole, 'agent' | 'model'> | undefined): string {
  if (a.model) return a.agent ? `${a.agent} / ${a.model}` : a.model
  if (role?.model) return `${role.model} (шаблон)`
  return 'как в шаблоне'
}

// ─── ссылки на шаблон в отказе удаления и выключения ───────────────────

export function refText(r: RoleRef): string {
  const where = r.scope === 'installation' ? 'установка' : `проект ${r.project_name || r.project_id || '?'}`
  if (r.kind === 'agent') return `агент команды ${r.agent_name || r.agent_id || '?'}`
  if (r.kind === 'role_model') return `${where}: переопределение модели роли`
  return `${where}, шаг ${r.step || '?'}`
}

// ─── черновик формы и чужие правки ─────────────────────────────────────

// mergeDraft накладывает поля, которые администратор менял в форме
// (относительно версии на момент открытия), на актуальную версию записи
// (ответ 409 stale). Поле, которое за это время поменял и кто-то другой,
// попадает в conflicts: молча перезаписывать его нельзя. Связанные поля
// (профиль и модель) сливаются группой: своя правка любого забирает всю
// группу из черновика, чужая правка группы — конфликт.
export function mergeDraft<T extends Record<string, unknown>>(base: T, fresh: T, draft: T, linked: (keyof T)[][] = []): { fields: T; conflicts: (keyof T)[] } {
  const fields = { ...fresh }
  const conflicts: (keyof T)[] = []
  const inGroup = new Set(linked.flat())
  const groups: (keyof T)[][] = [...linked, ...(Object.keys(draft) as (keyof T)[]).filter(k => !inGroup.has(k)).map(k => [k])]
  for (const g of groups) {
    if (g.every(k => draft[k] === base[k])) continue
    const theirs = g.some(k => fresh[k] !== base[k])
    const same = g.every(k => fresh[k] === draft[k])
    if (theirs && !same) conflicts.push(...g)
    for (const k of g) fields[k] = draft[k]
  }
  return { fields, conflicts }
}

// ─── вердикты агента и проверок ─────────────────────────────────────────

// Подпись к участнику вердикта шага по собственному вердикту агента
// (agent_verdict, у тестировщика): одобрил, но проверки не прошли, вернул
// замечания или сбой инфраструктуры. Совпадение с итогом подписи не даёт.
export function agentVerdictNote(agentVerdict: string | undefined, verdict: string | undefined): string {
  if (!agentVerdict) return ''
  if (agentVerdict === 'error') return 'сбой инфраструктуры'
  if (agentVerdict === 'changes' || agentVerdict === 'fail') return 'вернул замечания'
  if (agentVerdict === 'ok' && (verdict === 'changes' || verdict === 'fail')) return 'одобрил, проверки не прошли'
  return ''
}

// Подпись вердикта запуска: error — сбой инфраструктуры, не замечания.
export function verdictLabel(verdict: string | undefined): string {
  if (!verdict) return 'ждёт'
  return verdict === 'error' ? 'сбой инфраструктуры' : verdict
}

// ─── живые события команды ──────────────────────────────────────────────

// Занятость агента уровня установки (team.agent_busy, team.agent_free)
// приходит со всей установки, на каждую стадию любого проекта. По ней
// перечитываются только команда и runner'ы, а не текущий экран.
export const AGENT_WORK_EVENTS: readonly string[] = ['team.agent_busy', 'team.agent_free']

export function isAgentWorkEvent(type: string): boolean {
  return AGENT_WORK_EVENTS.includes(type)
}
