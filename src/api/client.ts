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

export interface Project { ID: string; Name: string; Repo: string; Created: string }

export interface Runner {
  ID: string; Agent: string; Model: string; Host: string
  Capabilities: string[]; Status: string; TaskID: string
  CtxPct: number | null // null — заполненность контекста неизвестна
  Draining: boolean; LastSeen: string
}

export interface Event {
  ID: number; TS: string; ActorKind: string; ActorID: string
  Type: string; ProjectID: string; EpicID: string; TaskID: string; Text: string
}

export interface Attention {
  ID: string; ProjectID: string; TaskID: string
  DeploymentID: string // эскалация публикации (DEPLOY_FAILED): задачи нет
  Reason: string; Message: string; Status: string; ClaimedBy: string; Created: string
}

export interface User {
  ID: string; Login: string; Name: string
  Admin: boolean; Disabled: boolean; Created: string
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
  tokens: number | null
  started_at: string
  ended_at: string | null
  has_transcript: boolean
}

// Обработчик 401: консоль уводит на экран входа (спека web-console
// «Вход в консоль»); hash-маршрут сохраняется, после входа пользователь
// возвращается на ту же страницу.
let onUnauthorized: () => void = () => {}
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Аутентификация — httpOnly-cookie сессии, браузер шлёт её сам (same-origin).
  const resp = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) {
    if (resp.status === 401 && path !== '/auth/login') onUnauthorized()
    const msg = (data as { error?: { message?: string } })?.error?.message ?? resp.statusText
    throw new Error(msg)
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
  createProject: (name: string, repo: string) => req<Project>('POST', '/projects', { name, repo }),
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
  events: (q: { project?: string; epic?: string; task?: string; cursor?: number }) => {
    const p = new URLSearchParams()
    if (q.project) p.set('project', q.project)
    if (q.epic) p.set('epic', q.epic)
    if (q.task) p.set('task', q.task)
    if (q.cursor) p.set('cursor', String(q.cursor))
    return req<Event[] | null>('GET', `/events?${p}`)
  },
  usage: (groupBy: string, period?: { from?: string; to?: string }) => {
    const p = new URLSearchParams({ group_by: groupBy })
    if (period?.from) p.set('from', period.from)
    if (period?.to) p.set('to', period.to)
    return req<UsageRow[] | null>('GET', `/usage?${p}`)
  },
}

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
  const evTypes = ['task.status', 'epic.progress', 'session.step', 'task.assign', 'task.review_passed', 'epic.decomposed', 'attention.new', 'attention.claimed', 'deploy.status', 'environment.config']
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
