import type { AgentLimits, AgentModelRef, ConnectionPreset, Runner } from '../api/client'

// Агент Rivet и подключения (add-native-agent): чистые функции без React,
// чтобы проверяться юнит-тестом.

// Идентификатор агента Rivet, то же, что RIVET_AGENT в api/client.ts
// (тест под node не грузит модуль API).
const RIVET = 'rivet'

// ─── runner'ы ───────────────────────────────────────────────────────────

// Runner выкатки работает без агента: исполняет только задания выкатки.
type RunnerKind = Pick<Runner,'Agent'> & Partial<Pick<Runner,'Capabilities'|'Features'>>
export const isLoadRunner = (r:RunnerKind):boolean => !r.Agent && r.Capabilities?.length===1 && r.Capabilities[0]==='load' && !!r.Features?.includes('k6_load_v1')
export const isDeployRunner = (r:RunnerKind):boolean => !r.Agent && !r.Capabilities?.includes('load')

// Команды агента Rivet на этом runner'е идут без песочницы и видят сеть.
export const agentNetworkOpen = (r: Pick<Runner, 'Agent' | 'NetworkIsolated'>): boolean =>
  r.Agent === RIVET && !r.NetworkIsolated

export interface AgentRunnerStats { total: number; online: number; isolated: number; deploy: number }
// Счётчики runner'ов агента Rivet: всего, в сети, с песочницей без сети;
// runner'ы выкатки считаются отдельно.
export function agentRunnerStats(runners: (Pick<Runner, 'Agent' | 'Status' | 'NetworkIsolated'> & Partial<Pick<Runner,'Capabilities'|'Features'>>)[]): AgentRunnerStats {
  const out = { total: 0, online: 0, isolated: 0, deploy: 0 }
  for (const r of runners) {
    if (isDeployRunner(r)) { out.deploy++; continue }
    if (r.Agent !== RIVET) continue
    out.total++
    if (r.Status !== 'offline') out.online++
    if (r.NetworkIsolated) out.isolated++
  }
  return out
}

// ─── лимиты сессии ──────────────────────────────────────────────────────

// Значения цикла по умолчанию (native.DefaultLimits в rivet-runner):
// только для подсказки, решает их сам runner.
export const DEFAULT_LIMITS = { turns: 80, tokens: 1_000_000, minutes: 30 }

// Черновик лимитов строками: пустая строка — значение по умолчанию.
export interface LimitsDraft { turns: string; tokens: string; minutes: string }
export const limitsDraft = (l: AgentLimits | null | undefined): LimitsDraft => ({
  turns: l?.max_turns ? String(l.max_turns) : '',
  tokens: l?.max_tokens ? String(l.max_tokens) : '',
  minutes: l?.max_minutes ? String(l.max_minutes) : '',
})

// Разбор черновика: целое больше нуля или пусто. Ошибки по полям.
export function parseLimits(d: LimitsDraft): { limits: AgentLimits; errors: Partial<Record<keyof LimitsDraft, string>> } {
  const limits: AgentLimits = {}
  const errors: Partial<Record<keyof LimitsDraft, string>> = {}
  const keys: [keyof LimitsDraft, keyof AgentLimits][] = [['turns', 'max_turns'], ['tokens', 'max_tokens'], ['minutes', 'max_minutes']]
  for (const [k, field] of keys) {
    const s = d[k].trim().replace(/[\s_]/g, '')
    if (!s) continue
    if (!/^\d+$/.test(s) || Number(s) <= 0 || !Number.isSafeInteger(Number(s))) {
      errors[k] = 'целое число больше нуля; пусто — по умолчанию'
      continue
    }
    limits[field] = Number(s)
  }
  return { limits, errors }
}

// ─── модели ─────────────────────────────────────────────────────────────

// Ключ пары «подключение/модель». Идентификатор подключения без «/», а
// модель может его содержать (anthropic/claude-… у агрегатора).
export const refKey = (m: Pick<AgentModelRef, 'connection_id' | 'model'>): string => `${m.connection_id}/${m.model}`
export function refOf(key: string): AgentModelRef | null {
  const i = key.indexOf('/')
  if (i <= 0 || i === key.length - 1) return null
  return { connection_id: key.slice(0, i), model: key.slice(i + 1) }
}
export const refLabel = (m: Pick<AgentModelRef, 'connection_id' | 'model'>): string => `${m.connection_id} / ${m.model}`

// ─── пресеты подключений ────────────────────────────────────────────────

// Свободный идентификатор подключения по пресету: id пресета, а если он
// занят — с числовым суффиксом.
export function presetConnectionId(p: Pick<ConnectionPreset, 'id'>, taken: string[]): string {
  if (!taken.includes(p.id)) return p.id
  for (let n = 2; ; n++) {
    const id = `${p.id}-${n}`
    if (!taken.includes(id)) return id
  }
}

