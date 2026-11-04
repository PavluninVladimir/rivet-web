import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, subscribe, type AgentRole, type Attention, type Event, type OverviewPeriod, type Project, type Runner, type TeamAgent } from './api/client'
import { parsePeriod } from './components/overviewLogic'

// Маршрут — hash-навигация: #/epics, #/epic/<id>, #/task/<id> поверх epic и т.п.
// Вкладки раздела «Управление приложением» адресуемы: #/app-management/<tab>.
export const APP_TABS = ['users', 'runners', 'agents', 'team', 'roles', 'connections', 'policies', 'usage', 'audit', 'status'] as const
export type AppTab = typeof APP_TABS[number]
// Вкладки настроек проекта: #/project/<id>/settings/<tab> (add-project-settings-tabs).
export const SETTINGS_TABS = ['general', 'members', 'process', 'policies', 'environments'] as const
export type SettingsTab = typeof SETTINGS_TABS[number]

export type Route =
  | { view: 'projects' } | { view: 'epics' } | { view: 'tasks' } | { view: 'team' }
  | { view: 'runners' } | { view: 'activity' } | { view: 'usage' } | { view: 'mysteps' }
  | { view: 'app-management'; tab: AppTab } | { view: 'profile' }
  | { view: 'epic'; id: string; taskId?: string }
  | { view: 'project-settings'; id: string; tab: SettingsTab }
  // Обзор текущего проекта, период в адресе: #/overview/30d (add-project-lead-view).
  | { view: 'overview'; period: OverviewPeriod }
  // Исследование продукта (add-product-discovery): runId — открытая версия
  // из истории, без него показывается текущая.
  | { view: 'discovery'; runId?: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const [a, b, c, d] = h.split('/')
  if (a === 'epic' && b) {
    return c === 'task' && d ? { view: 'epic', id: b, taskId: d } : { view: 'epic', id: b }
  }
  if (a === 'discovery') return b ? { view: 'discovery', runId: b } : { view: 'discovery' }
  if (a === 'project' && b && c === 'settings') {
    return { view: 'project-settings', id: b, tab: (SETTINGS_TABS as readonly string[]).includes(d) ? d as SettingsTab : 'general' }
  }
  if (a === 'overview') return { view: 'overview', period: parsePeriod(b) }
  if (a === 'app-management') {
    // Старый адрес вкладки «Модели» ведёт на «Подключения» (add-model-connections).
    const tab = b === 'models' ? 'connections' : b
    return { view: 'app-management', tab: (APP_TABS as readonly string[]).includes(tab) ? tab as AppTab : 'users' }
  }
  if (a === 'projects' || a === 'tasks' || a === 'team' || a === 'runners' || a === 'activity'
    || a === 'usage' || a === 'profile' || a === 'mysteps') return { view: a }
  return { view: 'epics' }
}

export function routeHash(r: Route): string {
  if (r.view === 'epic') return r.taskId ? `#/epic/${r.id}/task/${r.taskId}` : `#/epic/${r.id}`
  if (r.view === 'project-settings') return r.tab === 'general' ? `#/project/${r.id}/settings` : `#/project/${r.id}/settings/${r.tab}`
  if (r.view === 'app-management') return `#/app-management/${r.tab}`
  if (r.view === 'overview') return r.period === '7d' ? '#/overview' : `#/overview/${r.period}`
  if (r.view === 'discovery') return r.runId ? `#/discovery/${r.runId}` : '#/discovery'
  return `#/${r.view}`
}

