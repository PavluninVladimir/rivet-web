// Клиент api-contract v1. Ключи JSON соответствуют полям Go-структур.

export type TaskStatus =
  | 'queued' | 'ready' | 'running' | 'testing' | 'review'
  | 'fixing' | 'blocked' | 'failed' | 'done' | 'cancelled'

export interface Criterion { text: string; ok: boolean; status?: 'ok' | 'fail'; note?: string; by?: string; pass?: number }

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
  DeveloperAgentID?: string
  DeveloperAgentName?: string
  RunnerName?: string
  // Время задачи (api-contract add-project-lead-view): первое назначение
  // на runner и переход в done; старый бэкенд их не отдаёт.
  StartedAt?: string | null
  DoneAt?: string | null
  // Вид задачи (api-contract add-architecture-c4): work — задача плана,
  // architecture — описание архитектуры проекта. Старый бэкенд поле не
  // отдаёт, тогда задача обычная.
  Kind?: 'work' | 'architecture' | string
  // Причина провала failed-задачи (GET /tasks/{id}); null у остальных и
  // в списках задач.
  failure?: TaskFailure | null
}

// Причина провала (api-contract add-architecture-c4). У задачи описания
// reason — architecture_outside_docs (PR меняет файлы вне
// docs/architecture) или architecture_files_truncated (список файлов PR
// неполный, границу проверить нельзя).
export interface TaskFailure {
  reason: 'architecture_outside_docs' | 'architecture_files_truncated' | string
  message?: string
  // Не больше 50 путей вне docs/architecture.
  files?: string[] | null
  files_total?: number | null
  // Внешний merge на хостинге уже прошёл.
  merged?: boolean | null
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
  // Вид Epic'а (api-contract add-sdlc-cycle, add-architecture-c4):
  // maintenance — системный Epic «Сопровождение» с задачами-багами, в
  // зависимостях не участвует, architecture — системный Epic задачи
  // описания архитектуры, в нём нет плана и декомпозиции.
  Kind?: 'work' | 'architecture' | 'explore' | 'maintenance' | string
}

// isMaintenance — системный Epic «Сопровождение» (add-sdlc-cycle).
export const isMaintenance = (e: Pick<Epic, 'Kind'>) => e.Kind === 'maintenance'
// isSystemEpic — системный Epic («Сопровождение», «Архитектура проекта»):
// живёт вне плана и в зависимостях не участвует. Старый бэкенд вид не
// отдаёт, тогда Epic обычный.
export const isSystemEpic = (e: Pick<Epic, 'Kind'>) => !!e.Kind && e.Kind !== 'work'

export type Priority = 'must' | 'should' | 'could'
export interface EpicRef { id: string; title: string; status: Epic['Status'] | string }
export interface EpicDiscovery { run_id: string; version: number; needs: Need[] | null }

// ─── исследование продукта (api-contract add-product-discovery) ─────────

// Материал исследования: интервью или отзыв пользователя (add-user-feedback).
// У отзыва источник в source (он же respondent_role), название «Отзыв · <источник>».
export interface Interview {
  id: string; kind?: 'interview' | 'feedback'; title: string; respondent_role: string; source?: string; held_at?: string
  chars: number; lines: number; created_by: string; created_at: string
  deleted?: boolean
  text?: string // только в GET .../interviews/{iid}
  excerpt?: string // начало текста отзыва в списке отзывов
}
export type RunStatus = 'running' | 'ready' | 'failed' | 'approved' | 'superseded'
export type DiscoveryOutcome = 'backlog_ready' | 'needs_clarification' | 'no_development_recommended'
export interface DiscoverySource { material_id: string; line: number; quote: string }
export interface DiscoveryQuestion { id: string; text: string; reason: string; sources: DiscoverySource[] }
export interface RunSummary {
  outcome?: DiscoveryOutcome | string | null; outcome_legacy?: boolean; outcome_error?: string
  id: string; version: number; status: RunStatus; created_at: string
  finished_at?: string; agent_name?: string; model: string; outdated: boolean
}
export interface Persona { id: string; name: string; description: string; interviews: string[] | null }
// kind: 'feedback' — цитата из отзыва пользователя (add-user-feedback), у интервью поля нет.
export interface Quote { interview: string; interview_title: string; respondent_role: string; kind?: 'feedback'; line: number; text: string }
export interface Need {
  id: string; title: string; kind: 'pain' | 'need' | 'wish'; persona: string
  importance: 'high' | 'medium' | 'low'; evidence: Quote[] | null
}
export interface BacklogEpic {
  key: string; title: string; goal: string; rationale?: string
  needs: string[] | null; priority: Priority; size: 'S' | 'M' | 'L'
  depends_on: string[] | null; existing_epic: string | null
}
export interface DecomposeState { status: 'pending' | 'architecture' | 'running' | 'done' | 'failed'; detail?: string }
export interface BacklogRow extends BacklogEpic {
  epic_id?: string | null
  decompose?: DecomposeState | null
}
export interface Dropped { kind: 'quote' | 'finding' | 'persona' | 'need' | 'epic' | 'dependency' | string; ref: string; reason: string }
export interface ApprovedEpic { key: string; epic_id: string; action: 'created' | 'linked' }
export interface Run extends RunSummary {
  rationale?: string; questions?: DiscoveryQuestion[]; sources?: DiscoverySource[]
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
export interface DiscoveryState {
  interviews: Interview[] | null; current: Run | null; versions: RunSummary[] | null
  // Отзывы пользователей новыми первыми с текстом и число неучтённых
  // последней готовой версией (add-user-feedback). Нет у старого rivetd.
  feedback?: Interview[] | null; feedback_unaccounted?: number
  // Отзывы последней готовой версии: сколько в версии и сколько вошло во
  // вход синтеза (при сотнях отзывов вход сокращается).
  feedback_coverage?: FeedbackCoverage | null
}
// without_findings — отзывы без подтверждённых находок, trimmed — целиком
// убранные сокращением входа синтеза.
export interface FeedbackCoverage { total: number; synthesized: number; without_findings?: number; trimmed?: number }
export interface NewInterview { title: string; respondent_role: string; held_at?: string; text: string }
export interface NewFeedback { text: string; source: string }

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
  architecture_assessment?: ArchitectureAssessmentView
  tasks: Task[] | null
  progress: { pct: number; weighted: boolean }
  usage?: UsageRow[] | null      // вклад задач (key = id задачи)
  usage_total?: UsageRow | null  // итог по Epic
  estimate: CostEstimate
  budget: EpicBudget
}

