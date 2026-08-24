// Клиент api-contract v1. Ключи JSON соответствуют полям Go-структур.

export type TaskStatus =
  | 'queued' | 'ready' | 'running' | 'testing' | 'review'
  | 'fixing' | 'blocked' | 'failed' | 'done' | 'cancelled'

export interface Criterion { text: string; ok: boolean }

export interface Task {
  ID: string; EpicID: string; Num: number
  Title: string; Description: string
  Status: TaskStatus; Estimate: number
  Capabilities: string[]; Criteria: Criterion[] | null; Deps: string[] | null
  AttemptUsed: number; AttemptLimit: number
  // Отказы review с последнего решения человека; лимит — из политики
  // проекта (api-contract add-policy-presets).
  ReviewRejections: number
  RunnerID: string; Branch: string; PRURL: string; BlockReason: string
  Created: string; Updated: string
}

export interface Epic {
  ID: string; ProjectID: string; Title: string; Goal: string
  Status: 'planned' | 'running' | 'paused' | 'done' | 'archived'
  Created: string
}

// Usage-агрегат (api-contract add-usage-metering): null = данных нет,
// показывается как «—», не как 0.
export interface UsageRow {
  key: string
  // Название проекта, Epic или задачи для соответствующих группировок
  // (api-contract add-operations-management); для runner'а и модели = key.
  label?: string
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  duration_s: number
}

export interface EpicView extends Epic {
  tasks: Task[] | null
  progress: { pct: number; weighted: boolean }
  usage?: UsageRow[] | null      // вклад задач (key = id задачи)
  usage_total?: UsageRow | null  // итог по Epic
}

export interface Project {
  ID: string; Name: string; Created: string
  Checks?: { name: string; cmd: string }[] | null
  // Подключённый репозиторий (api-contract add-repo-onboarding); Repo
  // сохраняется для совместимости и повторяет repo_path.
  Repo: string
  provider: string
  base_url: string
  repo_path: string
  default_branch: string
  web_url: string
  // Дневной бюджет токенов (api-contract add-policy-presets): лимит из
  // действующей политики, засчитано сегодня (UTC), пауза планирования до.
  budget?: BudgetState
}

export interface BudgetState {
  daily_tokens: number | null
  used_today: number
  paused_until: string | null
  paused_scope?: 'project' | 'installation'
}

// Пауза по бюджету действует, пока не наступили следующие сутки: событие
// о снятии паузы не приходит, поэтому срок проверяется на клиенте.
export function budgetPaused(b: BudgetState | undefined, now = Date.now()): boolean {
  return !!b?.paused_until && new Date(b.paused_until).getTime() > now
}

// ─── политики конвейера (api-contract add-policy-presets) ───────────────

// Полный документ пресетов (установка и действующая политика проекта).
export interface Presets {
  auto_merge: boolean
  human_review_paths: string[]
  attempt_limit: number
  review_limit: number
  daily_token_budget: number | null // null — без ограничения
  auto_publish: boolean
}

// Переопределения проекта: null — наследуется от установки;
// daily_token_budget: 0 — переопределено на «без ограничения».
export interface Overrides {
  auto_merge: boolean | null
  human_review_paths: string[] | null
  attempt_limit: number | null
  review_limit: number | null
  daily_token_budget: number | null
  auto_publish: boolean | null
}

export interface PolicyVersion {
  id: string
  scope: 'installation' | 'project'
  project_id: string | null
  version: number
  hash: string
  content: Presets | Overrides
  created_at: string
  created_by: string
}

export interface InstallationPolicy { version: PolicyVersion | null; presets: Presets }

export interface ProjectPolicy {
  effective: Presets
  effective_hash: string
  overrides: Overrides
  version: PolicyVersion | null
  installation_version: PolicyVersion | null
}

export interface Check { name: string; cmd: string }

// Результат проверки подключения: причина отказа различается по смыслу,
// чтобы показать её пользователю рядом с полем.
export interface ProbeResult {
  ok: boolean
  reason: '' | 'not_found' | 'no_access' | 'insufficient_scope' | 'unreachable' | 'bad_token' | string
  message: string
  token_owner: string
  repo_path: string
  base_url: string
  default_branch: string
  can_push: boolean
  can_merge_request: boolean
}

export interface RepositoryStatus {
  provider: string
  base_url: string
  repo_path: string
  default_branch: string
  web_url: string
  credential: { owner: string; token_prefix: string; added_at: string } | null
  state: 'ok' | 'invalid' | 'unchecked' | string
  checked_at: string | null
  webhook: { registered: boolean; url: string; secret_hint: string }
}

