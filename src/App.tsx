import { useEffect, useState } from 'react'
import { api, setOnPasswordChangeRequired, setOnUnauthorized, type User } from './api/client'
import { StoreProvider, useStore, type Route } from './store'
import { EpicsView } from './views/EpicsView'
import { EpicDashboard } from './views/EpicDashboard'
import { ProjectsView } from './views/ProjectsView'
import { ProjectSettings } from './views/ProjectSettings'
import { TasksView } from './views/TasksView'
import { TeamView } from './views/TeamView'
import { RunnersView } from './views/RunnersView'
import { ActivityView } from './views/ActivityView'
import { UsageView } from './views/UsageView'
import { AppManagement } from './views/AppManagement'
import { PasswordGate, Profile } from './views/Profile'
import { Login } from './components/Login'
import { Palette } from './components/Palette'

const NAV: { view: Route['view']; label: string }[] = [
  { view: 'projects', label: 'Проекты' },
  { view: 'epics', label: 'Epic’и' },
  { view: 'tasks', label: 'Задачи' },
  { view: 'team', label: 'Команда' },
  { view: 'runners', label: 'Runner’ы' },
  { view: 'activity', label: 'Активность' },
  { view: 'usage', label: 'Usage' },
]

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { route, nav, attention, connected, projects, projectId, setProjectId } = useStore()
  const [palOpen, setPalOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalOpen(o => !o)
      }
      if (e.key === 'Escape') setPalOpen(false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const project = projects.find(p => p.ID === projectId)
  const open = attention.length

  return (
    <div id="app">
      <aside id="sidebar">
        <div className="side-brand">
          <span className="glyph">R</span><b>Rivet</b>
          <span className="env">DEV</span>
        </div>
        <nav>
          {NAV.map(n => (
            <button key={n.view}
              className={'nav-item' + (route.view === n.view || (n.view === 'epics' && route.view === 'epic') ? ' active' : '')}
              onClick={() => nav({ view: n.view } as Route)}>
              {n.label}
              {n.view === 'tasks' && open > 0 && <span className="count warn">{open}</span>}
            </button>
          ))}
        </nav>
        {user.admin && (
          <nav style={{ marginTop: 6 }}>
            <button className={'nav-item' + (route.view === 'app-management' ? ' active' : '')}
              onClick={() => nav({ view: 'app-management', tab: 'users' })}>
              Управление
            </button>
          </nav>
        )}
        <div className="side-foot">
          <div className="line" title={user.login}>
            <a className="mono" style={{ cursor: 'pointer' }} onClick={() => nav({ view: 'profile' })}>
              {user.name || user.login}
            </a>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onLogout}>Выйти</button>
          </div>
          <div className="line">
            <span className={'dot ' + (connected ? 'ok' : 'bad')} />
            {connected ? 'Подключено' : 'Нет связи'}
          </div>
          {projects.length > 1 && (
            <select className="search" style={{ width: '100%', marginTop: 8 }}
              value={projectId ?? ''} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.ID} value={p.ID}>{p.Name}</option>)}
            </select>
          )}
        </div>
      </aside>

      <div id="main">
        <header id="topbar">
          <div className="crumb">
            <span className="mono">{project?.Name ?? '—'}</span>
            {route.view === 'epic'
              ? <><span className="sep">/</span><a onClick={() => nav({ view: 'epics' })}>Epic’и</a><span className="sep">/</span><b>дашборд</b></>
              : route.view === 'project-settings'
                ? <><span className="sep">/</span><a onClick={() => nav({ view: 'projects' })}>Проекты</a><span className="sep">/</span><b>настройки</b></>
                : route.view === 'app-management'
                  ? <><span className="sep">/</span><b>Управление приложением</b></>
                  : route.view === 'profile'
                    ? <><span className="sep">/</span><b>Профиль</b></>
                    : <><span className="sep">/</span><b>{NAV.find(n => n.view === route.view)?.label ?? ''}</b></>}
          </div>
          <button className="kbtn" onClick={() => setPalOpen(true)}>
            Поиск или команда… <span className="kbd">⌘K</span>
          </button>
        </header>
        <div id="viewport">
          {route.view === 'projects' && <ProjectsView />}
          {route.view === 'project-settings' && <ProjectSettings key={route.id} projectId={route.id} user={user} />}
          {route.view === 'profile' && <Profile me={user} />}
          {/* Раздел установки — только администратору: прямой переход по
              адресу показывает отказ, а не данные (спека web). */}
          {route.view === 'app-management' && (user.admin
            ? <AppManagement me={user} tab={route.tab} />
            : <div className="page"><span className="muted">Раздел доступен только администратору установки.</span></div>)}
          {route.view === 'epics' && <EpicsView />}
          {route.view === 'epic' && <EpicDashboard key={route.id} epicId={route.id} taskId={route.taskId} />}
          {route.view === 'tasks' && <TasksView />}
          {route.view === 'team' && <TeamView />}
          {route.view === 'runners' && <RunnersView admin={user.admin} />}
          {route.view === 'activity' && <ActivityView />}
          {route.view === 'usage' && <UsageView />}
        </div>
      </div>

      {palOpen && <Palette onClose={() => setPalOpen(false)} />}
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
