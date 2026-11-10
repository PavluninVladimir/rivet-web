import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, subscribe, type AgentRole, type Attention, type Event, type Project, type Runner, type TeamAgent } from './api/client'
import { throttleWithRecheck } from './components/overviewLogic'
import { isAgentWorkEvent } from './components/roleLabels'
import { parseHash, resolveLegacy, routeHash, routeProject, withProject, type NavTarget, type Parsed, type Route } from './routes'

// Адреса и маршруты — в routes.ts (add-project-navigation): экраны
// проекта под #/p/<проект>/…, экраны установки без проекта. Типы и сборка
// адреса переэкспортируются, чтобы экраны импортировали их отсюда.
export { APP_TABS, SETTINGS_TABS, routeHash, type AppTab, type NavTarget, type Route, type SettingsTab } from './routes'

// Не чаще раза в столько миллисекунд команда и runner'ы перечитываются по
// занятости агентов установки.
const AGENT_WORK_MS = 2000
// Поток несёт события одного проекта: эскалации и «Мои шаги» остальных
// проектов перечитываются раз в столько миллисекунд, пока вкладка видна
// (до потока установки scope=all из add-work-board).
const COUNTERS_POLL_MS = 30_000

// Последний открытый проект: в него ведут старые адреса без проекта и
// пустой адрес (спека web «Совместимость старых адресов»). Только удобство
// этого браузера: без хранилища консоль работает, просто открывает
// «Проекты».
const LAST_PROJECT_KEY = 'rivet.lastProject'
function readLastProject(): string | null {
  try { return localStorage.getItem(LAST_PROJECT_KEY) } catch { return null }
}
function writeLastProject(pid: string | null) {
  try {
    if (pid) localStorage.setItem(LAST_PROJECT_KEY, pid)
    else localStorage.removeItem(LAST_PROJECT_KEY)
  } catch { /* хранилище недоступно */ }
}

// Сообщение над экраном (проект из адреса не найден). hash — адрес, на
// котором оно показано: переход на другой адрес его снимает.
export interface Notice { text: string; hash: string }

