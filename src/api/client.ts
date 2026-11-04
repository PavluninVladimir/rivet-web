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
  // Процесс (add-process-model): текущий шаг, хэш процесса, отказы по
  // шагам, причина ожидания runner'а.
  Step: string
  StepEntry: string
  ProcessHash: string
  StepAttempts: Record<string, number> | null
  WaitReason: string
  // Текущий исполнитель (api-contract add-agent-roles): роль, агент
  // команды и имя runner'а; пусто без исполнителя, роли или агента.
  RoleID?: string
  AgentID?: string
  AgentName?: string
  RunnerName?: string
  // Время задачи (api-contract add-project-lead-view): первое назначение
  // на runner и переход в done; старый бэкенд их не отдаёт.
  StartedAt?: string | null
  DoneAt?: string | null
}

export interface Epic {
  ID: string; ProjectID: string; Title: string; Goal: string
  Status: 'planned' | 'running' | 'paused' | 'done' | 'archived'
  // Бюджет Epic в токенах; null — без бюджета (add-cost-transparency).
  TokenBudget: number | null
  // Ключ источника у импортированной истории (add-history-import);
  // пусто у живых Epic'ов.
  SourceKey: string
  Created: string
  // Первый запуск и целевая дата (api-contract add-project-lead-view).
  StartedAt?: string | null
  DueAt?: string | null
  // Исследование продукта (api-contract add-product-discovery): приоритет
  // из бэклога, зависимости, незавершённые зависимости и обоснование.
  // Старый бэкенд полей не отдаёт.
  Priority?: Priority | null
  DependsOn?: string[] | null
  WaitingFor?: EpicRef[] | null
  Discovery?: EpicDiscovery | null
  // Вид Epic'а (api-contract add-sdlc-cycle): maintenance — системный Epic
  // «Сопровождение» с задачами-багами, в зависимостях не участвует.
  Kind?: 'work' | 'architecture' | 'explore' | 'maintenance' | string
}

// isMaintenance — системный Epic «Сопровождение» (add-sdlc-cycle).
export const isMaintenance = (e: Pick<Epic, 'Kind'>) => e.Kind === 'maintenance'

export type Priority = 'must' | 'should' | 'could'
export interface EpicRef { id: string; title: string; status: Epic['Status'] | string }
export interface EpicDiscovery { run_id: string; version: number; needs: Need[] | null }

// ─── исследование продукта (api-contract add-product-discovery) ─────────

export interface Interview {
  id: string; title: string; respondent_role: string; held_at?: string
  chars: number; lines: number; created_by: string; created_at: string
  deleted?: boolean
  text?: string // только в GET .../interviews/{iid}
}
export type RunStatus = 'running' | 'ready' | 'failed' | 'approved' | 'superseded'
export interface RunSummary {
  id: string; version: number; status: RunStatus; created_at: string
  finished_at?: string; agent_name?: string; model: string; outdated: boolean
}
export interface Persona { id: string; name: string; description: string; interviews: string[] | null }
export interface Quote { interview: string; interview_title: string; respondent_role: string; line: number; text: string }
export interface Need {
  id: string; title: string; kind: 'pain' | 'need' | 'wish'; persona: string
  importance: 'high' | 'medium' | 'low'; evidence: Quote[] | null
}
export interface BacklogEpic {
  key: string; title: string; goal: string; rationale?: string
  needs: string[] | null; priority: Priority; size: 'S' | 'M' | 'L'
  depends_on: string[] | null; existing_epic: string | null
}
export interface DecomposeState { status: 'pending' | 'running' | 'done' | 'failed'; detail?: string }
export interface BacklogRow extends BacklogEpic {
  epic_id?: string | null
  decompose?: DecomposeState | null
}
export interface Dropped { kind: 'quote' | 'finding' | 'persona' | 'need' | 'epic' | 'dependency' | string; ref: string; reason: string }
export interface ApprovedEpic { key: string; epic_id: string; action: 'created' | 'linked' }
export interface Run extends RunSummary {
  stage: 'summaries' | 'synthesis' | 'done'
  progress: { done: number; total: number }
  agent: { id: string; name: string } | null
  role: { id: string; title: string }
  interviews: { id: string; title: string; sha256: string }[] | null
  personas: Persona[] | null
  needs: Need[] | null
  proposed: BacklogRow[] | null
  backlog: BacklogRow[] | null
  backlog_rev: number
  dropped: Dropped[] | null
  defects: string[] | null
  error?: string
  usage: { tokens_in?: number; tokens_out?: number; cost_usd?: number; duration_s: number }
  approved: { at: string; by: string; epics: ApprovedEpic[] | null } | null
  started_at: string
}
export interface DiscoveryState { interviews: Interview[] | null; current: Run | null; versions: RunSummary[] | null }
export interface NewInterview { title: string; respondent_role: string; held_at?: string; text: string }

// Оценка стоимости плана по истории usage (api-contract add-cost-transparency).
export interface CostEstimate {
  available: boolean
  reason?: string
  tokens_min?: number
  tokens_max?: number
  cost_min?: number | null
  cost_max?: number | null
  based_on?: 'project' | 'installation'
  sample_tasks?: number
}