interface Store {
  route: Route
  nav: (r: Route) => void
  projects: Project[]
  projectId: string | null
  setProjectId: (id: string) => void
  attention: Attention[]
  // mySteps — сколько запусков ждёт текущего пользователя (add-process-humans).
  mySteps: number
  connected: boolean
  tick: number            // растёт на каждом SSE-событии — зависимость для рефетчей
  lastEvent: Event | null
  // discoveryTick растёт на каждом событии исследования и декомпозиции и
  // при переподключении (add-product-discovery). В отличие от lastEvent
  // не теряет события, пришедшие одной пачкой.
  discoveryTick: number
  logs: Map<string, string> // live-лог по задачам (только текущее подключение)
  deployLogs: Map<string, string> // live-лог публикаций по deployment_id
  refreshProjects: () => void
  // Claim эскалации не порождает события — после него список обновляется явно.
  refreshAttention: () => void
  refreshMySteps: () => void
  // Шаблоны ролей, команда агентов и runner'ы (add-agent-roles): общие
  // для дашборда, деталки, управления и редактора процесса; перечитываются
  // по role.*, team.agent_*, runner.renamed и переподключению SSE.
  roles: AgentRole[]
  roleOf: (id: string | undefined) => AgentRole | undefined
  refreshRoles: () => void
  team: TeamAgent[]
  refreshTeam: () => void
  runners: Runner[]
  refreshRunners: () => void
  // Есть ли у бэкенда обзор проекта: старый отвечает 404, пункт
  // навигации тогда скрывается (add-project-lead-view).
  overviewAvailable: boolean
  // Подписка на каждое событие проекта: экран сам решает, что перечитать,
  // и не теряет события, склеенные в один рендер.
  listen: (fn: (e: Event) => void) => () => void
}

