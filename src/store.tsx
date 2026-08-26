import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, subscribe, type Attention, type Event, type Project } from './api/client'

// Маршрут — hash-навигация: #/epics, #/epic/<id>, #/task/<id> поверх epic и т.п.
// Вкладки раздела «Управление приложением» адресуемы: #/app-management/<tab>.
export const APP_TABS = ['users', 'runners', 'models', 'policies', 'usage', 'audit', 'status'] as const
export type AppTab = typeof APP_TABS[number]

export type Route =
  | { view: 'projects' } | { view: 'epics' } | { view: 'tasks' } | { view: 'team' }
  | { view: 'runners' } | { view: 'activity' } | { view: 'usage' } | { view: 'mysteps' }
  | { view: 'app-management'; tab: AppTab } | { view: 'profile' }
  | { view: 'epic'; id: string; taskId?: string }
  | { view: 'project-settings'; id: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const [a, b, c, d] = h.split('/')
  if (a === 'epic' && b) {
    return c === 'task' && d ? { view: 'epic', id: b, taskId: d } : { view: 'epic', id: b }
  }
  if (a === 'project' && b && c === 'settings') return { view: 'project-settings', id: b }
  if (a === 'app-management') {
    return { view: 'app-management', tab: (APP_TABS as readonly string[]).includes(b) ? b as AppTab : 'users' }
  }
  if (a === 'projects' || a === 'tasks' || a === 'team' || a === 'runners' || a === 'activity'
    || a === 'usage' || a === 'profile' || a === 'mysteps') return { view: a }
  return { view: 'epics' }
}

export function routeHash(r: Route): string {
  if (r.view === 'epic') return r.taskId ? `#/epic/${r.id}/task/${r.taskId}` : `#/epic/${r.id}`
  if (r.view === 'project-settings') return `#/project/${r.id}/settings`
  if (r.view === 'app-management') return `#/app-management/${r.tab}`
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
  logs: Map<string, string> // live-лог по задачам (только текущее подключение)
  deployLogs: Map<string, string> // live-лог публикаций по deployment_id
  refreshProjects: () => void
  // Claim эскалации не порождает события — после него список обновляется явно.
  refreshAttention: () => void
  refreshMySteps: () => void
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [attention, setAttention] = useState<Attention[]>([])
  const [mySteps, setMySteps] = useState(0)
  const [connected, setConnected] = useState(false)
  const [tick, setTick] = useState(0)
  const [lastEvent, setLastEvent] = useState<Event | null>(null)
  const logsRef = useRef(new Map<string, string>())
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

  useEffect(() => {
    if (!projectId) return
    return subscribe(projectId, {
      onEvent: (e) => {
        setLastEvent(e)
        setTick(t => t + 1)
        // policy.decision пишется, когда движок не дал решения: вместе с
        // ним появляется эскалация уровня проекта, своего события у неё нет.
        if (e.Type.startsWith('attention') || e.Type === 'task.status'
          || e.Type === 'deploy.status' || e.Type === 'policy.decision') refreshAttention()
        if (e.Type === 'task.status' || e.Type === 'task.step' || e.Type === 'task.verdict'
          || e.Type === 'task.assign') refreshMySteps()
        // Бюджет и политика живут в DTO проекта: пауза по бюджету и новая
        // версия политики должны обновить состояние без перезагрузки.
        if (e.Type === 'policy.budget_exceeded' || e.Type === 'policy.activated') refreshProjects()
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
      onState: setConnected,
    })
  }, [projectId, refreshAttention, refreshProjects])

  return (
    <Ctx.Provider value={{
      route, nav, projects, projectId, setProjectId,
      attention, mySteps, connected, tick, lastEvent, logs: logsRef.current,
      deployLogs: deployLogsRef.current, refreshProjects, refreshAttention, refreshMySteps,
    }}>
      {children}
    </Ctx.Provider>
  )
}
