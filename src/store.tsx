import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, subscribe, type Attention, type Event, type Project } from './api/client'

// Маршрут — hash-навигация: #/epics, #/epic/<id>, #/task/<id> поверх epic и т.п.
export type Route =
  | { view: 'projects' } | { view: 'epics' } | { view: 'tasks' }
  | { view: 'runners' } | { view: 'activity' }
  | { view: 'epic'; id: string; taskId?: string }
  | { view: 'project-settings'; id: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const [a, b, c, d] = h.split('/')
  if (a === 'epic' && b) {
    return c === 'task' && d ? { view: 'epic', id: b, taskId: d } : { view: 'epic', id: b }
  }
  if (a === 'project' && b && c === 'settings') return { view: 'project-settings', id: b }
  if (a === 'projects' || a === 'tasks' || a === 'runners' || a === 'activity') return { view: a }
  return { view: 'epics' }
}

export function routeHash(r: Route): string {
  if (r.view === 'epic') return r.taskId ? `#/epic/${r.id}/task/${r.taskId}` : `#/epic/${r.id}`
  if (r.view === 'project-settings') return `#/project/${r.id}/settings`
  return `#/${r.view}`
}

interface Store {
  route: Route
  nav: (r: Route) => void
  projects: Project[]
  projectId: string | null
  setProjectId: (id: string) => void
  attention: Attention[]
  connected: boolean
  tick: number            // растёт на каждом SSE-событии — зависимость для рефетчей
  lastEvent: Event | null
  logs: Map<string, string> // live-лог по задачам (только текущее подключение)
  deployLogs: Map<string, string> // live-лог публикаций по deployment_id
  refreshProjects: () => void
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash())
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [attention, setAttention] = useState<Attention[]>([])
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

  const refreshAttention = useCallback(() => {
    api.attention().then(a => setAttention(a ?? [])).catch(() => {})
  }, [])
  useEffect(refreshAttention, [refreshAttention])

  useEffect(() => {
    if (!projectId) return
    return subscribe(projectId, {
      onEvent: (e) => {
        setLastEvent(e)
        setTick(t => t + 1)
        if (e.Type.startsWith('attention') || e.Type === 'task.status' || e.Type === 'deploy.status') refreshAttention()
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
  }, [projectId, refreshAttention])

  return (
    <Ctx.Provider value={{
      route, nav, projects, projectId, setProjectId,
      attention, connected, tick, lastEvent, logs: logsRef.current,
      deployLogs: deployLogsRef.current, refreshProjects,
    }}>
      {children}
    </Ctx.Provider>
  )
}