export interface EpicBudget {
  tokens: number | null
  used: number
  exhausted: boolean
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
  estimate: CostEstimate
  budget: EpicBudget
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

// Документ процесса проекта (api-contract add-process-model/humans/editor).
export interface Participant {
  // role — роль из каталога (add-agent-roles): тип агента и модель без
  // явного значения берутся из роли.
  agent?: { role?: string; kind?: string; model?: string }
  user?: { login?: string; role?: string }
}
export interface ProcessStep {
  id: string
  kind: 'code' | 'test' | 'review' | 'merge' | 'deploy' | 'prompt'
  title?: string
  enabled?: boolean
  capabilities?: string[]
  participants?: Participant[]
  mode?: 'parallel' | 'sequential'
  require?: 'all' | 'any'
  attempts?: number
  on?: { ok?: string; changes?: string; fail?: string }
  prompt?: string
}
export interface ProcessDoc { steps: ProcessStep[] }
// Процесс по умолчанию, когда установка его не задавала (равен серверному
// policy.DefaultProcess): в ответах политики process тогда null.
export const DEFAULT_PROCESS: ProcessDoc = { steps: [
  { id: 'code', kind: 'code', title: 'Реализация', participants: [{ agent: { role: 'developer' } }] },
  { id: 'test', kind: 'test', title: 'Проверки', participants: [{ agent: { role: 'tester' } }] },
  { id: 'review', kind: 'review', title: 'Review', participants: [{ agent: { role: 'reviewer' } }] },
  { id: 'merge', kind: 'merge', title: 'Merge' },
  { id: 'deploy', kind: 'deploy', title: 'Публикация' },
] }
// Процесс по умолчанию с учётом флага tester_agent: при выключенном флаге
// сервер снимает тестировщика только в процессе по умолчанию, редактор
// показывает то же самое, чтобы сохранение не сделало роль явной.
export function defaultProcess(testerAgent: boolean | undefined): ProcessDoc {
  const doc = structuredClone(DEFAULT_PROCESS)
  if (testerAgent === false) {
    for (const st of doc.steps) {
      st.participants = st.participants?.map(p => p.agent?.role === 'tester' ? { agent: {} } : p)
    }
  }
  return doc
}
// Ограничения установки на процессы проектов.
export interface ProcessLocks {
  required_kinds?: string[]
  min_participants?: Record<string, number>
  human_review?: boolean
}

// Полный документ пресетов (установка и действующая политика проекта).
export interface Presets {
  auto_merge: boolean
  human_review_paths: string[]
  attempt_limit: number
  review_limit: number
  daily_token_budget: number | null // null — без ограничения
  auto_publish: boolean
  process?: ProcessDoc | null
  process_locks?: ProcessLocks | null
  // Тестировщик на шаге test и шаблоны тестовых файлов (add-agent-roles);
  // старый бэкенд их не отдаёт, тогда действуют значения по умолчанию.
  tester_agent?: boolean
  test_paths?: string[]
  // Плановый бюджет месяца в долларах (add-project-lead-view): только
  // для прогноза, задаётся в политике проекта.
  monthly_budget_usd?: number | null
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
  // Процесс проекта целиком; null — процесс установки. Тело без ключа
  // процесс не трогает (api-contract add-process-model).
  process?: ProcessDoc | null
  // Модели по умолчанию агентов для проекта (add-agent-profiles).
  agent_models?: Record<string, AgentModelRef> | null
  // Роли (add-agent-roles): тестировщик, шаблоны тестов, модели ролей
  // тройкой; пустой agent — профиль шаблона.
  tester_agent?: boolean | null
  test_paths?: string[] | null
  role_models?: Record<string, RoleModelRef> | null
  // Плановый бюджет месяца, $ (add-project-lead-view): больше 0 или null —
  // не задан. У установки его нет.
  monthly_budget_usd?: number | null
}
export interface RoleModelRef { agent: string; connection_id: string; model: string }

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

// Режим и состояние движка политик (api-contract add-policy-engine):
// external — пресеты управляются вне Rivet.
export interface PolicyEngine {
  mode: 'embedded' | 'external' | string
  state: 'ok' | 'degraded' | string
  detail: string
}

export interface InstallationPolicy {
  version: PolicyVersion | null
  // Проекты, чьи процессы не соответствуют ограничениям (после PUT).
  violations?: { project_id: string; project: string; reason: string }[]
  presets: Presets
  engine?: PolicyEngine
}

// ─── командная видимость (api-contract add-team-visibility) ─────────────

// Запись реестра активных сессий проекта и результата поиска по истории.
export interface SessionEntry {
  id: string
  task_id: string
  task_num: number
  task_title: string
  epic_id: string
  stage: string
  driver_kind: 'scheduler' | 'user'
  driver_id: string
  agent: string
  model: string
  depth: 'full' | 'partial' | 'minimal' | string
  prompt: string
  outcome: string
  last_step: string
  files: string[] | null
  private: boolean
  tokens: number | null
  started_at: string
  ended_at: string | null
  has_transcript: boolean
  // Только у активных: null — пересечения недоступны для способа
  // подключения (минимальная глубина), [] — пересечений нет.
  overlaps: Overlap[] | null
}

export interface Overlap {
  task_id: string
  task_num: number
  task_title: string
  files: string[]
}

// Источник политики проекта (api-contract add-policy-git-provider).
export interface PolicySource {
  kind: 'store' | 'git' | string
  file: string
  ref: string
}

export interface AgentModelView {
  name: string; installation: AgentModelRef | null; effective: AgentModelRef | null
  source: 'installation' | 'project'; models: AgentModelRef[]
}
export interface ProjectPolicy {
  effective: Presets
  effective_hash: string
  overrides: Overrides
  agent_models?: Record<string, AgentModelView>
  process_source?: 'project' | 'installation'
  version: PolicyVersion | null
  installation_version: PolicyVersion | null
  engine?: PolicyEngine
  source?: PolicySource
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
  // Модели и стадии протокола, объявленные runner'ом (add-process-model/editor).
  Models: string[] | null
  Stages: string[] | null
  Capabilities: string[]; Status: string; TaskID: string
  CtxPct: number | null // null — заполненность контекста неизвестна
  Draining: boolean; LastSeen: string
  // Адаптер подключения агента и глубина его данных.
  Adapter: string
  Depth: 'full' | 'partial' | 'minimal' | string
  // Доводит ли адаптер контекст от Rivet до работающего агента
  // (обратный канал); без него система контекст ему не шлёт.
  ContextChannel: boolean
  // Профиль агента из каталога и защищённость канала (add-agent-profiles).
  Catalog: boolean
  Secure: boolean
  ProfileName: string
  DeclaredModels: string[] | null
  // Инфраструктура (api-contract add-agent-roles): имя runner'а, его
  // возможности и агент команды текущей стадии. Ролей у runner'а нет:
  // RoleID и агент описывают только идущую стадию.
  DisplayName?: string
  DisplayNameLocked?: boolean
  Features?: string[] | null
  RoleID?: string
  AgentID?: string
  AgentName?: string
}

// ─── шаблоны ролей и команда агентов (api-contract add-agent-roles) ─────

export type RoleColor = 'blue' | 'violet' | 'green' | 'amber' | 'rose' | 'teal' | 'indigo' | 'slate'
export const ROLE_COLORS: { id: RoleColor; label: string }[] = [
  { id: 'blue', label: 'синий' }, { id: 'violet', label: 'фиолетовый' }, { id: 'green', label: 'зелёный' },
  { id: 'amber', label: 'янтарный' }, { id: 'rose', label: 'розовый' }, { id: 'teal', label: 'бирюзовый' },
  { id: 'indigo', label: 'индиго' }, { id: 'slate', label: 'серый' },
]
export const ROLE_CAPABILITIES = ['coding', 'review', 'explore']
// Шаблон роли. control_plane — шаблон без capability (Тимлид): его
// выполняет control plane, участником шага процесса он быть не может.
export interface AgentRole {
  id: string; title: string; description: string; instruction: string
  color: RoleColor | string
  capability: string
  control_plane: boolean
  agent: string; connection_id: string; model: string
  default_model?: { connection_id: string; model: string } | null
  enabled: boolean; builtin: boolean
  agents: number // агентов команды по шаблону
  updated_at: string; updated_by?: string
}
export interface AgentRoleInput {
  id?: string // только при создании
  title: string; description: string; instruction: string; color: string; capability: string
  agent: string; connection_id?: string; model?: string; enabled: boolean
  updated_at?: string // только при изменении: версия, которую видел клиент
}

// Агент команды: имя, шаблон и модель тройкой (все пустые — как в шаблоне,
// у тимлида — модель планировщика), текущая работа.
export interface TeamAgent {
  id: string; name: string; role_id: string; role_title: string; color: string
  agent: string; connection_id: string; model: string
  instruction_extra: string; enabled: boolean; position: number
  updated_at: string; updated_by: string
  busy: boolean
  // Задача видна только участникам её проекта, остальным пусто.
  task_id: string; task_num: number; project_id: string; epic_id: string
  step: 'code' | 'test' | 'review' | 'prompt' | string
  step_entry: 'ok' | 'changes' | string
  runner_id: string; runner_name: string
}
export interface TeamAgentInput {
  id?: string // только при создании
  name: string; role_id: string; agent: string; connection_id: string; model: string
  instruction_extra: string; enabled: boolean; position?: number
  updated_at?: string
}
// Тройка модели для выбора у агента и в переопределении модели роли.
export interface ModelChoice { agent: string; agent_name: string; connection_id: string; model: string; runner_online: boolean }

// Ссылка на шаблон: участник шага, переопределение модели в проекте или агент команды.
export interface RoleRef {
  scope: 'installation' | 'project' | string
  kind: 'participant' | 'role_model' | 'agent' | string
  project_id?: string; project_name?: string; step?: string
  agent_id?: string; agent_name?: string
}

// Payload событий исполнителя (task.status, session.step, вердикты task.step).
export interface RolePayload { id: string; title: string }

// Ошибки каталогов (api-contract add-agent-roles): поле, ссылки и актуальная
// версия лежат в error, поле и ссылки дублируются рядом.
type ErrBody = { error?: { code?: string; field?: string; refs?: RoleRef[]; current?: unknown }; field?: string; refs?: RoleRef[] } | null
export function apiField(e: unknown): string | undefined {
  if (!(e instanceof ApiError)) return undefined
  const d = e.data as ErrBody
  return d?.error?.field ?? d?.field
}
export function apiRefs(e: unknown): RoleRef[] {
  if (!(e instanceof ApiError)) return []
  const d = e.data as ErrBody
  return d?.error?.refs ?? d?.refs ?? []
}
export function apiCurrent<T>(e: unknown): T | undefined {
  if (!(e instanceof ApiError) || e.code !== 'stale') return undefined
  return (e.data as ErrBody)?.error?.current as T | undefined
}

// Профиль агента (api-contract add-agent-profiles).
export interface AgentModelRef { connection_id: string; model: string; unavailable?: boolean }
export interface EnvVar { name: string; value: string }
export type SecretsMode = 'never' | 'secure' | 'always'
export interface AgentProfile {
  id: string; name: string; adapter: 'claude-code' | 'wrap'; command: string
  capabilities: string[]; models: AgentModelRef[]; default_model: AgentModelRef | null
  env?: EnvVar[]; args?: string[]; secrets: SecretsMode; enabled: boolean
  runners: number; preset: boolean; updated_at: string; updated_by: string
}
export interface ExternalAgent { id: string; models: string[]; runners: number }
export interface AgentCatalog { agents: AgentProfile[]; external: ExternalAgent[] }
export interface AgentInput {
  name: string; adapter: 'claude-code' | 'wrap'; command?: string; capabilities?: string[]
  models?: AgentModelRef[]; default_model?: AgentModelRef | null; env?: EnvVar[]; args?: string[]
  secrets?: SecretsMode; enabled?: boolean
}
export const SECRETS_MODES: { id: SecretsMode; label: string; hint: string }[] = [
  { id: 'never', label: 'никогда', hint: 'агент берёт ключи из окружения хоста runner’а' },
  { id: 'secure', label: 'по защищённому каналу', hint: 'ключи уходят runner’у только по TLS или с той же машины' },
  { id: 'always', label: 'всегда', hint: 'ключи уходят любому runner’у с этим агентом' },
]
export const PLACEHOLDERS = ['{{key}}', '{{base_url}}', '{{model}}', '{{connection_id}}', '{{header:Имя}}']

export interface Event {
  ID: number; TS: string; ActorKind: string; ActorID: string
  Type: string; ProjectID: string; EpicID: string; TaskID: string; Text: string
  // Структурированные данные события (версия политики, причина отложенного
  // merge и т.п.); отсутствует, если событие их не несёт.
  Payload?: Record<string, unknown>
}

// Запуск участника шага процесса (api-contract add-process-humans).
export interface StepRun {
  id: number
  participant: string
  kind: 'agent' | 'user'
  agent: string
  user: string
  runner: string
  verdict: string
  detail: string
  by: string
  finished_at: string | null
  // Роль, агент команды и модель запуска (api-contract add-agent-roles).
  role?: string
  agent_id?: string
  agent_name?: string
  model?: string
}

// Элемент очереди «мои шаги».
export interface StepItem {
  run_id: number
  task: { id: string; num: number; title: string; status: string; branch: string; pr_url: string }
  project: { id: string; title: string }
  epic: { id: string; title: string }
  step: { id: string; kind: string; title: string }
  participant: string
  addressed: string
  ask: string
  context: string
  created_at: string
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
  deploy_cmd?: string
  verify_cmd?: string
  verify_url?: string
  // Внешняя доставка (api-contract add-external-delivery): пайплайн
  // хостинга, ветка запуска и переменные прогона.
  pipeline?: string
  ref?: string
  vars?: Record<string, string>
  // Kubernetes (api-contract add-k8s-delivery): namespace и либо каталог
  // манифестов с объектом проверки, либо чарт с релизом и значениями.
  namespace?: string
  manifests?: string
  workload?: string
  chart?: string
  release?: string
  values?: Record<string, string>
  // GitOps (api-contract add-gitops-delivery): репозиторий конфигурации,
  // файл и ключ, куда пишется версия.
  repo?: string
  file?: string
  key?: string
  // Наблюдение за работающим приложением (add-sdlc-cycle).
  monitor?: MonitorConfig
}

export interface Environment {
  id: string
  project_id: string
  name: string
  exec_type: 'ssh' | 'pipeline' | 'k8s' | 'gitops' | string
  trigger: 'auto' | 'manual'
  config: EnvConfig
  paused: boolean
  // Требуемые capability runner'а публикации помимо deploy.
  runner_caps: string[]
  last_deployment: Deployment | null
  // Состояние наблюдения (add-sdlc-cycle); старый бэкенд поле не отдаёт.
  monitor_state?: MonitorStateName
  // monitor_reason и monitor_last_at — причина состояния и время последней
  // проверки (без истории проверок).
  monitor_reason?: string
  monitor_last_at?: string | null
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
  // Прогон внешнего пайплайна доставки; пусто у собственной доставки.
  external_run_id: string
  external_url: string
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
  // Запрос, итог и последний шаг сессии (add-team-visibility).
  prompt: string
  outcome: string
  last_step: string
  // Сессия человека и приватность (add-user-sessions): у чужой приватной
  // содержимое пусто, files === null, has_transcript === false.
  driver_id: string
  private: boolean
  tokens: number | null
  started_at: string
  ended_at: string | null
  has_transcript: boolean
}

// Payload события session.step (подключения полной глубины): инструмент,
// краткий аргумент, файлы, признак ошибки.
// Payload события session.overlap: доставлено ли предупреждение самому
// агенту и почему нет (спека web «Доставка предупреждения агенту видна»).
export interface OverlapPayload {
  delivered?: boolean
  delivery_reason?: 'no_channel' | 'runner_offline' | 'no_runner' | string
}

export interface StepPayload {
  kind?: 'tool' | 'stop' | 'note' | string
  tool?: string
  detail?: string
  files?: string[]
  ok?: boolean
  session_id?: string
}

// ─── обзор проекта для руководителя (api-contract add-project-lead-view) ─

export type OverviewPeriod = 'today' | '7d' | '30d' | 'month'

// Сумма расхода: null — данных нет (не ноль), partial_cost — часть записей
// без стоимости.
export interface Amount {
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  duration_s: number
  partial_cost: boolean
}
export interface PerDay { tasks: number; units: number }
export type RiskStatus = 'on_track' | 'at_risk' | 'needs_human' | 'done'
export type ReasonCode = 'escalation' | 'budget_exhausted' | 'late' | 'budget_forecast' | 'last_attempt' | 'stalled' | 'no_capacity'
export interface RiskReason { code: ReasonCode | string; text: string; task_id: string | null; epic_id: string }
export interface Forecast {
  available: boolean
  at: string | null
  remaining_units: number
  velocity_units_per_hour: number | null
  velocity_source: 'project' | 'epic' | null
  reason?: string
}
export interface EpicOverview {
  id: string; title: string; status: Epic['Status']
  progress: { done_units: number; total_units: number; done_tasks: number; total_tasks: number }
  due_at: string | null
  forecast: Forecast
  risk: { status: RiskStatus; reasons: RiskReason[] | null }
  spend: Amount
  token_budget: number | null
  budget_forecast_tokens: number | null
}
export type DecisionKind = 'plan_approval' | 'escalation' | 'merge_confirmation' | 'my_step'
export interface Decision {
  kind: DecisionKind | string
  title: string
  since: string
  waiting_seconds: number
  epic_id: string | null; task_id: string | null; task_num: number | null
  run_id: string | null; attention_id: string | null
  reason: string | null
  claimed_by: string | null
}
export interface RoleLoad {
  role: string; title: string; color: string
  busy_now: number; avg_busy: number; sessions: number; busy_seconds: number
}
export interface ShareRow { key: string; title: string; amount: Amount; share: number | null }
export interface OverviewDeployment {
  id: string; env_id: string; version: string; status: string; initiator: string
  created_at: string; ended_at: string | null; rollback: boolean
}
export interface Overview {
  project_id: string
  period: { name: OverviewPeriod | string; from: string; to: string; tz: string }
  computed_at: string
  thresholds: {
    velocity_window_days: number; velocity_min_tasks: number; stalled_minutes: number
    no_capacity_minutes: number; stuck_minutes: number; last_attempt_left: number
  }
  summary: {
    active_epics: number; tasks_done: number; throughput_per_day: PerDay
    spend: Amount; open_decisions: number; first_pass_review_rate: number | null
  }
  epics: EpicOverview[] | null
  decisions: { counts: Record<DecisionKind, number>; items: Decision[] | null }
  team: {
    roles: RoleLoad[] | null
    throughput: { tasks_done: number; units_done: number; per_day: PerDay }
    quality: {
      first_pass_review_rate: number | null
      tester_returns: number; reviewer_returns: number
      merge_conflicts: { returned: number; done: number }
      escalations: { reason: string; count: number }[] | null
    }
  }
  money: {
    today: Amount; last_7d: Amount; month_to_date: Amount; period: Amount
    by_role: ShareRow[] | null; by_model: ShareRow[] | null
    avg_cost_per_task: number | null
    daily_token_budget: { budget: number; used_today: number } | null
    monthly_budget_usd: number | null
    month_forecast_usd: number | null
    month_over_budget_usd: number | null
  }
  delivery: {
    environments: { id: string; name: string; last: OverviewDeployment | null }[] | null
    deployments: OverviewDeployment[] | null
    stuck: { task_id: string; task_num: number; title: string; status: string; last_event_at: string | null; waiting_runner: boolean }[] | null
    last_attempt: { task_id: string; task_num: number; title: string; attempt_used: number; attempt_limit: number }[] | null
    budget_risks: { epic_id: string; title: string; token_budget: number; budget_forecast_tokens: number }[] | null
  }
}

// Отчёт: текст как есть и имя файла из Content-Disposition.
export interface Report { text: string; filename: string }

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
  // data — тело ответа: у ошибок валидации процесса там step и field
  // (api-contract add-process-model).
  data: unknown
  constructor(message: string, code: string, status: number, data?: unknown) {
    super(message)
    this.code = code
    this.status = status
    this.data = data
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
    const msg = (data as { error?: { message?: string } })?.error?.message || resp.statusText || `HTTP ${resp.status}`
    throw new ApiError(msg, apiCode(data), resp.status, data)
  }
  return data as T
}