// Вход создания проекта: либо repo_url (подключить), либо create (создать).
export interface CreateProjectInput {
  name: string
  provider: string
  repo_url?: string
  base_url?: string
  token?: string
  checks?: Check[]
  create?: { owner: string; repo_name: string; visibility: 'private' | 'public' }
}

export interface Runner {
  ID: string; Agent: string; Model: string; Host: string
  Capabilities: string[]; Status: string; TaskID: string
  CtxPct: number | null // null — заполненность контекста неизвестна
  Draining: boolean; LastSeen: string
  // Адаптер подключения агента и глубина его данных.
  Adapter: string
  Depth: 'full' | 'partial' | 'minimal' | string
}

export interface Event {
  ID: number; TS: string; ActorKind: string; ActorID: string
  Type: string; ProjectID: string; EpicID: string; TaskID: string; Text: string
  // Структурированные данные события (версия политики, причина отложенного
  // merge и т.п.); отсутствует, если событие их не несёт.
  Payload?: Record<string, unknown>
}

export interface Attention {
  ID: string; ProjectID: string; TaskID: string
  DeploymentID: string // эскалация публикации (DEPLOY_FAILED): задачи нет
  Reason: string; Message: string; Status: string; ClaimedBy: string; Created: string
}

// Роль участника проекта (api-contract add-user-management): owner меняет
// настройки проекта, member работает с задачами.
export type Role = 'owner' | 'member'

export interface Member {
  login: string
  name: string
  role: Role
  added_at: string
}

export interface User {
  id: string
  login: string
  name: string
  admin: boolean
  disabled: boolean
  created_at: string
  must_change_password: boolean
}

// Метаданные PAT; секрет приходит один раз при создании.
export interface AccessToken {
  id: string
  name: string
  prefix: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
}

// Окружение публикации (api-contract implement-deployment): config без
// секретов, настройка — только администратор, запуск — участники.
export interface EnvConfig {
  host?: string
  deploy_cmd: string
  verify_cmd?: string
  verify_url?: string
}

export interface Environment {
  id: string
  project_id: string
  name: string
  exec_type: 'ssh' | string
  trigger: 'auto' | 'manual'
  config: EnvConfig
  paused: boolean
  last_deployment: Deployment | null
  created_at: string
}

// Публикация: created_at — очередь, started_at — исполнение (длительность
// клиент считает из started_at/ended_at, ожидание в неё не входит).
export interface Deployment {
  id: string
  env_id: string
  version: string
  status: 'queued' | 'deploying' | 'verifying' | 'done' | 'failed' | 'rolled_back' | string
  initiator: string
  runner_id: string
  detail: string
  has_log: boolean
  created_at: string
  started_at: string | null
  ended_at: string | null
}

// Сессия задачи (api-contract add-session-visibility): tokens null =
// источник не сообщил (не ноль), длительность считается из started_at/ended_at.
export interface Session {
  id: string
  attempt: number
  stage: 'coding' | 'testing' | 'review' | 'fix' | string
  agent: string
  model: string
  driver_kind: 'scheduler' | 'user'
  // Глубина данных подключения и затронутые файлы (api-contract
  // add-claude-code-adapter): files === null — недоступно для этого
  // способа подключения, [] — полная глубина без файлов.
  depth: 'full' | 'partial' | 'minimal' | string
  files: string[] | null
  tokens: number | null
  started_at: string
  ended_at: string | null
  has_transcript: boolean
}

// Payload события session.step (подключения полной глубины): инструмент,
// краткий аргумент, файлы, признак ошибки.
export interface StepPayload {
  kind?: 'tool' | 'stop' | 'note' | string
  tool?: string
  detail?: string
  files?: string[]
  ok?: boolean
  session_id?: string
}

// Обработчик 401: консоль уводит на экран входа (спека web
// «Вход в консоль»); hash-маршрут сохраняется, после входа пользователь
// возвращается на ту же страницу.
let onUnauthorized: () => void = () => {}
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn }

// Пароль сброшен администратором: до смены API отвечает 403 с этим кодом,
// консоль показывает форму смены (api-contract add-user-management).
let onPasswordChangeRequired: () => void = () => {}
export function setOnPasswordChangeRequired(fn: () => void) { onPasswordChangeRequired = fn }

function apiCode(data: unknown): string {
  return (data as { error?: { code?: string } })?.error?.code ?? ''
}

