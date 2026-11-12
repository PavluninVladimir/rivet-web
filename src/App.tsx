import { Fragment, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { api, setOnPasswordChangeRequired, setOnUnauthorized, type Project, type User } from './api/client'
import { StoreProvider, routeHash, useStore } from './store'
import { INSTALL_ITEMS, PROJECT_SECTIONS, activeItem, crumbs, installRoute, isSubPage, sectionRoute, switchProject } from './routes'
import { ErrorBoundary, lazyWithReload } from './components/ErrorBoundary'
import { EpicsView } from './views/EpicsView'
import { EpicDashboard } from './views/EpicDashboard'
import { DiscoveryView } from './views/DiscoveryView'
import { ProjectsView } from './views/ProjectsView'
import { ProjectSettings } from './views/ProjectSettings'
import { TasksView } from './views/TasksView'
import { TeamView } from './views/TeamView'
import { MyStepsView } from './views/MyStepsView'
import { RunnersView } from './views/RunnersView'
import { ActivityView } from './views/ActivityView'
import { UsageView } from './views/UsageView'
import { OverviewView } from './views/OverviewView'
import { CycleView } from './views/CycleView'
import { ReleasesView } from './views/ReleasesView'
import { IncidentsView } from './views/IncidentsView'
import { AppManagement } from './views/AppManagement'
// Представление архитектуры грузится отдельным чанком: основной бандл
// не растёт ради экрана, который открывают не каждый раз.
// После обновления rivetd старого чанка нет: одна автоматическая
// перезагрузка, потом сообщение на экране (ErrorBoundary ниже).
const ArchitectureView = lazy(lazyWithReload(() => import('./views/ArchitectureView').then(m => ({ default: m.ArchitectureView }))))
import { PasswordGate, Profile } from './views/Profile'
import { Login } from './components/Login'
import { Palette } from './components/Palette'
import { Select } from './components/form'
import { useMedia } from './components/useMedia'
import { boundaryKey } from './components/boundaryKey'

// Переключатель проекта в блоке проекта. Выбор мышью или из открытого
// списка переходит сразу. Стрелки на закрытом списке (Windows, Linux,
// Firefox) шлют change на каждое нажатие: такой просмотр только меняет
// значение, переход — по Enter, Escape и уход фокуса возвращают текущий
// проект (WCAG 3.2.2: смена значения не меняет контекст сама). Просмотр
// отличается от выбора тем, что change приходит в той же задаче, что и
// нажатие клавиши: браузер шлёт его из обработки keydown. На macOS
// стрелки открывают список, и выбор в нём приходит отдельной задачей.
const BROWSE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
function ProjectSwitch({ projects, current, onPick }: { projects: Project[]; current: string; onPick: (id: string) => void }) {
  const [pending, setPending] = useState<string | null>(null)
  const keyDown = useRef(false)
  const commit = (id: string) => { setPending(null); if (id !== current) onPick(id) }
  return (
    <Select size="sm" className="side-project-select" aria-label="Проект" value={pending ?? current}
      onKeyDown={e => {
        if ((BROWSE_KEYS.has(e.key) && !e.altKey) || e.key.length === 1) {
          keyDown.current = true
          // Новая задача, а не микрозадача: change от стрелки приходит после
          // обработчиков keydown, но в той же задаче.
          setTimeout(() => { keyDown.current = false }, 0)
        }
        if (e.key === 'Enter' && pending) { e.preventDefault(); commit(pending) }
        // Отмена просмотра не закрывает панель узкого экрана: Escape
        // остаётся у переключателя.
        if (e.key === 'Escape' && pending) { e.stopPropagation(); setPending(null) }
      }}
      onBlur={() => setPending(null)}
      onChange={e => {
        const id = e.target.value
        if (keyDown.current) setPending(id)
        else commit(id)
      }}>
      {!projects.some(p => p.ID === current) && <option value={current}>…</option>}
      {projects.map(p => <option key={p.ID} value={p.ID}>{p.Name}</option>)}
    </Select>
  )
}

// Узкий экран: боковая панель выезжает по кнопке «Меню». Граница та же,
// что в styles.css.
const NARROW = '(max-width: 720px)'

// Боковая панель (add-project-navigation, спека web «Навигация по
// проекту»): вне проекта — только пункты установки, в проекте — блок
// проекта, разделы проекта и ниже компактная группа установки.
function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { route, nav, attention, mySteps, connected, projects, projectId, overviewAvailable, resolving, notice, dismissNotice } = useStore()
  const [palOpen, setPalOpen] = useState(false)
  const narrow = useMedia(NARROW)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuOpenRef = useRef(false)
  menuOpenRef.current = menuOpen
  const menuBtn = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalOpen(o => !o)
      }
      if (e.key === 'Escape') {
        setPalOpen(false)
        closeMenuRef.current('menu')
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  // Выбор пункта закрывает панель на узком экране, в том числе текущего:
  // адрес тогда не меняется. Фокус уходит к экрану, а не в скрытую панель.
  // Escape и подложка возвращают фокус на «Меню». Фокус переводится после
  // отрисовки: пока панель открыта, экран за подложкой недоступен (inert).
  const here = routeHash(route)
  // nav — текущий раздел боковой панели (без текущего первый пункт): туда
  // уходит фокус с кнопки «Меню», когда окно стало широким и кнопки нет.
  const focusAfter = useRef<'menu' | 'viewport' | 'nav' | null>(null)
  const focusTo = (to: 'menu' | 'viewport' | 'nav') => {
    if (to === 'menu') menuBtn.current?.focus()
    else if (to === 'viewport') viewport.current?.focus()
    else (sidebar.current?.querySelector<HTMLElement>('.nav-item[aria-current]') ?? sidebar.current?.querySelector<HTMLElement>('.nav-item'))?.focus()
  }
  // Смена адреса (в том числе «Назад» браузера) закрывает панель, фокус
  // уходит к экрану, а не остаётся в скрытой панели.
  useEffect(() => {
    if (menuOpenRef.current) focusAfter.current = 'viewport'
    setMenuOpen(false)
  }, [here])
  // Окно стало широким, пока фокус на «Меню»: на широком экране кнопки нет,
  // и браузер уводит фокус с неё в body ещё до события change у matchMedia
  // (fix-console-rivetd-tails). Потеря фокуса «в никуда» у кнопки, которая
  // перестала отображаться, и есть этот случай: фокус переходит на текущий
  // раздел боковой панели. Уход фокуса по Tab или щелчком мимо сюда не
  // попадает: у первого есть получатель, во втором кнопка видна.
  useEffect(() => {
    const btn = menuBtn.current
    if (!btn) return
    const onBlur = (e: FocusEvent) => {
      if (e.relatedTarget || btn.getClientRects().length > 0) return
      setTimeout(() => {
        const a = document.activeElement
        if (!a || a === document.body) focusTo('nav')
      })
    }
    btn.addEventListener('blur', onBlur)
    return () => btn.removeEventListener('blur', onBlur)
  }, [])
  // Окно стало широким (поворот телефона, ресайз): панель уже на месте,
  // режим выезжающей панели снимается, иначе экран остался бы inert.
  // Браузер, который оставляет фокус на скрытой кнопке «Меню», тоже учтён:
  // фокус переводит эффект закрытия панели, а при закрытой панели — этот.
  useEffect(() => {
    if (narrow) return
    if (document.activeElement === menuBtn.current) focusAfter.current = 'nav'
    if (menuOpenRef.current) { setMenuOpen(false); return }
    if (focusAfter.current === 'nav') focusTo('nav')
    focusAfter.current = null
  }, [narrow])
  const closeMenu = (to: 'menu' | 'viewport' = 'viewport') => {
    if (!menuOpenRef.current) return
    focusAfter.current = to
    setMenuOpen(false)
  }
  const closeMenuRef = useRef(closeMenu)
  closeMenuRef.current = closeMenu
  useEffect(() => {
    if (menuOpen || !focusAfter.current) return
    focusTo(focusAfter.current)
    focusAfter.current = null
  }, [menuOpen])
  // Открытая панель забирает фокус: первый её элемент.
  useEffect(() => {
    if (menuOpen) sidebar.current?.querySelector<HTMLElement>('a[href], button, select')?.focus()
  }, [menuOpen])

  const backdrop = menuOpen && narrow
  const project = projects.find(p => p.ID === projectId)
  const projectName = project?.Name ?? '…'
  // Эскалации: у «Задач» только текущий проект, у входа в список проектов
  // остальные (спека «Счётчики эскалаций по проектам»).
  const mine = projectId ? attention.filter(a => a.ProjectID === projectId).length : 0
  const others = attention.length - mine
  // Пока старый адрес разрешается, ни один пункт не отмечен.
  const active = resolving ? '' : activeItem(route)
  const current = isSubPage(route) ? 'true' : 'page'
  const sections = PROJECT_SECTIONS.filter(s => s.view !== 'overview' || overviewAvailable)
  const install = INSTALL_ITEMS.filter(i => (!i.admin || user.admin) && !(projectId && i.view === 'projects'))

  // Счётчик не входит в имя пункта: имя остаётся «Задачи», а число
  // скринридер читает описанием («эскалаций проекта ждут решения: 2»).
  // Скрытое описание лежит рядом с пунктом, а не внутри него.
  const count = (n: number, what: string) => n > 0 && <span className="count warn" aria-hidden="true" title={what}>{n}</span>
  const described = (id: string, n: number, what: string) => n > 0 && <span id={id} hidden>{what}: {n}</span>
  const item = (key: string, label: string, go: () => void, n = 0, what = '') => (
    <Fragment key={key}>
      <button className={'nav-item' + (active === key ? ' active' : '')}
        aria-current={active === key ? current : undefined} aria-describedby={n > 0 ? `nav-count-${key}` : undefined}
        onClick={() => { go(); closeMenu() }}>
        {label}
        {count(n, what)}
      </button>
      {described(`nav-count-${key}`, n, what)}
    </Fragment>
  )
  const installItems = install.map(i => item(i.view, i.label, () => nav(installRoute(i.view)),
    i.view === 'mysteps' ? mySteps : i.view === 'projects' ? others : 0,
    i.view === 'mysteps' ? 'запусков ждут вашего вердикта' : 'эскалаций в проектах'))

  return (
    <div id="app" className={menuOpen ? 'menu-open' : undefined}>
      <aside id="sidebar" ref={sidebar} className={menuOpen ? 'open' : undefined}>
        <div className="side-brand">
          <span className="glyph">R</span><b>Rivet</b>
          <span className="env">DEV</span>
        </div>
        {projectId ? (
          <>
            <div className="side-project">
              <a className="side-back" href={routeHash({ view: 'projects' })} onClick={() => closeMenu()}
                aria-describedby={others > 0 ? 'nav-count-back' : undefined}>
                <span aria-hidden="true">←</span> Все проекты
                {count(others, 'эскалаций в других проектах')}
              </a>
              {described('nav-count-back', others, 'эскалаций в других проектах')}
              {projects.length > 1
                ? <ProjectSwitch projects={projects} current={projectId}
                    onPick={id => { nav(switchProject(route, id)); closeMenu() }} />
                : <div className="side-project-name" title={projectName}>{projectName}</div>}
            </div>
            <nav aria-label="Разделы проекта">
              {sections.map(s => item(s.view, s.label, () => nav(sectionRoute(s.view, projectId)),
                s.view === 'tasks' ? mine : 0, 'эскалаций проекта ждут решения'))}
            </nav>
            <nav aria-label="Установка" className="side-install">
              <div className="side-group" aria-hidden="true">Установка</div>
              {installItems}
            </nav>
          </>
        ) : (
          <nav aria-label="Установка">{installItems}</nav>
        )}
        <div className="side-foot">
          <div className="line" title={user.login}>
            <a className="mono side-user" href={routeHash({ view: 'profile' })} onClick={() => closeMenu()}>
              {user.name || user.login}
            </a>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onLogout}>Выйти</button>
          </div>
          <div className="line">
            <span className={'dot ' + (connected ? 'ok' : 'bad')} />
            {connected ? 'Подключено' : 'Нет связи'}
          </div>
        </div>
      </aside>
      {backdrop && <div className="side-backdrop" onClick={() => closeMenu('menu')} />}

      <div id="main">
        <header id="topbar">
          <button ref={menuBtn} className="btn sm menu-btn" aria-controls="sidebar" aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}>Меню</button>
          {/* Пока панель открыта, экран за подложкой недоступен (inert), а
              кнопка «Меню» остаётся: ею панель закрывает и скринридер. */}
          <nav className="crumb" aria-label="Путь" inert={backdrop || undefined}>
            {crumbs(route, projectName).map((c, i, all) => (
              <Fragment key={i}>
                {i > 0 && <span className="sep" aria-hidden="true">/</span>}
                {c.href
                  ? <a href={c.href}>{c.label}</a>
                  : <b aria-current={i === all.length - 1 ? 'page' : undefined}>{c.label}</b>}
              </Fragment>
            ))}
          </nav>
          <button className="kbtn" aria-label="Поиск или команда" onClick={() => setPalOpen(true)} inert={backdrop || undefined}>
            <span className="kbtn-text">Поиск или команда…</span> <span className="kbd">⌘K</span>
          </button>
        </header>
        <div id="viewport" ref={viewport} tabIndex={-1} inert={backdrop || undefined}>
          {notice && (
            <div className="nav-notice" role="alert">
              <span>{notice.text}</span>
              <button className="btn sm" onClick={dismissNotice}>Закрыть</button>
            </div>
          )}
          {/* Падение экрана не гасит консоль: навигация и боковая панель
              работают. key от экрана и проекта перемонтирует экран там, где
              меняются его данные, resetKey снимает заглушку при переходе на
              другой адрес того же экрана (задача в дашборде, вкладка). */}
          {resolving
            ? <div className="page"><span className="muted">Загрузка…</span></div>
            : (
              <ErrorBoundary key={boundaryKey(route)} resetKey={here} what="экран" page>
                {route.view === 'projects' && <ProjectsView />}
                {route.view === 'project-settings' && <ProjectSettings key={route.pid} projectId={route.pid} tab={route.tab} user={user} />}
                {route.view === 'profile' && <Profile me={user} />}
                {/* Раздел установки — только администратору: прямой переход по
                    адресу показывает отказ, а не данные (спека web). */}
                {route.view === 'app-management' && (user.admin
                  ? <AppManagement me={user} tab={route.tab} />
                  : <div className="page"><span className="muted">Раздел доступен только администратору установки.</span></div>)}
                {route.view === 'epics' && <EpicsView />}
                {route.view === 'epic' && <EpicDashboard key={route.id} projectId={route.pid} epicId={route.id} taskId={route.taskId} admin={user.admin} login={user.login} />}
                {route.view === 'discovery' && <DiscoveryView key={route.pid} user={user} runId={route.runId} />}
                {route.view === 'tasks' && <TasksView />}
                {route.view === 'team' && <TeamView />}
                {route.view === 'mysteps' && <MyStepsView />}
                {route.view === 'runners' && <RunnersView admin={user.admin} />}
                {route.view === 'activity' && <ActivityView />}
                {route.view === 'usage' && <UsageView />}
                {route.view === 'overview' && <OverviewView key={route.pid} period={route.period} focus={route.focus} user={user} />}
                {route.view === 'cycle' && <CycleView key={route.pid} projectId={route.pid} phase={route.phase} period={route.period} agentId={route.agentId} focus={route.focus} state={route.state} admin={user.admin} />}
                {route.view === 'releases' && <ReleasesView id={route.id} login={user.login} />}
                {route.view === 'incidents' && <IncidentsView id={route.id} login={user.login} />}
                {route.view === 'architecture' && (
                  <Suspense fallback={<div className="page"><span className="muted">Загрузка…</span></div>}>
                    <ArchitectureView key={route.pid} route={route} />
                  </Suspense>
                )}
              </ErrorBoundary>
            )}
        </div>
      </div>

      {palOpen && <Palette admin={user.admin} onClose={() => setPalOpen(false)} />}
    </div>
  )
}

export default function App() {
  // undefined — сессия ещё проверяется, null — нужен вход.
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    // 401 в любой момент работы возвращает на экран входа; hash-маршрут
    // сохраняется, после входа пользователь попадает на ту же страницу.
    setOnUnauthorized(() => setUser(null))
    // Пароль сброшен администратором: любой отказ password_change_required
    // переводит консоль на форму смены пароля.
    setOnPasswordChangeRequired(() => setUser(u => (u ? { ...u, must_change_password: true } : u)))
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  const logout = () => { api.logout().catch(() => {}).finally(() => setUser(null)) }

  if (user === undefined) return <div className="login-wrap"><span className="muted">Загрузка…</span></div>
  if (!user) return <Login onLogin={setUser} />
  if (user.must_change_password) {
    return <PasswordGate onDone={() => { api.me().then(setUser).catch(() => setUser(null)) }} />
  }
  return <StoreProvider><Shell user={user} onLogout={logout} /></StoreProvider>
}
