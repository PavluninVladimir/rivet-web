import { useCallback, useEffect, useRef, useState } from 'react'
import { api, budgetPaused, type Check, type Member, type Project, type RepositoryStatus, type User } from '../api/client'
import { Environments } from '../components/Environments'
import { ProjectPolicySection } from '../components/PolicyPanel'
import { fmtDate, fmtTokens } from '../components/ui'
import { useStore } from '../store'

// Страница настроек проекта (спека web «Страница настроек проекта»):
// всё про проект в одном месте — репозиторий и состояние подключения,
// webhook, проверки, участники, окружения публикации.

const STATE_LABEL: Record<string, string> = {
  ok: 'подключение работает',
  invalid: 'подключение не работает',
  unchecked: 'подключение не проверялось',
}

export function ProjectSettings({ projectId, user }: { projectId: string; user: User }) {
  const { tick, projects, refreshProjects } = useStore()
  const project: Project | undefined = projects.find(p => p.ID === projectId)
  const [repo, setRepo] = useState<RepositoryStatus | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [checks, setChecks] = useState<Check[]>([])
  const [token, setToken] = useState('')
  const [login, setLogin] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const refresh = useCallback(() => {
    api.repository(projectId).then(setRepo).catch(() => setRepo(null))
    api.members(projectId).then(m => setMembers(m ?? [])).catch(() => setMembers([]))
  }, [projectId])
  useEffect(refresh, [refresh, tick]) // tick растёт на project.repository/project.settings

  // Форма заполняется один раз на проект: фоновое обновление списка
  // (SSE-события) не должно затирать то, что человек уже правит.
  const loadedFor = useRef('')
  useEffect(() => {
    if (!project || loadedFor.current === project.ID) return
    loadedFor.current = project.ID
    setName(project.Name)
    setChecks(project.Checks ?? [])
  }, [project])

  const act = (fn: () => Promise<unknown>, msg = '') => async () => {
    setErr(''); setSaved('')
    try { await fn(); setSaved(msg); refresh(); refreshProjects() } catch (e) { setErr(String(e)) }
  }

  if (!project) return <div className="page"><span className="muted">Проект не найден.</span></div>

  // Меняет настройки только владелец проекта (спека domain-model); остальным
  // страница показывает те же данные без изменяющих действий.
  const isOwner = members.some(m => m.login === user.login && m.role === 'owner')

  return (
    <div className="page">
      <div className="page-head">
        <h1>Настройки проекта</h1>
        <span className="sub">{project.Name}{isOwner ? '' : ' · только просмотр'}</span>
      </div>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {saved && <div style={{ color: 'var(--c-done)', fontSize: 12, marginBottom: 8 }}>{saved}</div>}

      <div className="dw-sec">
        <h3>Репозиторий</h3>
        {repo ? (
          <>
            <div className="meta-grid">
              <div className="kv"><span>хостинг</span><b>{repo.provider}</b></div>
              <div className="kv"><span>инстанс</span><b>{repo.base_url}</b></div>
              <div className="kv"><span>репозиторий</span>
                <b><a href={repo.web_url} target="_blank" rel="noreferrer">{repo.repo_path}</a></b></div>
              <div className="kv"><span>базовая ветка</span><b>{repo.default_branch}</b></div>
              <div className="kv"><span>подключение</span>
                <b style={{ color: repo.state === 'ok' ? 'var(--c-done)' : repo.state === 'invalid' ? 'var(--c-fail)' : undefined }}>
                  {STATE_LABEL[repo.state] ?? repo.state}
                </b></div>
              <div className="kv"><span>учётные данные</span>
                <b>{repo.credential ? `${repo.credential.owner} · ${repo.credential.token_prefix}…` : 'токен установки'}</b></div>
            </div>
            {isOwner && (
              <div className="row" style={{ marginTop: 8 }}>
                <input type="password" placeholder="Новый токен доступа"
                  value={token} onChange={e => setToken(e.target.value)} />
                <button className="btn sm" disabled={!token}
                  onClick={act(async () => { await api.replaceCredentials(projectId, token); setToken('') },
                    'учётные данные заменены')}>
                  Заменить токен
                </button>
              </div>
            )}
          </>
        ) : <span className="muted">нет данных о подключении</span>}
      </div>

      <div className="dw-sec">
        <h3>Webhook</h3>
        {repo?.webhook.registered
          ? <div className="muted" style={{ fontSize: 12.5 }}>Зарегистрирован системой: {repo.webhook.url}</div>
          : (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Не зарегистрирован — настройте на хостинге вручную.
              {repo?.webhook.url ? <> URL: <span className="mono">{repo.webhook.url}</span>.</> : null}
              {repo?.webhook.secret_hint ? <> {repo.webhook.secret_hint}</> : null}
            </div>
          )}
      </div>

      <div className="dw-sec">
        <h3>Название и проверки</h3>
        <input placeholder="Название проекта" value={name} disabled={!isOwner}
          onChange={e => setName(e.target.value)} />
        {checks.map((c, i) => (
          <div className="row" key={i} style={{ gap: 8, marginTop: 6 }}>
            <input placeholder="Имя" value={c.name} disabled={!isOwner}
              onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input placeholder="Команда" value={c.cmd} disabled={!isOwner}
              onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, cmd: e.target.value } : x))} />
            {isOwner && <button className="btn sm" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        {isOwner && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setChecks([...checks, { name: '', cmd: '' }])}>
              Добавить проверку
            </button>
            <button className="btn sm primary" style={{ marginLeft: 'auto' }}
              onClick={act(() => api.patchProject(projectId, { name, checks }), 'настройки сохранены')}>
              Сохранить настройки
            </button>
          </div>
        )}
      </div>

      <div className="dw-sec">
        <h3>Участники</h3>
        <div className="sess-list">
          {members.map(m => (
            <div className="sess-row" key={m.login}>
              <span className="mono">{m.login}</span>
              <span className="sess-agent">{m.name}</span>
              <span className="chip"><span className="n">{m.role}</span></span>
              {isOwner && (
                <>
                  <button className="btn sm"
                    onClick={act(() => api.setMemberRole(projectId, m.login, m.role === 'owner' ? 'member' : 'owner'),
                      'роль изменена')}>
                    {m.role === 'owner' ? 'Снять владельца' : 'Сделать владельцем'}
                  </button>
                  <button className="btn sm" onClick={act(() => api.removeMember(projectId, m.login), 'участник удалён')}>
                    Удалить
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="Логин участника" value={login} onChange={e => setLogin(e.target.value)} />
            <button className="btn sm" disabled={!login}
              onClick={act(async () => { await api.addMember(projectId, login); setLogin('') }, 'участник добавлен')}>
              Добавить
            </button>
          </div>
        )}
      </div>

      <ProjectPolicySection projectId={projectId} isOwner={isOwner} tick={tick} />

      <div className="dw-sec">
        <h3>Бюджет токенов</h3>
        {project.budget ? (
          <div className="meta-grid">
            <div className="kv"><span>дневной лимит</span>
              <b>{project.budget.daily_tokens == null ? 'без ограничения' : fmtTokens(project.budget.daily_tokens)}</b></div>
            <div className="kv"><span>засчитано сегодня (UTC)</span><b>{fmtTokens(project.budget.used_today)}</b></div>
            <div className="kv"><span>планирование</span>
              <b style={{ color: budgetPaused(project.budget) ? 'var(--c-block)' : undefined }}>
                {budgetPaused(project.budget)
                  ? `на паузе: бюджет ${project.budget.paused_scope === 'installation' ? 'установки' : 'проекта'} исчерпан, до ${fmtDate(project.budget.paused_until)}`
                  : 'идёт'}
              </b></div>
          </div>
        ) : <span className="muted">нет данных</span>}
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          В бюджет засчитываются только сообщённые токены. Выполняющиеся стадии на паузе дорабатываются, новые не назначаются до начала следующих суток.
        </div>
      </div>

      <Environments projectId={projectId} isAdmin={user.admin} />
    </div>
  )
}