// ApiError несёт машиночитаемый код конверта ошибки (no_planner,
// planner_invalid, no_secret_key…): консоль подбирает подсказку по нему.
export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function errCode(e: unknown): string {
  return e instanceof ApiError ? e.code : ''
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Аутентификация — httpOnly-cookie сессии, браузер шлёт её сам (same-origin).
  const resp = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  // 204 приходит без тела: json() на нём падает.
  const data = resp.status === 204 ? null : await resp.json().catch(() => null)
  if (!resp.ok) {
    if (resp.status === 401 && path !== '/auth/login') onUnauthorized()
    if (resp.status === 403 && apiCode(data) === 'password_change_required') onPasswordChangeRequired()
    const msg = (data as { error?: { message?: string } })?.error?.message ?? resp.statusText
    throw new ApiError(msg, apiCode(data), resp.status)
  }
  return data as T
}

// Транскрипт приходит как text/plain, а не JSON — отдельный путь без
// разбора тела (ошибки сервер по-прежнему шлёт JSON-конвертом).
async function reqText(path: string): Promise<string> {
  const resp = await fetch(`/api/v1${path}`)
  if (!resp.ok) {
    if (resp.status === 401) onUnauthorized()
    const data = await resp.json().catch(() => null)
    const msg = (data as { error?: { message?: string } })?.error?.message ?? resp.statusText
    throw new Error(msg)
  }
  return resp.text()
}

