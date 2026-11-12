import type { CyclePeriod, CyclePhaseId, OverviewPeriod } from './api/client'
// Модуль под юнит-тестом (node --test без сборщика) импортирует чистые
// модули с расширением .ts, иначе Node их не найдёт (tsconfig:
// allowImportingTsExtensions). Сюда идут только модули без React и API.
import { archRouteHash, parseArchRoute, type ArchRoute } from './components/archModel.ts'
import { isPhase } from './components/cycleGeometry.ts'
import { parsePeriod } from './components/overviewLogic.ts'

// Адреса консоли (add-project-navigation, спека web «Проект в адресе
// экранов проекта» и «Совместимость старых адресов»). Экраны проекта
// живут под #/p/<проект>/<раздел>…, экраны установки без проекта:
// #/projects, #/mysteps, #/runners, #/usage, #/app-management/<вкладка>,
// #/profile. Чистые функции: разбор, сборка, старые адреса, переключение
// проекта, пункты меню и крошки.

// Вкладки раздела «Управление приложением»: #/app-management/<tab>.
export const APP_TABS = ['users', 'runners', 'agents', 'team', 'roles', 'connections', 'policies', 'usage', 'audit', 'status'] as const
export type AppTab = typeof APP_TABS[number]
// Вкладки настроек проекта: #/p/<проект>/settings/<tab> (add-project-settings-tabs).
export const SETTINGS_TABS = ['general', 'members', 'process', 'policies', 'environments'] as const
export type SettingsTab = typeof SETTINGS_TABS[number]
const CYCLE_PERIODS: readonly CyclePeriod[] = ['today', '7d', '30d']

// Экран проекта всегда знает свой проект: pid — часть адреса.
export type ProjectRoute =
  // Обзор проекта, период в адресе (add-project-lead-view).
  | { view: 'overview'; pid: string; period: OverviewPeriod; focus?: 'money' }
  // Исследование (add-product-discovery): runId — версия из истории.
  | { view: 'discovery'; pid: string; runId?: string }
  // Архитектура (add-architecture-c4): вкладка, уровень или выбор, элемент, фильтр.
  | ({ view: 'architecture'; pid: string } & ArchRoute)
  | { view: 'epics'; pid: string }
  | { view: 'epic'; pid: string; id: string; taskId?: string }
  | { view: 'tasks'; pid: string }
  // Цикл разработки (add-sdlc-cycle): фаза и период в query.
  | { view: 'cycle'; pid: string; phase?: CyclePhaseId; period?: CyclePeriod; agentId?: string; focus?: 'agents' | 'items' | 'artifacts'; state?: 'active' | 'waiting' | 'needs_human' }
  | { view: 'releases'; pid: string; id?: string }
  | { view: 'incidents'; pid: string; id?: string }
  | { view: 'team'; pid: string }
  | { view: 'activity'; pid: string }
  | { view: 'project-settings'; pid: string; tab: SettingsTab }

export type InstallRoute =
  | { view: 'projects' } | { view: 'mysteps' } | { view: 'runners' } | { view: 'usage' }
  | { view: 'app-management'; tab: AppTab } | { view: 'profile' }

export type Route = ProjectRoute | InstallRoute
export type ProjectView = ProjectRoute['view']
export type InstallView = InstallRoute['view']

// Цель перехода: экран проекта может не называть проект, тогда консоль
// подставляет текущий (withProject).
type Unpinned<R> = R extends { pid: string } ? Omit<R, 'pid'> & { pid?: string } : R
export type NavTarget = Unpinned<Route>
export type ProjectTarget = Unpinned<ProjectRoute>

const PROJECT_VIEWS: readonly string[] = ['overview', 'discovery', 'architecture', 'epics', 'epic', 'tasks', 'cycle',
  'releases', 'incidents', 'team', 'activity', 'project-settings'] satisfies ProjectView[]

export const isProjectView = (v: string): v is ProjectView => PROJECT_VIEWS.includes(v)
export const isProjectRoute = (r: Route): r is ProjectRoute => isProjectView(r.view)
export const routeProject = (r: Route): string | null => isProjectRoute(r) ? r.pid : null