// Подключение уже заведено по этому пресету: тот же адрес провайдера.
export const presetInUse = (p: Pick<ConnectionPreset, 'base_url'>, conns: { base_url: string }[]): boolean => {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()
  return conns.some(c => norm(c.base_url) === norm(p.base_url))
}

// Пресет уходит серверу, только если тип API и адрес — его же: иначе
// модели пресета приклеились бы к другому провайдеру. У пресета без своих
// моделей (Ollama, LM Studio) адрес можно поменять, например на сервер в
// соседней машине: из пресета сервер берёт только незаполненные поля.
export function presetForSave(p: Pick<ConnectionPreset, 'id' | 'api' | 'base_url' | 'models'>, input: { api: string; base_url: string }): string | undefined {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()
  if (p.api !== input.api) return undefined
  if (p.models.length > 0 && norm(p.base_url) !== norm(input.base_url)) return undefined
  return p.id
}

// Число токенов в поле каталога моделей: целое больше нуля или пусто.
export function parseTokens(s: string): { value?: number; error?: string } {
  const t = s.trim().replace(/[\s_]/g, '')
  if (!t) return {}
  if (!/^\d+$/.test(t) || Number(t) <= 0 || !Number.isSafeInteger(Number(t))) return { error: 'целое число токенов больше нуля' }
  return { value: Number(t) }
}

// ─── ошибки форм ────────────────────────────────────────────────────────

// Поле ошибки API нарисовано формой: совпадает с полем формы или вложено в
// него (limits.max_turns у поля limits, models[0].id у models). Ошибку
// поля, которого форма не рисует (preset, adapter), форма показывает общей
// заметкой, а не теряет.
export function fieldShown(field: string | undefined, shown: readonly string[]): boolean {
  if (!field) return false
  return shown.some(f => field === f || field.startsWith(f + '.') || field.startsWith(f + '['))
}

// ─── устаревшие переопределения политики проекта ────────────────────────

export interface StaleOverride {
  // Путь в переопределениях: agent_models.<id> или role_models.<id>.
  path: string
  kind: 'agent' | 'role'
  id: string
  // Было: подключение/модель переопределения.
  value: string
  reason: string
  // blocking — сервер не примет новую версию политики с этим ключом.
  // Переопределение выключенного агента Rivet сервер принимает: оно не
  // действует, пока агент выключен, но снимать его не обязательно.
  blocking: boolean
}

type ModelRefLike = { connection_id: string; model: string }

// Переопределения проекта, которых форма политик не рисует: модель агента,
// которого нет в каталоге или у которого нет моделей (после add-native-agent
// остался только агент Rivet), и модель роли без строки в форме (шаблона нет,
// он выключен или у его агента нет моделей). Форма шлёт переопределения
// целиком, и сервер не принял бы версию с такими ключами, поэтому они
// показываются с действием «снять». Выключенного агента Rivet в каталоге
// политики нет (сервер отдаёт только включённых), но его переопределение
// валидно: оно показывается без блокировки. shownRoles = null — роли или
// выбор моделей ещё грузятся либо выбор не загрузился, роли не проверяются.
export function staleOverrides(
  ov: { agent_models?: Record<string, ModelRefLike> | null; role_models?: Record<string, ModelRefLike & { agent?: string }> | null },
  agents: Record<string, { models: unknown[] }> | undefined,
  shownRoles: readonly string[] | null,
): StaleOverride[] {
  const out: StaleOverride[] = []
  const val = (m: ModelRefLike | undefined) => m ? `${m.connection_id}/${m.model}` : ''
  for (const [id, m] of Object.entries(ov.agent_models ?? {})) {
    const view = agents?.[id]
    if (view && view.models.length > 0) continue
    if (!view && id === RIVET) {
      out.push({ path: `agent_models.${id}`, kind: 'agent', id, value: val(m), blocking: false,
        reason: 'агент Rivet выключен администратором, переопределение заработает, когда его включат' })
      continue
    }
    out.push({ path: `agent_models.${id}`, kind: 'agent', id, value: val(m), blocking: true,
      reason: view ? 'у агента нет моделей в каталоге подключений' : 'агента нет в каталоге: поддерживается только агент Rivet' })
  }
  if (shownRoles) {
    for (const [id, m] of Object.entries(ov.role_models ?? {})) {
      if (shownRoles.includes(id)) continue
      out.push({ path: `role_models.${id}`, kind: 'role', id, value: val(m), blocking: true,
        reason: 'шаблона роли нет, он выключен или у его агента нет моделей' })
    }
  }
  return out
}

// Без переопределения по пути: копия переопределений, пустой словарь — null.
export function dropOverride<T extends { agent_models?: Record<string, unknown> | null; role_models?: Record<string, unknown> | null }>(ov: T, s: Pick<StaleOverride, 'kind' | 'id'>): T {
  const key = s.kind === 'agent' ? 'agent_models' : 'role_models'
  const next = { ...(ov[key] ?? {}) }
  delete next[s.id]
  return { ...ov, [key]: Object.keys(next).length ? next : null }
}