export const api = {
  login: (login: string, password: string) => req<User>('POST', '/auth/login', { login, password }),
  logout: () => req('POST', '/auth/logout'),
  me: () => req<User>('GET', '/auth/me'),
  projects: () => req<Project[] | null>('GET', '/projects'),
  createProject: (input: CreateProjectInput) => req<Project>('POST', '/projects', input),
  patchProject: (id: string, patch: { name?: string; checks?: Check[] }) =>
    req<Project>('PATCH', `/projects/${id}`, patch),
  probe: (input: { provider: string; repo_url?: string; base_url?: string; token: string }) =>
    req<ProbeResult>('POST', '/scm/probe', input),
  repository: (projectId: string) => req<RepositoryStatus>('GET', `/projects/${projectId}/repository`),
  replaceCredentials: (projectId: string, token: string) =>
    req<RepositoryStatus>('PUT', `/projects/${projectId}/credentials`, { token }),
  members: (projectId: string) => req<Member[] | null>('GET', `/projects/${projectId}/members`),
  addMember: (projectId: string, login: string, role: Role = 'member') =>
    req('POST', `/projects/${projectId}/members`, { login, role }),
  setMemberRole: (projectId: string, login: string, role: Role) =>
    req('PATCH', `/projects/${projectId}/members/${login}`, { role }),
  removeMember: (projectId: string, login: string) =>
    req('DELETE', `/projects/${projectId}/members/${login}`),
  // Управление приложением: пользователи установки (только администратор).
  users: () => req<User[] | null>('GET', '/users'),
  createUser: (input: { login: string; name: string; password: string; admin: boolean }) =>
    req<User>('POST', '/users', input),
  patchUser: (id: string, patch: { name?: string; disabled?: boolean; admin?: boolean }) =>
    req<User>('PATCH', `/users/${id}`, patch),
  resetPassword: (id: string) => req<{ password: string }>('POST', `/users/${id}/password/reset`),
  // Профиль: своя смена пароля и свои токены.
  changePassword: (current: string, next: string) =>
    req<void>('POST', '/auth/password', { current, new: next }),
  tokens: () => req<AccessToken[] | null>('GET', '/tokens'),
  createToken: (name: string, expiresAt?: string) =>
    req<{ token: AccessToken; secret: string }>('POST', '/tokens',
      { name, expires_at: expiresAt ?? null }),
  deleteToken: (id: string) => req('DELETE', `/tokens/${id}`),
  epics: (projectId: string) => req<Epic[] | null>('GET', `/projects/${projectId}/epics`),
  createEpic: (projectId: string, title: string, goal: string) =>
    req<Epic>('POST', `/projects/${projectId}/epics`, { title, goal }),
  decompose: (epicId: string) => req<{ tasks: Task[] }>('POST', `/epics/${epicId}/decompose`),
  epic: (id: string) => req<EpicView>('GET', `/epics/${id}`),
  epicAction: (id: string, action: 'start' | 'pause' | 'resume' | 'archive') =>
    req('POST', `/epics/${id}/${action}`),
  addTask: (epicId: string, t: { title: string; description: string; criteria: string[]; deps: string[] }) =>
    req<Task>('POST', `/epics/${epicId}/tasks`, t),
  task: (id: string) => req<{ task: Task; timeline: Event[] | null }>('GET', `/tasks/${id}`),
  patchTask: (id: string, patch: { attempt_limit: number }) => req<Task>('PATCH', `/tasks/${id}`, patch),
  taskSessions: (id: string) => req<Session[]>('GET', `/tasks/${id}/sessions`),
  sessionTranscript: (id: string) => reqText(`/sessions/${id}/transcript`),
  environments: (projectId: string) => req<Environment[]>('GET', `/projects/${projectId}/environments`),
  createEnvironment: (projectId: string, e: { name: string; trigger: string; config: EnvConfig }) =>
    req<Environment>('POST', `/projects/${projectId}/environments`, { ...e, exec_type: 'ssh' }),
  patchEnvironment: (id: string, e: { name?: string; trigger?: string; config?: EnvConfig }) =>
    req<Environment>('PATCH', `/environments/${id}`, e),
  deleteEnvironment: (id: string) => req('DELETE', `/environments/${id}`),
  deploy: (envId: string) => req<Deployment>('POST', `/environments/${envId}/deploy`),
  resumeEnv: (envId: string) => req<Environment>('POST', `/environments/${envId}/resume`),
  deployments: (envId: string) => req<Deployment[]>('GET', `/environments/${envId}/deployments`),
  deploymentLog: (id: string) => reqText(`/deployments/${id}/log`),
  answer: (id: string, text: string) => req('POST', `/tasks/${id}/answer`, { text }),
  retry: (id: string) => req('POST', `/tasks/${id}/retry`),
  cancel: (id: string) => req('POST', `/tasks/${id}/cancel`),
  merge: (id: string) => req('POST', `/tasks/${id}/merge`),
  attention: () => req<Attention[] | null>('GET', '/attention'),
  claim: (id: string) => req('POST', `/attention/${id}/claim`),
  runners: () => req<Runner[] | null>('GET', '/runners'),
  drain: (id: string, on: boolean) => req('POST', `/runners/${id}/${on ? 'drain' : 'undrain'}`),
  events: (q: { project?: string; epic?: string; task?: string; type?: string; cursor?: number; limit?: number; scope?: 'installation' }) => {
    const p = new URLSearchParams()
    if (q.project) p.set('project', q.project)
    if (q.epic) p.set('epic', q.epic)
    if (q.task) p.set('task', q.task)
    if (q.type) p.set('type', q.type)
    if (q.cursor) p.set('cursor', String(q.cursor))
    if (q.limit) p.set('limit', String(q.limit))
    if (q.scope) p.set('scope', q.scope)
    return req<Event[] | null>('GET', `/events?${p}`)
  },
  usage: (groupBy: string, period?: { from?: string; to?: string }, scope?: 'installation') => {
    const p = new URLSearchParams({ group_by: groupBy })
    if (period?.from) p.set('from', period.from)
    if (period?.to) p.set('to', period.to)
    if (scope) p.set('scope', scope)
    return req<UsageRow[] | null>('GET', `/usage?${p}`)
  },
  // Эксплуатация установки (api-contract add-operations-management), только администратору.
  systemStatus: () => req<SystemStatus>('GET', '/system/status'),
  runnerTokens: () => req<RunnerToken[]>('GET', '/runner-tokens'),
  createRunnerToken: (name: string, expires_at?: string) =>
    req<{ token: RunnerToken; secret: string }>('POST', '/runner-tokens', { name, expires_at }),
  revokeRunnerToken: (id: string) => req<void>('DELETE', `/runner-tokens/${id}`),
  models: () => req<{ source: PlannerSource; providers: LLMProvider[] }>('GET', '/system/models'),
  putModel: (provider: string, patch: { key?: string; model?: string; active?: boolean }) =>
    req<LLMProvider>('PUT', `/system/models/${provider}`, patch),
  checkModel: (provider: string) => req<LLMProvider>('POST', `/system/models/${provider}/check`),
  deleteModel: (provider: string) => req<void>('DELETE', `/system/models/${provider}`),
  // Политики конвейера: пресеты установки (администратор) и переопределения
  // проекта (owner пишет, участник читает).
  systemPolicy: () => req<InstallationPolicy>('GET', '/system/policy'),
  putSystemPolicy: (p: Presets) => req<InstallationPolicy>('PUT', '/system/policy', p),
  systemPolicyVersions: () => req<PolicyVersion[]>('GET', '/system/policy/versions'),
  projectPolicy: (projectId: string) => req<ProjectPolicy>('GET', `/projects/${projectId}/policy`),
  putProjectPolicy: (projectId: string, o: Overrides) => req<ProjectPolicy>('PUT', `/projects/${projectId}/policy`, o),
  projectPolicyVersions: (projectId: string) => req<PolicyVersion[]>('GET', `/projects/${projectId}/policy/versions`),
}