export interface ArchitectureDecision {
  decision: 'no_change' | 'changes_required'; summary: string
  impact: string[]; constraints: string[]; documentation: string[]; risks: string[]
}
export interface ArchitectureAssessmentView {
  required: boolean; revision: number; can_reevaluate?: boolean
  assessment: {
    epic_id: string; project_id: string; discovery_run_id?: string | null; revision: number
    status: 'pending' | 'running' | 'waiting' | 'passed' | 'failed'; attempts: number
    agent_id: string; agent_name: string; model: string; connection_id: string
    error: string; decompose_requested: boolean; planning_error?: string; existing_plan?: boolean
    result?: ArchitectureDecision; updated_at: string; finished_at?: string
  } | null
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
  // Автоописание архитектуры (add-architecture-c4): по умолчанию true.
  auto_describe_architecture?: boolean
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
  auto_describe_architecture?: boolean | null
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
  // Причина нерабочего подключения: код (bad_token, no_access,
  // insufficient_scope, not_found) и текст; у рабочего пустые.
  state_reason?: string
  state_message?: string
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
  // Глубина данных сессий runner'а.
  Depth: 'full' | 'partial' | 'minimal' | string
  // Доводит ли runner контекст от Rivet до работающего агента
  // (обратный канал); без него система контекст ему не шлёт.
  ContextChannel: boolean
  // Профиль агента из каталога и защищённость канала (add-agent-profiles).
  Catalog: boolean
  Secure: boolean
  ProfileName: string
  DeclaredModels: string[] | null
  // Команды агента идут в песочнице без сети (add-native-agent).
  NetworkIsolated?: boolean
  // Инфраструктура (api-contract add-agent-roles): имя runner'а, его
  // возможности и агент команды текущей стадии. Ролей у runner'а нет:
  // RoleID и агент описывают только идущую стадию.
  CurrentLoadTest?: {id:string;project_id:string;environment_id:string;release_id:string;stage:string}
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

// Агент Rivet (api-contract add-native-agent): единственный профиль
// каталога, агентский цикл ведёт сам runner. Модели вычисляются сервером:
// все видимые модели включённых подключений.
export const RIVET_AGENT = 'rivet'
export interface AgentModelRef { connection_id: string; model: string; unavailable?: boolean }
export type SecretsMode = 'never' | 'secure' | 'always'
// Лимиты сессии агента; отсутствующее поле — значение цикла по умолчанию.
export interface AgentLimits { max_turns?: number; max_tokens?: number; max_minutes?: number }
export interface AgentProfile {
  id: string; name: string; adapter: string
  capabilities: string[]; models: AgentModelRef[]; default_model: AgentModelRef | null
  secrets: SecretsMode; enabled: boolean
  runners: number; preset: boolean; updated_at: string; updated_by: string
  limits?: AgentLimits
}
export interface AgentCatalog { agents: AgentProfile[] }
// Тело PUT /system/agents/rivet: сервер заменяет лимиты и модель по
// умолчанию целиком, поэтому форма шлёт все поля.
export interface AgentInput {
  name?: string; default_model?: AgentModelRef | null; secrets?: SecretsMode; enabled?: boolean
  limits?: AgentLimits
}
export const SECRETS_MODES: { id: SecretsMode; label: string; hint: string }[] = [
  { id: 'never', label: 'никогда', hint: 'агент берёт ключи из окружения хоста runner’а' },
  { id: 'secure', label: 'по защищённому каналу', hint: 'ключи уходят runner’у только по TLS или с той же машины' },
  { id: 'always', label: 'всегда', hint: 'ключи уходят любому runner’у агента' },
]

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

// Процесс задачи в деталке (api-contract fix-web-console-tails): снимок
// разрешённого процесса, по которому идёт задача (только включённые шаги,
// переходы заполнены), и её переходы по шагам из событий task.step.
export interface ResolvedStep {
  id: string
  kind: ProcessStep['kind']
  title: string
  on: { ok?: string; changes?: string; fail?: string }
}
export interface ResolvedProcess { steps: ResolvedStep[]; skipped?: string[] }
export interface StepTransition { step: string; outcome: string; next: string; ts: string }

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
  // Эскалация хоста окружения (HOST_CREATE, HOST_DELETE, HOST_FAILED,
  // add-environment-provisioning): задачи и публикации нет. Старый бэкенд
  // полей не отдаёт.
  HostID?: string; EnvironmentID?: string
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

export interface IssueIntakeConfig { enabled: boolean; auto_research: boolean; label: string }
export interface IssueSource {
  number: number; url: string; title: string; material_id: string
  research_run_id?: string; research_status?: string; attempts: number; created_at: string
  epics: { id: string; title: string; status: string }[]
}
export interface IssueIntakeView extends IssueIntakeConfig {
  last_check_at?: string; error: string; sources: IssueSource[]
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
 local_docker?: LocalDockerConfig
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
  // Закреплённый ключ хоста (строки known_hosts). У хоста от провайдера его
  // пишет Rivet, присланное значение сервер игнорирует.
  host_key?: string
  // Привязка Linux-хоста к провайдеру инфраструктуры
  // (add-environment-provisioning). Нет: хост задаёт администратор.
  provision?: ProvisionConfig
}

// Привязка окружения к провайдеру: local: машина deploy-runner'а,
// ruvds: VPS у RUVDS через подключение инфраструктуры.
export type ProvisionProvider = 'local' | 'ruvds'
export interface ProvisionConfig {
  provider: ProvisionProvider | string
  connection?: string
  datacenter?: number
  tariff_id?: number
  os_id?: number
  payment_period?: number
  cpu?: number
  ram?: number   // ГБ
  drive?: number // ГБ
  drive_tariff_id?: number
  ssh_public_key?: string
  bootstrap_cmd?: string // пусто: скрипт провайдера по умолчанию
  port?: number          // local: порт хоста, 0: назначит Rivet
}

export interface Money { amount: number; currency: string }
// Сумма за период оплаты провайдера (цена создания, стоимость продления).
export interface PeriodMoney extends Money { period: number; period_label: string }

export type HostState = 'quoting' | 'awaiting_approval' | 'approved' | 'creating' | 'bootstrapping' | 'ready'
  | 'delete_requested' | 'deleting' | 'deleted' | 'rejected' | 'failed'

// Хост окружения: текущий живой или последний в конечном состоянии.
export interface EnvHost {
  id: string
  provider: ProvisionProvider | string
  state: HostState | string
  live: boolean
  spec: ProvisionConfig
  // Названия из справочника провайдера на момент расчёта цены: ключи
  // datacenter, tariff, os, drive_tariff. Может быть пустым или без части
  // ключей, старый бэкенд поля не отдаёт.
  spec_labels?: Record<string, string>
  address: string
  server_id: string
  quote: PeriodMoney | null
  balance: Money | null
  approved_by: string
  approved_at: string | null
  requested_by: string
  waiting_payment: boolean
  paid_till: string | null
  cost: PeriodMoney | null
  cost_checked_at: string | null
  attempts: number
  needs_retry: boolean
  remove_volumes: boolean
  delete_requested_by: string
  detail: string
  failure: string
  compose_project: string
  port: number
  created_at: string
  updated_at: string
}

export type HostAction = 'request' | 'approve' | 'reject' | 'delete' | 'confirm-delete' | 'cancel-delete' | 'retry' | 'refresh'

// Подключение к провайдеру инфраструктуры (администратор): токен наружу
// только префиксом.
export interface InfraConnection {
  id: string
  provider: 'ruvds' | string
  name: string
  token_prefix: string
  has_token: boolean
  enabled: boolean
  state: 'ok' | 'invalid' | 'unchecked' | string
  check_detail: string
  checked_at: string | null
  balance: Money | null
  updated_at: string
  updated_by: string
}
export interface InfraConnectionInput { provider: string; name: string; token?: string; enabled: boolean }

// Справочники провайдера для формы окружения.
export interface InfraDatacenter { id: number; name: string; tariffs: number[]; drive_tariffs: number[] }
export interface InfraTariff { id: number; name: string; cpu_price: number; ram_price: number; active: boolean }
export interface InfraDriveTariff { id: number; name: string; price: number; active: boolean }
export interface InfraOS { id: number; name: string; type: string; active: boolean; ssh_keys: boolean }
export interface InfraPeriod { id: number; label: string }
export interface InfraCatalog {
  datacenters: InfraDatacenter[]
  tariffs: InfraTariff[]
  drive_tariffs: InfraDriveTariff[]
  os: InfraOS[]
  payment_periods: InfraPeriod[]
}

export interface LocalDockerConfig {
 container_port: number
 health_path?: string
 recipe?: 'auto' | 'go' | 'node' | 'static'
 build_context?: string
 startup_timeout_s?: number
 stop_timeout_s?: number
 env?: Record<string,string>
}
export interface ApplicationSecret { name: string; masked: string; updated_at: string }
export interface ApplicationSecretPatch { set?: Record<string,string>; delete?: string[] }
export interface LocalPublication {
 id: string; environment_id: string; version: string; generation: number
 status: 'queued'|'building'|'starting'|'verifying'|'running'|'unhealthy'|'stopping'|'stopped'|'failed'|'unknown'
 desired_state: 'running'|'stopped'; attempt: number
 image: string|null; container_id: string|null; listen: string|null; health_url: string|null
 reason: {code:string;message:string}|null; log_ref: string|null
 created_at: string; started_at: string|null; finished_at: string|null
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
 preparation?: 'queued'|'preparing'|'waiting_artifact'|'failed'
  // Состояние наблюдения (add-sdlc-cycle); старый бэкенд поле не отдаёт.
  monitor_state?: MonitorStateName
  // monitor_reason и monitor_last_at — причина состояния и время последней
  // проверки (без истории проверок).
  monitor_reason?: string
  monitor_last_at?: string | null
  // Хост от провайдера (add-environment-provisioning); null у окружения
  // без привязки, старый бэкенд поля не отдаёт.
  host?: EnvHost | null
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
  // Системный Epic (api-contract add-architecture-c4): в число активных и в
  // прогноз не входит. Старый бэкенд поле не отдаёт.
  system?: boolean
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

// Конверт ошибки {"error":{"code","message"},"field"}. Плоское тело
// ({"error":"код","message":"…"}) старых ответов тоже разбирается:
// иначе пользователь увидел бы пустой statusText вместо причины.
function apiCode(data: unknown): string {
  const e = (data as { error?: unknown } | null)?.error
  if (typeof e === 'string') return e
  return (e as { code?: string } | null | undefined)?.code ?? (data as { code?: string } | null)?.code ?? ''
}
function apiMessage(data: unknown): string {
  const d = data as { error?: unknown; message?: unknown } | null
  const e = d?.error
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return typeof d?.message === 'string' ? d.message : ''
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

export async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
  return (await reqResp<T>(method, path, body, signal, headers)).data
}

async function req<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(method, path, body, signal)
}

// Ответ вместе с HTTP-ответом: нужен, когда важны заголовки (Date).
async function reqResp<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<{ data: T; resp: Response }> {
  // Аутентификация — httpOnly-cookie сессии, браузер шлёт её сам (same-origin).
  const resp = await fetch(`/api/v1${path}`, {
    method,
    signal,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  // 204 приходит без тела: json() на нём падает.
  const data = resp.status === 204 ? null : await resp.json().catch(() => null)
  if (!resp.ok) {
    if (resp.status === 401 && path !== '/auth/login') onUnauthorized()
    if (resp.status === 403 && apiCode(data) === 'password_change_required') onPasswordChangeRequired()
    const msg = apiMessage(data) || resp.statusText || `HTTP ${resp.status}`
    throw new ApiError(msg, apiCode(data), resp.status, data)
  }
  return { data: data as T, resp }
}

// Multipart-запрос (загрузка интервью файлом): Content-Type с границей
// ставит браузер, ошибки приходят тем же JSON-конвертом.
async function reqForm<T>(path: string, form: FormData): Promise<T> {
  const resp = await fetch(`/api/v1${path}`, { method: 'POST', body: form })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) {
    if (resp.status === 401) onUnauthorized()
    const msg = apiMessage(data) || resp.statusText || `HTTP ${resp.status}`
    throw new ApiError(msg, apiCode(data), resp.status, data)
  }
  return data as T
}

// Время сервера из заголовка Date (точность до секунды); null, если
// заголовка нет.
export function serverTimeOf(resp: Response): number | null {
  const d = Date.parse(resp.headers.get('Date') ?? '')
  return Number.isFinite(d) ? d : null
}

// Транскрипт приходит как text/plain, а не JSON — отдельный путь без
// разбора тела (ошибки сервер по-прежнему шлёт JSON-конвертом).
async function reqText(path: string): Promise<string> {
  const resp = await fetch(`/api/v1${path}`)
  if (!resp.ok) {
    if (resp.status === 401) onUnauthorized()
    const data = await resp.json().catch(() => null)
    const msg = apiMessage(data) || resp.statusText || `HTTP ${resp.status}`
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
    const msg = apiMessage(data) || resp.statusText || `HTTP ${resp.status}`
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
 projectLoadTesting: async (id:string) => (await req<{environments:LoadView[]}>('GET',`/projects/${id}/load-testing`)).environments,
 environmentLoadTesting: (id:string) => req<LoadView>('GET',`/environments/${id}/load-testing`),
 deferLoadTesting: (id:string) => req<LoadView>('POST',`/environments/${id}/load-testing/defer`),
 startLoadTest: (id:string,input:{request_id:string;binding:LoadBinding;profile:LoadProfile}) => req<LoadRun>('POST',`/environments/${id}/load-tests`,input),
 loadTest: (id:string) => req<LoadRun>('GET',`/load-tests/${id}`),
 cancelLoadTest: (id:string) => req<LoadRun>('POST',`/load-tests/${id}/cancel`),
 loadTests: (id:string,before?:string) => req<{runs:LoadRun[];next:string|null}>('GET',`/environments/${id}/load-tests${before?`?before=${encodeURIComponent(before)}`:''}`),
 releaseLoadTests: (id:string) => req<{runs:LoadRun[]}>('GET',`/releases/${id}/load-tests`),
  login: (login: string, password: string) => req<User>('POST', '/auth/login', { login, password }),
  logout: () => req('POST', '/auth/logout'),
  me: (signal?: AbortSignal) => req<User>('GET', '/auth/me', undefined, signal),
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
  issueIntake: (projectId: string, signal?: AbortSignal) => req<IssueIntakeView>('GET', `/projects/${projectId}/operations/github-issues`, undefined, signal),
  saveIssueIntake: (projectId: string, config: IssueIntakeConfig) => req<IssueIntakeView>('PATCH', `/projects/${projectId}/operations/github-issues`, config),
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
  decompose: (epicId: string) => req<{ tasks: Task[]; architecture_pending?: boolean }>('POST', `/epics/${epicId}/decompose`),
  epicAssessment: (epicId: string) => req<ArchitectureAssessmentView>('GET', `/epics/${epicId}/architecture-assessment`),
  retryEpicAssessment: (epicId: string) => req<ArchitectureAssessmentView>('POST', `/epics/${epicId}/architecture-assessment/retry`, {}),
  reevaluateEpicAssessment: (epicId: string, revision: number) => req<ArchitectureAssessmentView>('POST', `/epics/${epicId}/architecture-assessment/reevaluate`, { revision }),
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
  task: (id: string) => req<{ task: Task; timeline: Event[] | null; step_runs: StepRun[] | null; can_set_developer?: boolean }>('GET', `/tasks/${id}`),
  setTaskDeveloper: (id: string, agentId: string | null) => req<Task>('PUT', `/tasks/${id}/developer`, { agent_id: agentId }),
  // Процесс задачи для графа в деталке (fix-web-console-tails); старый
  // бэкенд отвечает 404.
  // Шаг и статус задачи идут в том же ответе, что и переходы, и читаются
  // после них: позиция задачи может оказаться впереди истории, но не позади.
  taskProcess: (id: string) => req<{ process: ResolvedProcess | null; step_history: StepTransition[] | null
    step: string; status: string }>('GET', `/tasks/${id}/process`),
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
  applicationSecrets: (id: string) => req<ApplicationSecret[]>('GET', `/environments/${id}/secrets`),
  patchApplicationSecrets: (id: string, patch: ApplicationSecretPatch) => req<ApplicationSecret[]>('PATCH', `/environments/${id}/secrets`, patch),
  deleteEnvironment: (id: string) => req('DELETE', `/environments/${id}`),
  deploy: (envId: string) => req<Deployment>('POST', `/environments/${envId}/deploy`),
  localPublication: (id: string) => req<LocalPublication>('GET', `/environments/${id}/publication`),
  publishLocal: (id: string) => req<LocalPublication>('POST', `/environments/${id}/publish`),
  redeployLocal: (id: string, version?: string) => req<LocalPublication>('POST', `/environments/${id}/redeploy`, version ? {version} : {}),
  restartLocal: (id: string) => req<LocalPublication>('POST', `/environments/${id}/restart`),
  stopLocal: (id: string) => req<LocalPublication>('POST', `/environments/${id}/stop`),
  localLogs: (id: string, stream: 'builder'|'container', tail=200) => reqText(`/environments/${id}/publication/logs?stream=${stream}&tail=${tail}`),
  resumeEnv: (envId: string) => req<Environment>('POST', `/environments/${envId}/resume`),
  deployments: (envId: string) => req<Deployment[]>('GET', `/environments/${envId}/deployments`),
  // Действия с хостом окружения (api-contract add-environment-provisioning):
  // approve несёт сумму, которую видел владелец, delete: снятие томов.
  hostAction: (envId: string, action: HostAction, body?: { amount?: number; remove_volumes?: boolean }) =>
    req<{ host: EnvHost }>('POST', `/environments/${envId}/host/${action}`, body),
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
  // runner_ids: для каких runner'ов выпущен токен. С пустым списком привяжется к
  // первому зарегистрированному (add-runner-identity).
  createRunnerToken: (name: string, expires_at?: string, runner_ids?: string[]) =>
    req<{ token: RunnerToken; secret: string }>('POST', '/runner-tokens', { name, expires_at, runner_ids }),
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
  connectionPresets: () => req<{ presets: ConnectionPreset[] | null }>('GET', '/system/connections/presets'),
  // Подключения к провайдерам инфраструктуры (api-contract add-environment-provisioning).
  infraConnections: () => req<InfraConnection[] | null>('GET', '/system/infra-connections'),
  putInfraConnection: (id: string, input: InfraConnectionInput) =>
    req<{ connection: InfraConnection }>('PUT', `/system/infra-connections/${encodeURIComponent(id)}`, input),
  deleteInfraConnection: (id: string) => req<{ status: string }>('DELETE', `/system/infra-connections/${encodeURIComponent(id)}`),
  checkInfraConnection: (id: string) =>
    req<{ connection: InfraConnection }>('POST', `/system/infra-connections/${encodeURIComponent(id)}/check`),
  infraCatalog: (id: string) => req<InfraCatalog>('GET', `/system/infra-connections/${encodeURIComponent(id)}/catalog`),
  // Каталог агентов: один агент Rivet (api-contract add-native-agent).
  agents: () => req<AgentCatalog>('GET', '/agents'),
  systemAgents: () => req<AgentCatalog>('GET', '/system/agents'),
  putAgent: (input: AgentInput) => req<AgentProfile>('PUT', `/system/agents/${RIVET_AGENT}`, input),
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
  addFeedback: (projectId: string, fb: NewFeedback) => req<Interview>('POST', `/projects/${projectId}/discovery/feedback`, fb),
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

  // Архитектура проекта (api-contract add-architecture-c4): снимок,
  // постановка задачи описания и обновление снимка по запросу.
  architecture: (projectId: string) =>
    req<ProjectArchitecture>('GET', `/projects/${projectId}/architecture`),
  // Снимок и время сервера на момент ответа: по нему отсекается реплей
  // истории потока без сравнения с часами браузера.
  architectureAt: async (projectId: string) => {
    const { data, resp } = await reqResp<ProjectArchitecture>('GET', `/projects/${projectId}/architecture`)
    return { data, serverTime: serverTimeOf(resp) }
  },
  describeArchitecture: (projectId: string) =>
    req<{ epic_id: string; task_id: string }>('POST', `/projects/${projectId}/architecture/describe`),
  // 202 pending — чтение запущено, придёт project.architecture_updated;
  // 200 fresh — чтение пропущено (снимок свежий), события не будет.
  refreshArchitecture: (projectId: string) =>
    req<{ status: 'pending' | 'fresh' | string; retry_after_s?: number }>('POST', `/projects/${projectId}/architecture/refresh`),
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
  // Неучтённые отзывы пользователей, только у фазы discovery (add-user-feedback).
  feedback_unaccounted?: number
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

// ─── архитектура проекта (api-contract add-architecture-c4, add-architecture-erd-sequence-adr) ──

export type ArchStatus = 'pending' | 'absent' | 'ok' | 'invalid' | 'error'
// Схема: заголовок и исходный текст Mermaid без ограждения блока кода.
export interface ArchView { title: string; mermaid: string }
export type C4Kind = 'person' | 'system' | 'container' | 'database' | 'queue' | 'component'
export interface C4Element {
  id: string; kind: C4Kind | string; name: string; description: string; technology: string
  external: boolean
  // Система у контейнера, контейнер у компонента, null у людей и систем.
  parent: string | null
  // Псевдоним элемента на схемах Mermaid.
  alias?: string
}
export interface ArchDefect {
  severity: 'error' | 'warning' | string
  rule: string; file: string; location?: string; message: string
}
export interface ArchPrinciple { id: string; title: string; rationale: string }
export interface ErdAttribute {
  name: string; type: string; pk: boolean
  fk: { to: string; attribute: string } | null
  nullable: boolean; unique: boolean; description: string
}
export interface ErdEntity {
  id: string; name: string
  // Хранилища (id элементов C4 вида database), где лежит сущность.
  stores: string[]
  attributes: ErdAttribute[]
  relations: { to: string; cardinality: string; label: string; derived: boolean }[]
}
export interface Erd {
  all: ArchView | null
  stores: { store_id: string; title: string; view: ArchView }[]
  entities: ErdEntity[]
}
export interface ScenarioParticipant { id: string; name: string; alias: string; kind: 'person' | 'participant' | string }
export interface ScenarioView {
  id: string; title: string; description: string
  process: string | null
  participants: ScenarioParticipant[]
  view: ArchView
}
export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated' | 'rejected'
export interface Decision {
  number: number; slug: string; title: string; status: DecisionStatus | string; date: string
  elements: string[]; supersedes: number[]; superseded_by: number | null
  // Тело в Markdown (MADR) и путь файла от корня репозитория.
  body: string; path: string
}
export interface ElementLinks { decisions: number[]; scenarios: string[] }
export interface ArchitectureData {
  system: { name: string; description: string }
  principles: ArchPrinciple[]
  elements: C4Element[]
  views: {
    context: ArchView
    containers: { system_id: string; view: ArchView }[]
    components: { container_id: string; view: ArchView }[]
    deployment: ArchView | null
  }
  hld: string
  dsl: string
  erd: Erd
  scenarios: ScenarioView[]
  decisions: Decision[]
  // Элементы, упомянутые в решениях и сценариях: id → номера и id.
  links: Record<string, ElementLinks>
}
// Задача описания: незавершённая, а без неё последняя неудачная.
// role и runner — null, когда шаг никто не ведёт.
export interface ArchitectureTask {
  epic_id: string; task_id: string; task_num: number; status: TaskStatus | string
  step_id: string; role: string | null; runner: string | null
  trigger: 'connect' | 'epic_start' | 'manual' | string
  // Причина отказа упавшей задачи; старый бэкенд не отдаёт.
  failure?: TaskFailure | null
}
export interface ProjectArchitecture {
  project_id: string
  status: ArchStatus | string
  sha: string | null
  read_at: string | null
  error: string | null
  // Вид ошибки при status error: host — сбой хостинга, limit — превышены
  // лимиты чтения, data — описание не разобрано, no_credentials — у
  // проекта нет своих учётных данных. Старый бэкенд поле не отдаёт.
  error_kind?: 'host' | 'limit' | 'data' | 'no_credentials' | string | null
  defects: ArchDefect[]
  // Каталог описания на хостинге.
  source: { branch: string; path: string; url: string }
  current: ArchitectureData | null
  // Последняя корректная версия при invalid и error.
  last_valid: { sha: string; read_at: string | null; data: ArchitectureData } | null
  task: ArchitectureTask | null
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
  // Привязки токена (add-runner-identity). Пустой список: привяжется к первому
  // зарегистрированному runner'у. Поля нет у бэкенда до привязок.
  runners?: RunnerBinding[]
}

// issue: выпущен для runner'а, first_use: привязан при первой
// регистрации, migration: перенесён при обновлении с общего токена.
export type RunnerBindingSource = 'issue' | 'first_use' | 'migration'
export interface RunnerBinding { runner_id: string; source: RunnerBindingSource; bound_at: string }

// Подключение к провайдеру, агрегатору или локальному серверу моделей.
export type ConnectionKind = 'vendor' | 'aggregator' | 'local'
export type ConnectionAPI = 'anthropic' | 'openai'
export interface ConnHeader { name: string; value?: string; secret: boolean }
export interface ModelEntry {
  id: string; label: string
  // Цены в микродолларах за миллион токенов; cached_input_price — цена
  // кешированного входа, пусто — по цене входа.
  input_price?: number; output_price?: number; cached_input_price?: number
  // Окно и пределы выхода в токенах (add-native-agent): max_output_tokens —
  // предел ответа на ход, model_max_output — предельный выход модели
  // (потолок повтора хода с обрезанным ответом). Пусто — умолчания цикла.
  context_window?: number; max_output_tokens?: number; model_max_output?: number
  // preset — модель из пресета провайдера, который сам список не отдаёт.
  source: 'discovered' | 'manual' | 'preset'; hidden: boolean; missing: boolean
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
  // Пресет провайдера (add-native-agent): пустые поля сервер заполняет из
  // него, модели пресета сохраняются, если провайдер список не отдаёт.
  preset?: string
}
// Готовое подключение к провайдеру (GET /system/connections/presets).
export interface ConnectionPreset {
  id: string; name: string; kind: ConnectionKind; api: ConnectionAPI; base_url: string
  need_key: boolean
  models: { id: string; context_window?: number; max_output_tokens?: number; model_max_output?: number }[]
  hint?: string
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

// SSE проекта. Поток начинается с момента подключения, историю консоль
// читает запросами. При переподключении EventSource сам присылает
// Last-Event-ID (последнее событие или курсор первого сообщения потока), и
// сервер доигрывает пропущенное. session.log приходит только live (по
// контракту). Склейка перечитываний по событиям — в store.tsx.
export function subscribe(projectId: string, handlers: {
  onEvent: (e: Event) => void
  onLog?: (c: LogChunk) => void
  onDeployLog?: (c: DeployLogChunk) => void
  onState?: (connected: boolean) => void
}): () => void {
  const es = new EventSource(`/api/v1/stream?project=${projectId}`)
  const evTypes = ['assistant.run.updated', 'assistant.action.updated', 'assistant.message.created', 'assistant.snapshot.invalidated', 'design.document.updated', 'design.thread.updated', 'design.handoff.created', 'task.status', 'task.step', 'task.verdict', 'task.wait', 'epic.progress', 'session.step', 'task.assign', 'task.review_passed', 'epic.decomposed', 'attention.new', 'attention.claimed', 'deploy.status', 'environment.config',
    // Хост окружения (add-environment-provisioning): состояние, решение,
    // адрес и стоимость меняются без перезагрузки.
    'environment.host',
    'project.repository', 'project.settings',
    // Учётные данные хостинга перестали действовать или снова работают:
    // настройки и очередь эскалаций перечитываются (fix-credential-state).
    'project.credentials',
    // Состав и роли участников: страница настроек должна показывать
    // актуальные права, а не ждать перезагрузки.
    'project.member_added', 'project.member_removed', 'project.member_role_changed',
    // Решения политик: отложенный merge, отложенная публикация, пауза по
    // бюджету, активация версии проекта — деталка, настройки и дашборд
    // обновляются по ним.
    'task.merge_deferred', 'task.merge_failed', 'deploy.deferred', 'policy.budget_exceeded', 'policy.activated',
    'policy.decision', 'task.checks_external', 'task.review_external', 'task.pr_closed',
    'task.plan_edited', 'task.developer_changed', 'epic.plan_edited', 'epic.budget_exceeded',
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
    // Отзыв пользователя (add-user-feedback): счётчик неучтённых в
    // «Исследовании» и на экране цикла.
    'feedback.created',
    'operations.issue_received', 'operations.issue_watch_changed',
    'epic.deps_changed', 'epic.waiting_deps', 'epic.deps_ready',
    // Цикл разработки (add-sdlc-cycle): релизы, инциденты, наблюдение и
    // задания Релиз-инженера и Инженера сопровождения.
    'release.created', 'release.notes_ready', 'incident.opened', 'incident.updated', 'incident.resolved',
    'monitor.state', 'ops.job',
    'load_test.prompt_changed', 'load_test.status', 'load_test.progress',
    // Архитектура проекта (add-architecture-c4): новый снимок и постановка
    // задачи описания. Событие несёт только SHA и статус, снимок
    // перечитывается запросом.
    'project.architecture_updated', 'architecture.describe_started',
    'architecture.assessment_pending', 'architecture.assessment_started', 'architecture.assessment_waiting',
    'architecture.assessment_passed', 'architecture.assessment_failed']
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

// Additive k6_load_v1 API. Auth references contain no credential values.
export interface LoadLimits { max_vus: number; max_rps: number; max_target_duration_s: number; max_run_duration_s: number }
export interface LoadBinding { release_id: string; publication_id: string; version: string; generation: number }
export interface LoadRoute { path: string; weight: number; expected_status: number; expected_content_type?: string }
export interface LoadProfile { unit: 'vus' | 'rps'; target: number; capacity_ceiling: number; target_duration_s: number; max_vus: number; think_time_ms: number; p95_ms: number; max_error_rate_pct: number; routes: LoadRoute[]; auth?: { header: 'Authorization' | 'Cookie'; secret_name: string } }
export type LoadState = 'queued' | 'running' | 'passed' | 'failed' | 'inconclusive' | 'config_needed' | 'cancelled' | 'interrupted'
export interface LoadStage { stage: string; load: number; unit: string; status: string; reason: string; duration_s: number; requests: number; achieved_rps: number | null; active_vus: number | null; max_vus: number | null; p95_ms: number | null; p99_ms: number | null; error_rate: number | null; dropped_iterations: number; thresholds: Record<string, boolean>; per_route: {path:string; requests:number; p95_ms:number|null; p99_ms:number|null; error_rate:number|null}[] }
export interface LoadReport { execution_state: string; scope: string; binding: LoadBinding; profile: LoadProfile; k6_version: string; target_result: string; capacity_result: string; highest_passing: number | null; first_failing: number | null; stop_reason: string; warnings: string[]; stages: LoadStage[] }
export interface LoadRun extends LoadBinding { id:string; project_id:string; environment_id:string; profile:LoadProfile; state:LoadState; stopping:boolean; reason:{code:string;message:string}|null; runner_id:string; stage:string; created_at:string; started_at:string|null; finished_at:string|null; deadline_at:string|null; report:LoadReport|null }
export interface LoadView { environment_id:string; project_id:string; name:string; supported:boolean; ready:boolean; can_manage:boolean; reason:{code:string;message:string}|null; binding:LoadBinding|null; limits:LoadLimits; prompt:{id:string;state:'awaiting_target'|'deferred'|'answered';first_release_id:string;updated_at:string}|null; saved_profile:LoadProfile|null; latest_run:LoadRun|null }