// Multipart-запрос (загрузка интервью файлом): Content-Type с границей
// ставит браузер, ошибки приходят тем же JSON-конвертом.
async function reqForm<T>(path: string, form: FormData): Promise<T> {
  const resp = await fetch(`/api/v1${path}`, { method: 'POST', body: form })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) {
    if (resp.status === 401) onUnauthorized()
    const msg = (data as { error?: { message?: string } })?.error?.message ?? resp.statusText
    throw new ApiError(msg, apiCode(data), resp.status, data)
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

// Отчёт обзора приходит как text/markdown: имя файла берётся из
// Content-Disposition, чтобы скачанный файл назывался как на сервере.
async function reqReport(path: string): Promise<Report> {
  const resp = await fetch(`/api/v1${path}`)
  if (!resp.ok) {
    if (resp.status === 401) onUnauthorized()
    const data = await resp.json().catch(() => null)
    const msg = (data as { error?: { message?: string } })?.error?.message ?? resp.statusText
    throw new ApiError(msg, apiCode(data), resp.status, data)
  }
  const text = await resp.text()
  return { text, filename: dispositionFilename(resp.headers.get('Content-Disposition'), 'rivet-report.md') }
}

// Имя файла из Content-Disposition: filename="…" или без кавычек.
export function dispositionFilename(header: string | null, fallback: string): string {
  const m = header?.match(/filename="?([^";]+)"?/i)
  return m?.[1]?.trim() || fallback
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
  // Бюджет и целевая дата (due_at — RFC 3339 или null, только владелец).
  patchEpic: (id: string, patch: { token_budget?: number | null; due_at?: string | null }) =>
    req<Epic>('PATCH', `/epics/${id}`, patch),
  // Обзор проекта и отчёт (api-contract add-project-lead-view).
  overview: (projectId: string, period: OverviewPeriod, tz: string) =>
    req<Overview>('GET', `/projects/${projectId}/overview?${new URLSearchParams({ period, tz })}`),
  // Есть ли обзор у бэкенда: заведомо неверный период даёт 422 у нового
  // бэкенда без расчёта и 404 у старого, где маршрута нет.
  overviewProbe: (projectId: string) =>
    req<unknown>('GET', `/projects/${projectId}/overview?period=probe`).then(() => true, (e: unknown) =>
      !(e instanceof ApiError && e.status === 404)),
  report: (projectId: string, q: { from?: string; to?: string; tz: string }) => {
    const p = new URLSearchParams({ tz: q.tz })
    if (q.from) p.set('from', q.from)
    if (q.to) p.set('to', q.to)
    return reqReport(`/projects/${projectId}/report?${p}`)
  },
  epicAction: (id: string, action: 'start' | 'pause' | 'resume' | 'archive') =>
    req('POST', `/epics/${id}/${action}`),
  addTask: (epicId: string, t: { title: string; description: string; criteria: string[]; deps: string[] }) =>
    req<Task>('POST', `/epics/${epicId}/tasks`, t),
  task: (id: string) => req<{ task: Task; timeline: Event[] | null; step_runs: StepRun[] | null }>('GET', `/tasks/${id}`),
  // Очередь «мои шаги» и вердикт человека (add-process-humans).
  mySteps: () => req<StepItem[] | null>('GET', '/me/steps'),
  verdict: (taskId: string, runId: number, verdict: 'ok' | 'changes' | 'fail', detail: string) =>
    req<Task>('POST', `/tasks/${taskId}/runs/${runId}/verdict`, { verdict, detail }),
  patchTask: (id: string, patch: {
    attempt_limit?: number
    // Правка плана (api-contract add-plan-editing): для queued/ready.
    title?: string; description?: string; criteria?: string[]; deps?: string[]
  }) => req<Task>('PATCH', `/tasks/${id}`, patch),
  deleteTask: (id: string) => req<{ status: string }>('DELETE', `/tasks/${id}`),
  // Сессия доработки с промптом участника (api-contract add-user-sessions).
  startTaskSession: (id: string, prompt: string, priv: boolean) =>
    req<{ status: string; session_id: string }>('POST', `/tasks/${id}/sessions`, { prompt, private: priv }),
  taskSessions: (id: string) => req<Session[]>('GET', `/tasks/${id}/sessions`),
  // Реестр активных сессий проекта (без q) и поиск по истории (с q).
  projectSessions: (projectId: string, q?: string) =>
    req<SessionEntry[]>('GET', `/projects/${projectId}/sessions${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  sessionTranscript: (id: string) => reqText(`/sessions/${id}/transcript`),
  environments: (projectId: string) => req<Environment[]>('GET', `/projects/${projectId}/environments`),
  createEnvironment: (projectId: string, e: { name: string; trigger: string; exec_type: string; config: EnvConfig; runner_caps?: string[] }) =>
    req<Environment>('POST', `/projects/${projectId}/environments`, e),
  patchEnvironment: (id: string, e: { name?: string; trigger?: string; config?: EnvConfig; runner_caps?: string[] }) =>
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
  events: (q: { project?: string; epic?: string; task?: string; type?: string; cursor?: number; limit?: number; scope?: 'installation'; latest?: boolean }) => {
    const p = new URLSearchParams()
    // latest — последние события, а не первые по id (лента активности).
    if (q.latest) p.set('latest', '1')
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
  // Подключения к моделям и модель декомпозиции (api-contract add-model-connections).
  connections: () => req<ModelConnection[]>('GET', '/system/connections'),
  putConnection: (id: string, input: ConnectionInput) => req<ModelConnection>('PUT', `/system/connections/${id}`, input),
  deleteConnection: (id: string) => req<void>('DELETE', `/system/connections/${id}`),
  checkConnection: (id: string) => req<ModelConnection>('POST', `/system/connections/${id}/check`),
  discoverModels: (id: string) =>
    req<{ connection: ModelConnection; added: string[]; missing: string[] }>('POST', `/system/connections/${id}/discover`),
  putConnectionModels: (id: string, models: ModelEntry[]) =>
    req<ModelConnection>('PUT', `/system/connections/${id}/models`, { models }),
  // Каталог агентов (api-contract add-agent-profiles).
  agents: () => req<AgentCatalog>('GET', '/agents'),
  systemAgents: () => req<AgentCatalog>('GET', '/system/agents'),
  putAgent: (id: string, input: AgentInput) => req<AgentProfile>('PUT', `/system/agents/${id}`, input),
  deleteAgent: (id: string) => req<void>('DELETE', `/system/agents/${id}`),
  planner: () => req<PlannerView>('GET', '/system/planner'),
  putPlanner: (pm: { connection_id?: string; model?: string }) => req<PlannerView>('PUT', '/system/planner', pm),
  // Политики конвейера: пресеты установки (администратор) и переопределения
  // проекта (owner пишет, участник читает).
  systemPolicy: () => req<InstallationPolicy>('GET', '/system/policy'),
  putSystemPolicy: (p: Presets) => req<InstallationPolicy>('PUT', '/system/policy', p),
  systemPolicyVersions: () => req<PolicyVersion[]>('GET', '/system/policy/versions'),
  projectPolicy: (projectId: string) => req<ProjectPolicy>('GET', `/projects/${projectId}/policy`),
  putProjectPolicy: (projectId: string, o: Partial<Overrides>) => req<ProjectPolicy>('PUT', `/projects/${projectId}/policy`, o),
  projectPolicyVersions: (projectId: string) => req<PolicyVersion[]>('GET', `/projects/${projectId}/policy/versions`),
  putProjectPolicySource: (projectId: string, kind: string) =>
    req<ProjectPolicy>('PUT', `/projects/${projectId}/policy/source`, { kind }),
  // Шаблоны ролей и команда (api-contract add-agent-roles): чтение всем,
  // правка администратору. Создание POST (занятый id — 409), изменение PUT
  // с updated_at (чужая правка — 409 stale с актуальной версией).
  roles: () => req<{ roles: AgentRole[] | null }>('GET', '/roles'),
  createRole: (input: AgentRoleInput) => req<AgentRole>('POST', '/system/roles', input),
  updateRole: (id: string, input: AgentRoleInput) => req<AgentRole>('PUT', `/system/roles/${id}`, input),
  deleteRole: (id: string) => req<void>('DELETE', `/system/roles/${id}`),
  team: () => req<{ agents: TeamAgent[] | null }>('GET', '/team'),
  createTeamAgent: (input: TeamAgentInput) => req<TeamAgent>('POST', '/system/team', input),
  updateTeamAgent: (id: string, input: TeamAgentInput) => req<TeamAgent>('PUT', `/system/team/${id}`, input),
  deleteTeamAgent: (id: string) => req<void>('DELETE', `/system/team/${id}`),
  modelChoices: () => req<{ choices: ModelChoice[] | null }>('GET', '/models/choices'),
  // Пустая строка снимает имя из консоли: снова действует имя из регистрации.
  renameRunner: (id: string, displayName: string) =>
    req<Runner>('PATCH', `/system/runners/${id}`, { display_name: displayName }),
  // Исследование продукта (api-contract add-product-discovery).
  discovery: (projectId: string) => req<DiscoveryState>('GET', `/projects/${projectId}/discovery`),
  addInterview: (projectId: string, iv: NewInterview) =>
    req<Interview>('POST', `/projects/${projectId}/discovery/interviews`, iv),
  uploadInterview: (projectId: string, file: File, meta: { title: string; respondent_role: string; held_at?: string }) => {
    const form = new FormData()
    form.set('title', meta.title)
    form.set('respondent_role', meta.respondent_role)
    if (meta.held_at) form.set('held_at', meta.held_at)
    form.set('file', file)
    return reqForm<Interview>(`/projects/${projectId}/discovery/interviews`, form)
  },
  interview: (projectId: string, id: string) => req<Interview>('GET', `/projects/${projectId}/discovery/interviews/${id}`),
  deleteInterview: (projectId: string, id: string) => req<void>('DELETE', `/projects/${projectId}/discovery/interviews/${id}`),
  startAnalysis: (projectId: string) => req<Run>('POST', `/projects/${projectId}/discovery/analyses`),
  analysis: (projectId: string, id: string) => req<Run>('GET', `/projects/${projectId}/discovery/analyses/${id}`),
  putBacklog: (projectId: string, id: string, backlogRev: number, epics: BacklogEpic[]) =>
    req<Run>('PUT', `/projects/${projectId}/discovery/analyses/${id}/backlog`, { backlog_rev: backlogRev, epics }),
  approveBacklog: (projectId: string, id: string, backlogRev: number, decompose: boolean) =>
    req<{ run: Run; epics: ApprovedEpic[] }>('POST', `/projects/${projectId}/discovery/analyses/${id}/approve`, { backlog_rev: backlogRev, decompose }),
  putEpicDeps: (epicId: string, dependsOn: string[]) => req<Epic>('PUT', `/epics/${epicId}/deps`, { depends_on: dependsOn }),
  // Цикл разработки, релизы, инциденты и наблюдение (api-contract add-sdlc-cycle).
  cycle: (projectId: string, period: CyclePeriod, tz?: string) =>
    req<CycleView>('GET', `/projects/${projectId}/cycle?period=${period}${tz ? `&tz=${encodeURIComponent(tz)}` : ''}`),
  releases: (projectId: string, q: { env?: string; before?: string; limit?: number } = {}) => {
    const p = new URLSearchParams()
    if (q.env) p.set('env', q.env)
    if (q.before) p.set('before', q.before)
    if (q.limit) p.set('limit', String(q.limit))
    return req<{ releases: Release[]; next: string | null }>('GET', `/projects/${projectId}/releases?${p}`)
  },
  release: (id: string) => req<Release>('GET', `/releases/${id}`),
  regenerateNotes: (id: string) => req<Release>('POST', `/releases/${id}/notes`),
  incidents: (projectId: string, q: { status?: IncidentFilter; env?: string; before?: string; limit?: number } = {}) => {
    const p = new URLSearchParams()
    if (q.status) p.set('status', q.status)
    if (q.env) p.set('env', q.env)
    if (q.before) p.set('before', q.before)
    if (q.limit) p.set('limit', String(q.limit))
    return req<{ incidents: Incident[]; next: string | null }>('GET', `/projects/${projectId}/incidents?${p}`)
  },
  incident: (id: string) => req<Incident>('GET', `/incidents/${id}`),
  resolveIncident: (id: string, comment: string) => req<Incident>('POST', `/incidents/${id}/resolve`, { comment }),
  rebugIncident: (id: string) => req<Incident>('POST', `/incidents/${id}/bug`),
  monitor: (envId: string) => req<MonitorState>('GET', `/environments/${envId}/monitor`),
}

// ─── цикл разработки (api-contract add-sdlc-cycle) ──────────────────────

export type CyclePhaseId = 'discovery' | 'architecture' | 'planning' | 'development' | 'testing' | 'review' | 'release' | 'operations'
export type CyclePeriod = 'today' | '7d' | '30d'
export type CycleItemState = 'active' | 'waiting' | 'needs_human'
export interface CycleWork { kind: 'task' | 'epic' | 'deployment' | 'incident' | 'analysis' | 'release' | string; id: string; num?: number; title: string; action: string }
export interface CycleAgent {
  agent_id: string; name: string; role_id: string; role_title: string
  model?: string; connection_id?: string
  state: 'working' | 'idle' | 'disabled' | 'no_runner'
  current: CycleWork | null
  runner_id?: string
}
export interface CycleItem {
  kind: 'task' | 'epic' | 'deployment' | 'incident' | 'analysis' | 'material' | 'environment' | string
  id: string; num?: number; title: string; state: CycleItemState
  // Epic задачи (переход на дашборд), у Epic'а — он сам.
  epic_id?: string
  badge?: 'bug' | 'awaiting_release' | 'rollback' | string
  since: string
}
export interface CycleArtifact { kind: string; id: string; title: string; at: string; ref: { view?: string; id?: string; url?: string } }
export interface CyclePhase {
  id: CyclePhaseId; title: string; role: string; no_data: boolean; hint?: string
  counters: { active: number; waiting: number; needs_human: number; done_period: number }
  template_only: boolean
  agents: CycleAgent[]; items: CycleItem[]; artifacts: CycleArtifact[]
}
export interface CycleSummary {
  agents_total: number; agents_working: number; incidents_open: number
  last_release: { id: string; env_id: string; env_name: string; version: string; created_at: string } | null
  spend_usd: number | null; tokens: number
}
export interface CycleView { project_id: string; period: CyclePeriod; generated_at: string; summary: CycleSummary; phases: CyclePhase[] }

export interface ReleaseItem { task_id: string; num: number; title: string; kind: 'work' | 'bug' | 'architecture' | string; epic_id: string; epic_title: string; pr_url: string; incident_id: string | null }
export interface Release {
  id: string; project_id: string; env_id: string; env_name: string; deployment_id: string
  version: string; prev_version?: string; created_at: string; initiator: string
  composition: ReleaseItem[]; notes_md?: string
  notes_status: 'pending' | 'ready' | 'template'
  notes_agent: { id: string; name: string } | null
  dropped_items: number
  // Публикацию запустил человек: состав — оценка по времени merge.
  composition_by_time?: boolean
}

export type IncidentFilter = 'active' | 'open' | 'mitigated' | 'resolved'
export interface IncidentDescription {
  status: 'pending' | 'ready' | 'template'
  agent: { id: string; name: string } | null
  summary: string; cause: string; reproduction: string[]
  bug: { title: string; description: string; criteria: string[] }
}
export interface Incident {
  id: string; project_id: string; env_id: string; env_name: string
  source: 'monitor' | 'release'; fingerprint: string
  status: 'open' | 'mitigated' | 'resolved'; severity: 'medium' | 'high'
  first_seen: string; last_seen: string; occurrences: number; title: string
  evidence?: { stage?: string; check_output?: string; logs?: string; deploy_log?: string }
  description: IncidentDescription
  bug_task: { id: string; num: number; status: string } | null
  needs_human: boolean; bug_cancelled_by?: string; skipped_daily: boolean
  deployment_id?: string; mitigated_release_id?: string
  resolved_at?: string; resolution?: 'fixed' | 'self' | 'manual' | ''
  history?: { at: string; status: string; by: string; note: string }[]
}

export interface MonitorConfig { enabled: boolean; check_cmd?: string; check_url?: string; logs_cmd?: string; interval_min: number }
export type MonitorStateName = 'ok' | 'fail' | 'unknown' | 'disabled'
export interface MonitorRun { at: string; ok: boolean; duration_ms: number; output: string }
export interface MonitorState {
  env_id: string; state: MonitorStateName; reason?: string
  last_at?: string; next_at?: string
  consecutive_fail: number; consecutive_ok: number
  runs: MonitorRun[]
}

// ─── эксплуатация установки ─────────────────────────────────────────────

export type ComponentStatus = 'ok' | 'degraded' | 'down'
export type PlannerSource = 'catalog' | 'env' | 'none'

export interface SystemComponent {
  name: 'database' | 'blob' | 'secrets' | 'planner' | 'policy' | 'runners'
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

// Подключение к провайдеру, агрегатору или локальному серверу моделей.
export type ConnectionKind = 'vendor' | 'aggregator' | 'local'
export type ConnectionAPI = 'anthropic' | 'openai'
export interface ConnHeader { name: string; value?: string; secret: boolean }
export interface ModelEntry {
  id: string; label: string
  input_price?: number; output_price?: number; context_window?: number
  source: 'discovered' | 'manual'; hidden: boolean; missing: boolean
}
export interface ModelConnection {
  id: string; name: string; kind: ConnectionKind; api: ConnectionAPI; base_url: string
  key_prefix: string; has_key: boolean; headers: ConnHeader[]; models: ModelEntry[]
  enabled: boolean; state: 'ok' | 'invalid' | 'unchecked'
  checked_at: string | null; check_detail: string; updated_at: string; updated_by: string
}
export interface ConnectionInput {
  name: string; kind: ConnectionKind; api: ConnectionAPI; base_url: string
  key?: string; headers?: { name: string; value?: string; secret: boolean }[]; enabled?: boolean
}
export interface PlannerView {
  source: PlannerSource; connection_id?: string; model?: string; state?: string; detail?: string
}
export const CONNECTION_KINDS: { id: ConnectionKind; label: string }[] = [
  { id: 'vendor', label: 'вендор' }, { id: 'aggregator', label: 'агрегатор' }, { id: 'local', label: 'локальный сервер' },
]
export const CONNECTION_APIS: { id: ConnectionAPI; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Messages API, base URL https://api.anthropic.com' },
  { id: 'openai', label: 'OpenAI-совместимый', hint: 'chat completions: OpenAI, DeepSeek, OpenRouter, LiteLLM, LM Studio, Ollama' },
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
  const evTypes = ['task.status', 'task.step', 'task.verdict', 'task.wait', 'epic.progress', 'session.step', 'task.assign', 'task.review_passed', 'epic.decomposed', 'attention.new', 'attention.claimed', 'deploy.status', 'environment.config',
    'project.repository', 'project.settings',
    // Состав и роли участников: страница настроек должна показывать
    // актуальные права, а не ждать перезагрузки.
    'project.member_added', 'project.member_removed', 'project.member_role_changed',
    // Решения политик: отложенный merge, отложенная публикация, пауза по
    // бюджету, активация версии проекта — деталка, настройки и дашборд
    // обновляются по ним.
    'task.merge_deferred', 'task.merge_failed', 'deploy.deferred', 'policy.budget_exceeded', 'policy.activated',
    'policy.decision', 'task.checks_external', 'task.review_external', 'task.pr_closed',
    'task.plan_edited', 'epic.plan_edited', 'epic.budget_exceeded',
    // Пересечения работ: реестр «Команды» и timeline задач (add-team-visibility).
    'session.overlap',
    // Шаблоны ролей, команда агентов, имена runner'ов и модель
    // планировщика (add-agent-roles): события установки приходят и сюда.
    'role.created', 'role.updated', 'role.deleted', 'runner.renamed',
    'team.agent_created', 'team.agent_updated', 'team.agent_deleted', 'planner.model_changed',
    // Агент занят или освободился в любом проекте: команда в этом проекте
    // видит, что агент свободен, хотя событий чужого проекта сюда нет.
    'team.agent_busy', 'team.agent_free',
    // Тимлид составляет план: видно всем зрителям, а не только нажавшему.
    'epic.decomposing', 'epic.plan_failed',
    // Обзор проекта (add-project-lead-view): целевая дата, конфликты и
    // подтверждение merge меняют риски и решения. Конфликт merge ещё и
    // возвращает задачу в разработку: фаза в цикле меняется.
    'epic.due_changed', 'task.merge_conflict', 'task.merge',
    // Исследование продукта и зависимости Epic'ов (add-product-discovery).
    'discovery.interview_added', 'discovery.interview_deleted', 'discovery.analysis_started',
    'discovery.analysis_progress', 'discovery.analysis_ready', 'discovery.analysis_failed',
    'discovery.backlog_edited', 'discovery.approved',
    'epic.deps_changed', 'epic.waiting_deps', 'epic.deps_ready',
    // Цикл разработки (add-sdlc-cycle): релизы, инциденты, наблюдение и
    // задания Релиз-инженера и Инженера сопровождения.
    'release.created', 'release.notes_ready', 'incident.opened', 'incident.updated', 'incident.resolved',
    'monitor.state', 'ops.job']
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