// ─── эксплуатация установки ─────────────────────────────────────────────

export type ComponentStatus = 'ok' | 'degraded' | 'down'
export type PlannerSource = 'db' | 'env' | 'none'

export interface SystemComponent {
  name: 'database' | 'blob' | 'secrets' | 'planner' | 'runners'
  status: ComponentStatus
  detail: string
  data?: Record<string, unknown>
}

export interface SystemStatus {
  status: ComponentStatus
  version: string
  protocol_version: string
  started_at: string
  components: SystemComponent[]
}

// Токен регистрации runner'ов: секрет есть только в ответе создания.
export interface RunnerToken {
  id: string; name: string; prefix: string
  created_at: string; created_by: string
  expires_at: string | null; last_used_at: string | null; revoked_at: string | null
}

export interface LLMProvider {
  provider: 'anthropic' | 'deepseek'
  key_prefix: string; model: string; active: boolean
  state: 'ok' | 'invalid' | 'unchecked'
  checked_at: string | null; check_detail: string
  updated_at: string; updated_by: string
}

export const LLM_PROVIDERS: { id: LLMProvider['provider']; label: string; defaultModel: string }[] = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-opus-5' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-v4-flash' },
]

export interface LogChunk { task_id: string; data: string }
export interface DeployLogChunk { deploy_id: string; data: string }

// SSE проекта: реплей событий по Last-Event-ID делает сам EventSource,
// session.log приходит только live (по контракту).
export function subscribe(projectId: string, handlers: {
  onEvent: (e: Event) => void
  onLog?: (c: LogChunk) => void
  onDeployLog?: (c: DeployLogChunk) => void
  onState?: (connected: boolean) => void
}): () => void {
  const es = new EventSource(`/api/v1/stream?project=${projectId}`)
  const evTypes = ['task.status', 'epic.progress', 'session.step', 'task.assign', 'task.review_passed', 'epic.decomposed', 'attention.new', 'attention.claimed', 'deploy.status', 'environment.config',
    'project.repository', 'project.settings',
    // Состав и роли участников: страница настроек должна показывать
    // актуальные права, а не ждать перезагрузки.
    'project.member_added', 'project.member_removed', 'project.member_role_changed',
    // Решения политик: отложенный merge, отложенная публикация, пауза по
    // бюджету, активация версии проекта — деталка, настройки и дашборд
    // обновляются по ним.
    'task.merge_deferred', 'task.merge_failed', 'deploy.deferred', 'policy.budget_exceeded', 'policy.activated']
  for (const t of evTypes) {
    es.addEventListener(t, (m) => handlers.onEvent(JSON.parse((m as MessageEvent).data)))
  }
  es.addEventListener('session.log', (m) => handlers.onLog?.(JSON.parse((m as MessageEvent).data)))
  es.addEventListener('deploy.log', (m) => handlers.onDeployLog?.(JSON.parse((m as MessageEvent).data)))
  es.onopen = () => handlers.onState?.(true)
  es.onerror = () => {
    handlers.onState?.(false)
    // EventSource не отдаёт статус ошибки: пробуем /auth/me — при 401
    // сработает глобальный onUnauthorized и консоль уйдёт на экран входа.
    void api.me().catch(() => {})
  }
  return () => es.close()
}

export const stLabel: Record<string, string> = {
  queued: 'QUEUED', ready: 'READY', running: 'RUNNING', testing: 'TESTING',
  review: 'REVIEW', fixing: 'FIXING', blocked: 'BLOCKED', failed: 'FAILED',
  done: 'DONE', cancelled: 'CANCELLED', idle: 'IDLE', offline: 'OFFLINE',
  planned: 'PLANNED', paused: 'PAUSED', archived: 'ARCHIVED',
  deploying: 'DEPLOYING', verifying: 'VERIFYING', rolled_back: 'ROLLED BACK',
}

export const stColor: Record<string, string> = {
  queued: '--c-queue', ready: '--c-ready', running: '--c-run', testing: '--c-test',
  review: '--c-review', fixing: '--c-fix', blocked: '--c-block', failed: '--c-fail',
  done: '--c-done', cancelled: '--c-cancel',
}