// События, после которых экран исследования перечитывает состояние.
const DISCOVERY_RELOAD = /^(discovery\.|epic\.(decomposing|decomposed|plan_failed|deps_changed))/

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [attention, setAttention] = useState<Attention[]>([])
  const [mySteps, setMySteps] = useState(0)
  const [roles, setRoles] = useState<AgentRole[]>([])
  const [team, setTeam] = useState<TeamAgent[]>([])
  const [runners, setRunners] = useState<Runner[]>([])
  const [connected, setConnected] = useState(false)
  const [tick, setTick] = useState(0)
  const [lastEvent, setLastEvent] = useState<Event | null>(null)
  const [discoveryTick, setDiscoveryTick] = useState(0)
  const logsRef = useRef(new Map<string, string>())
  const listenersRef = useRef(new Set<(e: Event) => void>())
  const listen = useCallback((fn: (e: Event) => void) => {
    listenersRef.current.add(fn)
    return () => { listenersRef.current.delete(fn) }
  }, [])
  const [overviewAvailable, setOverviewAvailable] = useState(true)
  const deployLogsRef = useRef(new Map<string, string>())

  const nav = useCallback((r: Route) => { location.hash = routeHash(r) }, [])
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const refreshProjects = useCallback(() => {
    api.projects().then(ps => {
      const list = ps ?? []
      setProjects(list)
      setProjectId(cur => cur ?? list[0]?.ID ?? null)
    }).catch(() => {})
  }, [])
  useEffect(refreshProjects, [refreshProjects])
  // Пауза по бюджету снимается сама на новых сутках без события: список
  // проектов перечитывается в ближайший paused_until.
  useEffect(() => {
    const next = projects
      .map(p => p.budget?.paused_until ? new Date(p.budget.paused_until).getTime() : 0)
      .filter(t => t > Date.now())
    if (!next.length) return
    const id = setTimeout(refreshProjects, Math.min(...next) - Date.now() + 1000)
    return () => clearTimeout(id)
  }, [projects, refreshProjects])

  const refreshAttention = useCallback(() => {
    api.attention().then(a => setAttention(a ?? [])).catch(() => {})
  }, [])
  useEffect(refreshAttention, [refreshAttention])
  const refreshMySteps = useCallback(() => {
    api.mySteps().then(s => setMySteps((s ?? []).length)).catch(() => {})
  }, [])
  useEffect(refreshMySteps, [refreshMySteps])
  // Каталоги перечитываются по SSE-событиям и переподключению: применяется
  // ответ только последнего запроса, запоздавший старый не возвращает
  // прежние данные. Старый бэкенд без /roles и /team отвечает 404: каталог
  // пуст, подписи деградируют к runner'ам. Прочие ошибки каталог не трогают.
  const rolesSeq = useRef(0)
  const refreshRoles = useCallback(() => {
    const seq = ++rolesSeq.current
    api.roles()
      .then(r => { if (seq === rolesSeq.current) setRoles(r?.roles ?? []) })
      .catch(e => { if (seq === rolesSeq.current && e instanceof ApiError && e.status === 404) setRoles([]) })
  }, [])
  useEffect(refreshRoles, [refreshRoles])
  const teamSeq = useRef(0)
  const refreshTeam = useCallback(() => {
    const seq = ++teamSeq.current
    api.team()
      .then(r => { if (seq === teamSeq.current) setTeam(r?.agents ?? []) })
      .catch(e => { if (seq === teamSeq.current && e instanceof ApiError && e.status === 404) setTeam([]) })
  }, [])
  useEffect(refreshTeam, [refreshTeam])
  const runnersSeq = useRef(0)
  const refreshRunners = useCallback(() => {
    const seq = ++runnersSeq.current
    api.runners().then(r => { if (seq === runnersSeq.current) setRunners(r ?? []) }).catch(() => {})
  }, [])
  useEffect(refreshRunners, [refreshRunners])
  const roleOf = useCallback((id: string | undefined) => id ? roles.find(r => r.id === id) : undefined, [roles])
  useEffect(() => {
    if (!projectId) return
    let live = true
    api.overviewProbe(projectId).then(ok => { if (live) setOverviewAvailable(ok) })
    return () => { live = false }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    return subscribe(projectId, {
      onEvent: (e) => {
        setLastEvent(e)
        setTick(t => t + 1)
        for (const fn of listenersRef.current) fn(e)
        if (DISCOVERY_RELOAD.test(e.Type)) setDiscoveryTick(t => t + 1)
        // policy.decision пишется, когда движок не дал решения: вместе с
        // ним появляется эскалация уровня проекта, своего события у неё нет.
        if (e.Type.startsWith('attention') || e.Type === 'task.status'
          || e.Type === 'deploy.status' || e.Type === 'policy.decision') refreshAttention()
        if (e.Type === 'task.status' || e.Type === 'task.step' || e.Type === 'task.verdict'
          || e.Type === 'task.assign') refreshMySteps()
        // Бюджет и политика живут в DTO проекта: пауза по бюджету и новая
        // версия политики должны обновить состояние без перезагрузки.
        if (e.Type === 'policy.budget_exceeded' || e.Type === 'policy.activated') refreshProjects()
        // Название и цвет шаблона приходят и в DTO агентов: правка
        // шаблона перечитывает и команду. Смена модели планировщика меняет
        // модель агента-тимлида.
        if (e.Type.startsWith('role.')) { refreshRoles(); refreshTeam() }
        if (e.Type.startsWith('team.agent_') || e.Type === 'planner.model_changed') refreshTeam()
        if (e.Type === 'planner.model_changed') refreshRoles()
        // Текущая работа агентов и runner'ов меняется вместе со статусами задач.
        if (e.Type === 'task.status' || e.Type === 'task.assign' || e.Type === 'task.step') { refreshTeam(); refreshRunners() }
        if (e.Type === 'runner.renamed') { refreshRunners(); refreshTeam() }
        // Декомпозиция: Тимлид занят, пока не придёт итог плана.
        if (e.Type === 'epic.decomposing' || e.Type === 'epic.decomposed' || e.Type === 'epic.plan_failed') refreshTeam()
      },
      onLog: (c) => {
        const cur = logsRef.current.get(c.task_id) ?? ''
        logsRef.current.set(c.task_id, (cur + c.data).slice(-64000))
        setTick(t => t + 1)
      },
      onDeployLog: (c) => {
        const cur = deployLogsRef.current.get(c.deploy_id) ?? ''
        deployLogsRef.current.set(c.deploy_id, (cur + c.data).slice(-64000))
        setTick(t => t + 1)
      },
      onState: (on) => {
        setConnected(on)
        // После разрыва события ролей и имён runner'ов могли пропасть:
        // каталог перечитывается целиком, а tick заставляет экраны
        // перечитать runner'ов и задачи.
        if (on) {
          refreshRoles(); refreshTeam(); refreshRunners(); refreshAttention(); refreshMySteps()
          setTick(t => t + 1)
          setDiscoveryTick(t => t + 1)
        }
      },
    })
  }, [projectId, refreshAttention, refreshProjects, refreshRoles, refreshTeam, refreshRunners, refreshMySteps])

  return (
    <Ctx.Provider value={{
      route, nav, projects, projectId, setProjectId,
      attention, mySteps, connected, tick, lastEvent, discoveryTick, logs: logsRef.current,
      deployLogs: deployLogsRef.current, refreshProjects, refreshAttention, refreshMySteps,
      roles, roleOf, refreshRoles, team, refreshTeam, runners, refreshRunners,
      overviewAvailable, listen,
    }}>
      {children}
    </Ctx.Provider>
  )
}