// Первый экран проекта: обзор за 7 суток.
export const projectHome = (pid: string): Route => ({ view: 'overview', pid, period: '7d' })

// ─── разбор ──────────────────────────────────────────────────────────────

// route — адрес в текущем формате; legacy — старый адрес экрана проекта
// (pid есть, если старый адрес нёс проект); home — пустой или
// неизвестный адрес.
export type Parsed =
  | { kind: 'route'; route: Route }
  | { kind: 'legacy'; target: ProjectTarget }
  | { kind: 'home' }

function dec(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

function cycleTarget(query: string): ProjectTarget {
  const q = new URLSearchParams(query)
  const phase = q.get('phase'), period = q.get('period')
  const t: Extract<ProjectTarget, { view: 'cycle' }> = { view: 'cycle' }
  if (isPhase(phase)) {
    t.phase = phase
    const agent=q.get('agent'),focus=q.get('focus'),state=q.get('state')
    if(agent && /^[a-z0-9][a-z0-9-]{0,62}$/.test(agent))t.agentId=agent
    if(focus==='agents'||focus==='items'||focus==='artifacts')t.focus=focus
    if(t.focus==='items'&&(state==='active'||state==='waiting'||state==='needs_human'))t.state=state
  }
  if (period && (CYCLE_PERIODS as readonly string[]).includes(period)) t.period = period as CyclePeriod
  return t
}

// Раздел проекта по сегменту и остатку пути. null — сегмент не раздел.
function parseSection(section: string, rest: string[], query: string): ProjectTarget | null {
  const [b, c, d] = rest
  switch (section) {
    case 'overview': return { view: 'overview', period: parsePeriod(b), ...(new URLSearchParams(query).get('focus')==='money'?{focus:'money' as const}:{}) }
    case 'discovery': return b ? { view: 'discovery', runId: b } : { view: 'discovery' }
    case 'architecture': return { view: 'architecture', ...parseArchRoute([b, c, d], query) }
    case 'epics': return { view: 'epics' }
    case 'epic':
      if (!b) return { view: 'epics' }
      return c === 'task' && d ? { view: 'epic', id: b, taskId: d } : { view: 'epic', id: b }
    case 'tasks': case 'team': case 'activity': return { view: section }
    case 'cycle': return cycleTarget(query)
    case 'releases': case 'incidents': return b ? { view: section, id: b } : { view: section }
    case 'settings':
      return { view: 'project-settings', tab: (SETTINGS_TABS as readonly string[]).includes(b) ? b as SettingsTab : 'general' }
    default: return null
  }
}

// Разделы, которые до add-project-navigation жили в корне адреса без
// проекта: #/epics, #/epic/<id>, #/architecture/… и т.д.
const LEGACY_ROOT = ['overview', 'discovery', 'architecture', 'epics', 'epic', 'tasks', 'releases', 'incidents', 'team', 'activity']

export function parseHash(hash: string): Parsed {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [a = '', ...rest] = path.split('/')
  if (a === 'p') {
    const [raw, section = '', ...more] = rest
    const pid = raw ? dec(raw) : ''
    if (!pid) return { kind: 'home' }
    // Неизвестный раздел и адрес без раздела открывают обзор проекта.
    const t = parseSection(section, more, query) ?? { view: 'overview', period: '7d' }
    return { kind: 'route', route: { ...t, pid } as Route }
  }
  switch (a) {
    case 'projects': case 'mysteps': case 'runners': case 'usage': case 'profile':
      return { kind: 'route', route: { view: a } }
    case 'app-management': {
      // Старый адрес вкладки «Модели» ведёт на «Подключения» (add-model-connections).
      const tab = rest[0] === 'models' ? 'connections' : rest[0]
      return { kind: 'route', route: { view: 'app-management', tab: (APP_TABS as readonly string[]).includes(tab) ? tab as AppTab : 'users' } }
    }
    // Старые адреса с проектом: #/project/<id>/cycle и #/project/<id>/settings/<tab>.
    case 'project': {
      const [raw, section, ...more] = rest
      if (raw && (section === 'cycle' || section === 'settings')) {
        return { kind: 'legacy', target: { ...parseSection(section, more, query)!, pid: dec(raw) } }
      }
      return { kind: 'home' }
    }
    // Самый ранний адрес цикла: #/cycle/<проект>.
    case 'cycle':
      return { kind: 'legacy', target: rest[0] ? { ...cycleTarget(query), pid: dec(rest[0]) } : cycleTarget(query) }
  }
  const t = LEGACY_ROOT.includes(a) ? parseSection(a, rest, query) : null
  return t ? { kind: 'legacy', target: t } : { kind: 'home' }
}

// ─── сборка ──────────────────────────────────────────────────────────────

export function routeHash(r: Route): string {
  if (!isProjectRoute(r)) return r.view === 'app-management' ? `#/app-management/${r.tab}` : `#/${r.view}`
  const base = `#/p/${encodeURIComponent(r.pid)}`
  switch (r.view) {
    case 'overview': return (r.period === '7d' ? `${base}/overview` : `${base}/overview/${r.period}`)+(r.focus==='money'?'?focus=money':'')
    case 'discovery': return r.runId ? `${base}/discovery/${r.runId}` : `${base}/discovery`
    // archRouteHash отдаёт #/architecture/…: проект встаёт перед разделом.
    case 'architecture': return base + archRouteHash(r).slice(1)
    case 'epic': return r.taskId ? `${base}/epic/${r.id}/task/${r.taskId}` : `${base}/epic/${r.id}`
    case 'cycle': {
      const q = new URLSearchParams()
      if (r.phase) q.set('phase', r.phase)
      if (r.period) q.set('period', r.period)
      if(r.phase){
        if(r.agentId)q.set('agent',r.agentId)
        if(r.focus)q.set('focus',r.focus)
        if(r.focus==='items'&&r.state)q.set('state',r.state)
      }
      const qs = q.toString()
      return `${base}/cycle${qs ? '?' + qs : ''}`
    }
    case 'releases': case 'incidents': return r.id ? `${base}/${r.view}/${r.id}` : `${base}/${r.view}`
    case 'project-settings': return r.tab === 'general' ? `${base}/settings` : `${base}/settings/${r.tab}`
    default: return `${base}/${r.view}`
  }
}

// ─── проект в цели перехода ──────────────────────────────────────────────

// Цель без проекта получает проект pid; без него консоль открывает
// «Проекты»: экран проекта без проекта не показывается.
export function withProject(t: NavTarget, pid: string | null | undefined): Route {
  if (!isProjectView(t.view)) return t as Route
  const own = (t as { pid?: string }).pid || pid
  return own ? { ...t, pid: own } as Route : { view: 'projects' }
}

// Новый адрес для старого: проект из старого адреса, иначе последний
// открытый, иначе «Проекты». Пустой адрес — обзор последнего проекта.
// Проект старого Epic'а стор узнаёт у самого Epic'а до вызова.
export function resolveLegacy(p: Exclude<Parsed, { kind: 'route' }>, lastPid: string | null): Route {
  if (p.kind === 'home') return lastPid ? projectHome(lastPid) : { view: 'projects' }
  return withProject(p.target, lastPid)
}

// Тот же раздел другого проекта без объекта прежнего: Epic'а, релиза,
// инцидента, версии исследования, уровня и элемента архитектуры. Период,
// фаза и вкладка настроек сохраняются. С экрана установки — обзор.
export function switchProject(r: Route, pid: string): Route {
  if (!isProjectRoute(r)) return projectHome(pid)
  switch (r.view) {
    case 'overview': return { ...r, pid }
    case 'cycle': {
      const n: Extract<Route, { view: 'cycle' }> = { view: 'cycle', pid }
      if (r.phase) n.phase = r.phase
      if (r.period) n.period = r.period
      if(r.focus)n.focus=r.focus
      if(r.state)n.state=r.state
      return n
    }
    case 'architecture': return { view: 'architecture', pid, tab: r.tab }
    case 'epic': return { view: 'epics', pid }
    case 'project-settings': return { view: 'project-settings', pid, tab: r.tab }
    case 'discovery': case 'releases': case 'incidents': return { view: r.view, pid }
    default: return { view: r.view, pid }
  }
}

// ─── меню и крошки ───────────────────────────────────────────────────────

// Разделы проекта в порядке боковой панели (спека «Навигация по проекту»).
export const PROJECT_SECTIONS: { view: Exclude<ProjectView, 'epic'>; label: string }[] = [
  { view: 'overview', label: 'Обзор' },
  { view: 'discovery', label: 'Исследование' },
  { view: 'architecture', label: 'Архитектура' },
  { view: 'epics', label: 'Epic’и' },
  { view: 'tasks', label: 'Задачи' },
  { view: 'cycle', label: 'Цикл разработки' },
  { view: 'releases', label: 'Релизы' },
  { view: 'incidents', label: 'Инциденты' },
  { view: 'team', label: 'Команда' },
  { view: 'activity', label: 'Активность' },
  { view: 'project-settings', label: 'Настройки' },
]

// Пункты установки. «Управление» — только администратору.
export const INSTALL_ITEMS: { view: Exclude<InstallView, 'profile'>; label: string; admin?: boolean }[] = [
  { view: 'projects', label: 'Проекты' },
  { view: 'mysteps', label: 'Мои шаги' },
  { view: 'runners', label: 'Runner’ы' },
  { view: 'usage', label: 'Usage' },
  { view: 'app-management', label: 'Управление', admin: true },
]

// Экран пункта меню: вкладки и периоды по умолчанию.
export function sectionRoute(view: Exclude<ProjectView, 'epic'>, pid: string): Route {
  switch (view) {
    case 'overview': return projectHome(pid)
    case 'architecture': return { view: 'architecture', pid, tab: 'hld' }
    case 'project-settings': return { view: 'project-settings', pid, tab: 'general' }
    default: return { view, pid }
  }
}

export function installRoute(view: Exclude<InstallView, 'profile'>): Route {
  return view === 'app-management' ? { view, tab: 'users' } : { view }
}

// Пункт меню, подсвеченный на экране: дашборд Epic'а — в «Epic’ах».
export function activeItem(r: Route): string {
  return r.view === 'epic' ? 'epics' : r.view
}

// Экран внутри раздела (дашборд Epic'а, карточка релиза или инцидента):
// пункт раздела отмечается как родитель (aria-current="true"), а не как
// сама страница.
export function isSubPage(r: Route): boolean {
  return r.view === 'epic' || ((r.view === 'releases' || r.view === 'incidents') && !!r.id)
}

export interface Crumb { label: string; href?: string }

const INSTALL_TITLE: Record<InstallView, string> = {
  projects: 'Проекты', mysteps: 'Мои шаги', runners: 'Runner’ы', usage: 'Usage',
  'app-management': 'Управление приложением', profile: 'Профиль',
}

// Путь в верхней строке (спека «Крошки экрана проекта»): «Проекты /
// проект / раздел», у дашборда Epic'а и карточек релиза и инцидента
// промежуточный раздел ссылкой. Экран установки — только название.
export function crumbs(r: Route, projectName: string): Crumb[] {
  if (!isProjectRoute(r)) return [{ label: INSTALL_TITLE[r.view] }]
  const head: Crumb[] = [{ label: 'Проекты', href: routeHash({ view: 'projects' }) }, { label: projectName, href: routeHash(projectHome(r.pid)) }]
  const label = PROJECT_SECTIONS.find(s => s.view === activeItem(r))?.label ?? ''
  if (r.view === 'epic') return [...head, { label, href: routeHash({ view: 'epics', pid: r.pid }) }, { label: 'дашборд' }]
  if ((r.view === 'releases' || r.view === 'incidents') && r.id) {
    return [...head, { label, href: routeHash({ view: r.view, pid: r.pid }) }, { label: r.view === 'releases' ? 'релиз' : 'инцидент' }]
  }
  return [...head, { label }]
}