interface Store {
  route: Route
  // Переход по адресу. Цель экрана проекта без pid получает текущий
  // проект. replace — без новой записи в истории браузера (перебор фаз
  // стрелками, исправление адреса).
  nav: (r: NavTarget, opts?: { replace?: boolean }) => void
  // Адрес ссылки с той же подстановкой проекта.
  href: (r: NavTarget) => string
  projects: Project[]
  // Проект для экранов и боковой панели: проект адреса, а на экранах
  // установки — открытый до перехода к ним. null — вне проекта.
  projectId: string | null
  // Проект потока событий: открытый, иначе последний, иначе первый
  // доступный. Поток нужен и вне проекта: связь, счётчики, runner'ы.
  streamProjectId: string | null
  // Старый адрес Epic'а ждёт ответа о проекте Epic'а: экран не рисуется.
  resolving: boolean
  notice: Notice | null
  dismissNotice: () => void
  attention: Attention[]
  // mySteps — сколько запусков ждёт текущего пользователя (add-process-humans).
  mySteps: number
  connected: boolean
  tick: number            // растёт на каждом SSE-событии — зависимость для рефетчей
  // eventTick — только события проекта (без чанков логов) и переподключения:
  // зависимость перечитываний, которым логи не нужны.
  eventTick: number
  lastEvent: Event | null
  // discoveryTick растёт на каждом событии исследования и декомпозиции и
  // при переподключении (add-product-discovery). В отличие от lastEvent
  // не теряет события, пришедшие одной пачкой.
  discoveryTick: number
  // recent — последние события проекта из потока, новые первыми (лента цикла).
  recent: Event[]
  // reconnects — число переподключений потока (первое подключение не
  // считается): экран цикла перечитывает агрегат и историю.
  reconnects: number
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
const PROGRESS_RELOAD_MS = 2000
const DISCOVERY_RELOAD = /^(discovery\.|feedback\.|epic\.(decomposing|decomposed|plan_failed|deps_changed))/

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

// Маршрут адреса до разрешения старых адресов: новый адрес рисуется
// сразу, старый и пустой ждут эффекта синхронизации.
function initialRoute(): { route: Route; resolving: boolean } {
  const p = parseHash(location.hash)
  return p.kind === 'route' ? { route: p.route, resolving: false } : { route: { view: 'projects' }, resolving: true }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialRoute)
  const [route, setRoute] = useState<Route>(initial.route)
  const [resolving, setResolving] = useState(initial.resolving)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  // loaded — список получен и по нему можно проверять доступ; tried —
  // была хотя бы одна попытка: старый адрес не ждёт вечно, если сервер не
  // ответил.
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectsTried, setProjectsTried] = useState(false)
  // Старый или пустой адрес без своего проекта ждёт списка проектов:
  // последний открытый проект берётся, только если он ещё доступен.
  const [waiting, setWaiting] = useState<{ p: Exclude<Parsed, { kind: 'route' }>; seq: number } | null>(null)
  // Проект, открытый до перехода к экрану установки: панель продолжает
  // показывать его разделы, пока пользователь не вернулся к «Проектам».
  const [context, setContext] = useState<string | null>(routeProject(initial.route))
  // Последний открытый проект этой вкладки. Хранилище общее для вкладок:
  // поток вне проекта не должен переключаться, когда проект открыли в
  // соседней вкладке.
  const [lastPid, setLastPid] = useState(readLastProject)
  const [attention, setAttention] = useState<Attention[]>([])
  const [mySteps, setMySteps] = useState(0)
  const [roles, setRoles] = useState<AgentRole[]>([])
  const [team, setTeam] = useState<TeamAgent[]>([])
  const [runners, setRunners] = useState<Runner[]>([])
  const [connected, setConnected] = useState(false)
  const [tick, setTick] = useState(0)
  const [eventTick, setEventTick] = useState(0)
  const opened = useRef(false)
  const [lastEvent, setLastEvent] = useState<Event | null>(null)
  const [discoveryTick, setDiscoveryTick] = useState(0)
  // Ход анализа приходит событием на каждый конспект, а их сотни при
  // большом числе отзывов: «Исследование» перечитывается по нему не чаще
  // раза в PROGRESS_RELOAD_MS (последнее событие пачки не теряется).
  const progressReload = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null })
  const [recent, setRecent] = useState<Event[]>([])
  const [reconnects, setReconnects] = useState(0)
  const logsRef = useRef(new Map<string, string>())
  const listenersRef = useRef(new Set<(e: Event) => void>())
  const listen = useCallback((fn: (e: Event) => void) => {
    listenersRef.current.add(fn)
    return () => { listenersRef.current.delete(fn) }
  }, [])
  const [overviewAvailable, setOverviewAvailable] = useState(true)
  const deployLogsRef = useRef(new Map<string, string>())

  // Синхронизация с адресом. Адрес — источник истины: маршрут всегда из
  // него. Неканонический адрес (#/p/<id>, лишние части) заменяется своей
  // формой, старый и пустой — новым адресом, всё без записи в истории.
  // Старый адрес со своим проектом берёт его, старый адрес Epic'а — проект
  // самого Epic'а, остальные ждут списка проектов (последний открытый).
  // Ответ, пришедший после ухода на другой адрес, отбрасывается.
  const syncSeq = useRef(0)
  const replaceRoute = useCallback((r: Route) => {
    history.replaceState(history.state, '', routeHash(r))
    setRoute(r); setResolving(false); setWaiting(null)
  }, [])
  const sync = useCallback(() => {
    const seq = ++syncSeq.current
    const hash = location.hash
    // Сообщение живёт на своём адресе: переход в другое место его снимает.
    setNotice(n => (n && n.hash === hash ? n : null))
    const p = parseHash(hash)
    if (p.kind === 'route') {
      const canon = routeHash(p.route)
      if (canon !== hash) history.replaceState(history.state, '', canon)
      setRoute(p.route); setResolving(false); setWaiting(null)
      return
    }
    setResolving(true)
    if (p.kind === 'legacy' && p.target.pid) { replaceRoute(resolveLegacy(p, null)); return }
    if (p.kind === 'legacy' && p.target.view === 'epic') {
      const t = p.target
      api.epic(t.id)
        .then(v => {
          if (seq !== syncSeq.current) return
          if (v.ProjectID) replaceRoute(withProject(t, v.ProjectID)); else setWaiting({ p, seq })
        })
        .catch(() => { if (seq === syncSeq.current) setWaiting({ p, seq }) })
      return
    }
    setWaiting({ p, seq })
  }, [replaceRoute])
  useEffect(() => {
    sync()
    addEventListener('hashchange', sync)
    return () => removeEventListener('hashchange', sync)
  }, [sync])

  const routePid = routeProject(route)
  // Проект адреса открывает проект, «Проекты» его закрывают, остальные
  // экраны установки оставляют открытым прежний.
  useEffect(() => {
    if (routePid) setContext(routePid)
    else if (route.view === 'projects') setContext(null)
  }, [routePid, route.view])
  const projectId = routePid ?? (route.view === 'projects' ? null : context)
  // Последний проект — для nav и href без явного проекта. Ref, а не
  // зависимость: nav остаётся тем же между рендерами.
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  const nav = useCallback((t: NavTarget, opts?: { replace?: boolean }) => {
    const hash = routeHash(withProject(t, projectRef.current))
    if (opts?.replace) {
      // replaceState не шлёт hashchange: маршрут обновляется сам.
      history.replaceState(history.state, '', hash)
      sync()
      return
    }
    // Переход на текущий адрес hashchange не даёт: сообщение снимается здесь.
    if (hash === location.hash) { setNotice(null); return }
    location.hash = hash
  }, [sync])
  const href = useCallback((t: NavTarget) => routeHash(withProject(t, projectId)), [projectId])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const refreshProjects = useCallback(() => {
    api.projects().then(ps => {
      setProjects(ps ?? [])
      setProjectsLoaded(true)
    }).catch(() => {}).finally(() => setProjectsTried(true))
  }, [])
  useEffect(refreshProjects, [refreshProjects])

  // Старый или пустой адрес без своего проекта: последний открытый проект,
  // если он есть в списке. Недоступный последний проект стирается молча, и
  // открываются «Проекты»: пользователь этот адрес не набирал. Без ответа
  // сервера о списке берётся сохранённый проект как есть.
  useEffect(() => {
    if (!waiting || !projectsTried) return
    if (waiting.seq !== syncSeq.current) { setWaiting(null); return }
    let last = readLastProject()
    if (last && projectsLoaded && !projects.some(p => p.ID === last)) {
      const gone = last
      writeLastProject(null)
      setLastPid(l => (l === gone ? null : l))
      last = null
    }
    replaceRoute(resolveLegacy(waiting.p, last))
  }, [waiting, projectsTried, projectsLoaded, projects, replaceRoute])

  // Проект адреса должен быть среди доступных. Если его нет, список
  // перечитывается один раз: проект мог появиться только что (мастер).
  // Нет и после этого — сообщение и «Проекты»; ошибка загрузки проверку не
  // запускает. Найденный проект запоминается как последний открытый.
  useEffect(() => {
    if (!routePid || !projectsLoaded) return
    if (projects.some(p => p.ID === routePid)) { writeLastProject(routePid); setLastPid(routePid); return }
    let live = true
    api.projects().then(ps => {
      if (!live) return
      const list = ps ?? []
      if (list.some(p => p.ID === routePid)) { setProjects(list); return }
      if (readLastProject() === routePid) writeLastProject(null)
      setLastPid(l => (l === routePid ? null : l))
      setNotice({ text: 'Проект из адреса не найден или у вас нет к нему доступа.', hash: routeHash({ view: 'projects' }) })
      nav({ view: 'projects' }, { replace: true })
    }).catch(() => {})
    return () => { live = false }
  }, [routePid, projects, projectsLoaded, nav])

  // Поток событий нужен и вне проекта: индикатор связи, «Мои шаги»,
  // события установки для runner'ов и команды. Поток открывается только на
  // доступный проект: открытый, иначе последний открытый, иначе первый.
  // Проект из адреса до проверки доступа потока не получает, а пока старый
  // адрес разрешается, поток не открывается вовсе: иначе он открылся бы на
  // прежнем проекте и сразу переоткрылся.
  // Старый адрес внутри консоли (вставленный, «Назад», #/) поток не
  // переоткрывает: пока он разрешается, остаётся прежний поток. При старте
  // прежнего нет, и поток ждёт разрешения.
  const known = (pid: string | null) => !!pid && projects.some(p => p.ID === pid)
  const streamRef = useRef<string | null>(null)
  const streamProjectId = resolving ? streamRef.current
    : known(projectId) ? projectId : known(lastPid) ? lastPid : projects[0]?.ID ?? null
  streamRef.current = streamProjectId
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

  // Перечитывания идут из событий, опроса и экранов: применяется ответ
  // только последнего запроса.
  const attentionSeq = useRef(0)
  const refreshAttention = useCallback(() => {
    const seq = ++attentionSeq.current
    api.attention().then(a => { if (seq === attentionSeq.current) setAttention(a ?? []) }).catch(() => {})
  }, [])
  useEffect(refreshAttention, [refreshAttention])
  const stepsSeq = useRef(0)
  const refreshMySteps = useCallback(() => {
    const seq = ++stepsSeq.current
    api.mySteps().then(s => { if (seq === stepsSeq.current) setMySteps((s ?? []).length) }).catch(() => {})
  }, [])
  useEffect(refreshMySteps, [refreshMySteps])
  // Эскалации и «Мои шаги» других проектов (спека web «Счётчики эскалаций
  // по проектам»): опрос, пока вкладка видна, и сразу при возвращении на неё.
  // Тот же опрос дозагружает список проектов, если при старте он не пришёл:
  // без него нет потока, проверки доступа и имени проекта.
  const projectsLoadedRef = useRef(projectsLoaded)
  projectsLoadedRef.current = projectsLoaded
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      refreshAttention(); refreshMySteps()
      if (!projectsLoadedRef.current) refreshProjects()
    }
    const id = setInterval(refresh, COUNTERS_POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
  }, [refreshAttention, refreshMySteps, refreshProjects])
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
  // Проба обзора — на доступном проекте потока: 404 недоступного проекта
  // не значит, что у бэкенда нет обзора.
  useEffect(() => {
    if (!streamProjectId) return
    let live = true
    api.overviewProbe(streamProjectId).then(ok => { if (live) setOverviewAvailable(ok) })
    return () => { live = false }
  }, [streamProjectId])
  // Старый бэкенд без обзора: вход в проект и адрес обзора ведут в Epic’и.
  useEffect(() => {
    if (!overviewAvailable && route.view === 'overview') nav({ view: 'epics', pid: route.pid }, { replace: true })
  }, [overviewAvailable, route, nav])

  // Занятость агентов приходит со всей установки (team.agent_busy и
  // team.agent_free), на каждую стадию любого проекта. Она перечитывает
  // только команду и runner'ов, склеенно, не чаще раза в AGENT_WORK_MS, и не
  // двигает tick: стадия в чужом проекте не должна перечитывать текущий экран.
  // Повтор через AGENT_WORK_MS застаёт событие, которое курсор SSE мог
  // пропустить из-за позднего коммита транзакции с меньшим id.
  const agentWork = useMemo(() => throttleWithRecheck(() => { refreshTeam(); refreshRunners() }, AGENT_WORK_MS), [refreshTeam, refreshRunners])
  useEffect(() => () => agentWork.cancel(), [agentWork])

  useEffect(() => {
    if (!streamProjectId) return
    return subscribe(streamProjectId, {
      onEvent: (e) => {
        if (isAgentWorkEvent(e.Type)) {
          agentWork.call()
          return
        }
        setLastEvent(e)
        setRecent(r => (r.some(x => x.ID === e.ID) ? r : [e, ...r].slice(0, 60)))
        setTick(t => t + 1)
        setEventTick(t => t + 1)
        for (const fn of listenersRef.current) {
          try { fn(e) } catch { /* слушатель экрана не ломает поток */ }
        }
        if (e.Type === 'discovery.analysis_progress') {
          const pr = progressReload.current
          const wait = PROGRESS_RELOAD_MS - (Date.now() - pr.last)
          if (wait <= 0) {
            pr.last = Date.now()
            setDiscoveryTick(t => t + 1)
          } else if (!pr.timer) {
            pr.timer = setTimeout(() => {
              pr.timer = null
              pr.last = Date.now()
              setDiscoveryTick(t => t + 1)
            }, wait)
          }
        } else if (DISCOVERY_RELOAD.test(e.Type)) setDiscoveryTick(t => t + 1)
        // policy.decision пишется, когда движок не дал решения: вместе с
        // ним появляется эскалация уровня проекта, своего события у неё нет.
        // Лимит сопровождения создаёт эскалацию OPS_LIMIT вместе с инцидентом.
        // Переход хоста окружения открывает и закрывает решения HOST_*.
        if (e.Type.startsWith('attention') || e.Type === 'task.status'
          || e.Type === 'deploy.status' || e.Type === 'environment.host'
          || e.Type === 'policy.decision' || e.Type.startsWith('incident.')) refreshAttention()
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
        // Релиз-инженер и Инженер сопровождения заняты заданием control plane.
        if (e.Type === 'ops.job') refreshTeam()
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
          // События установки (политика, роли) за разрыв не проигрываются:
          // проекты с бюджетом и политикой перечитываются заново.
          if (opened.current) { setReconnects(n => n + 1); refreshProjects() }
          opened.current = true
          refreshRoles(); refreshTeam(); refreshRunners(); refreshAttention(); refreshMySteps()
          setTick(t => t + 1)
          setEventTick(t => t + 1)
          setDiscoveryTick(t => t + 1)
        }
      },
    })
  }, [streamProjectId, refreshAttention, refreshProjects, refreshRoles, refreshTeam, refreshRunners, refreshMySteps, agentWork])
  // Лента событий относится к выбранному проекту; новый поток — первое
  // подключение, а не переподключение.
  useEffect(() => { setRecent([]); opened.current = false }, [streamProjectId])

  return (
    <Ctx.Provider value={{
      route, nav, href, projects, projectId, streamProjectId, resolving, notice, dismissNotice,
      attention, mySteps, connected, tick, eventTick, lastEvent, recent, reconnects, discoveryTick, logs: logsRef.current,
      deployLogs: deployLogsRef.current, refreshProjects, refreshAttention, refreshMySteps,
      roles, roleOf, refreshRoles, team, refreshTeam, runners, refreshRunners,
      overviewAvailable, listen,
    }}>
      {children}
    </Ctx.Provider>
  )
}
