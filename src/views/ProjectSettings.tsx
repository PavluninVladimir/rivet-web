import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, budgetPaused, type Check, type Member, type Project, type RepositoryStatus, type User } from '../api/client'
import { Environments } from '../components/Environments'
import { ProjectPolicySection } from '../components/PolicyPanel'
import { ProjectProcessSection } from '../components/ProcessSection'
import { Tabs, fmtDate, fmtTokens } from '../components/ui'
import { Button, Field, FormActions, FormNote, PasswordInput, TextInput, errText, useBusy } from '../components/form'
import { useStore, type SettingsTab } from '../store'

// Страница настроек проекта (спека web «Страница настроек проекта»):
// всё про проект на адресуемых вкладках — общее (репозиторий, webhook,
// название и проверки), участники, процесс, политики с бюджетом, окружения.

const STATE_LABEL: Record<string, string> = {
  ok: 'подключение работает',
  invalid: 'подключение не работает',
  unchecked: 'подключение не проверялось',
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Общее' },
  { id: 'members', label: 'Участники' },
  { id: 'process', label: 'Процесс' },
  { id: 'policies', label: 'Политики' },
  { id: 'environments', label: 'Окружения' },
]

// Заметка об успехе или ошибке живёт на вкладке, где выполнено действие,
// и не теряется при переключении до следующего действия.
interface Note { tab: SettingsTab; ok?: string; err?: string }

export function ProjectSettings({ projectId, tab, user }: { projectId: string; tab: SettingsTab; user: User }) {
  const { tick, projects, refreshProjects, nav } = useStore()
  const project: Project | undefined = projects.find(p => p.ID === projectId)
  const [repo, setRepo] = useState<RepositoryStatus | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [checks, setChecks] = useState<Check[]>([])
  const [token, setToken] = useState('')
  const [login, setLogin] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [busy, run] = useBusy()
  // Панель вкладки монтируется при первом открытии и дальше только
  // прячется: несохранённые правки процесса и политик переживают
  // переключение вкладок (design, решение 4).
  const [visited, setVisited] = useState<Set<SettingsTab>>(() => new Set([tab]))
  useEffect(() => { setVisited(v => v.has(tab) ? v : new Set(v).add(tab)) }, [tab])
  const panel = (id: SettingsTab, content: () => ReactNode) =>
    visited.has(id) ? <div key={id} hidden={tab !== id} role="tabpanel">{content()}</div> : null

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

  const act = (fn: () => Promise<unknown>, msg = '') => () => run(async () => {
    setNote(null)
    try { await fn(); setNote({ tab, ok: msg }); refresh(); refreshProjects() } catch (e) { setNote({ tab, err: errText(e) }) }
  })
  const noteHere = note && note.tab === tab ? note : null

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
      <Tabs tabs={TABS} active={tab} onChange={t => nav({ view: 'project-settings', id: projectId, tab: t })} />
      {noteHere && <div style={{ marginBottom: 8 }}><FormNote err={noteHere.err} ok={noteHere.ok} /></div>}

      {panel('general', () => (
        <>
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
                  <div className="f-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', marginTop: 8 }}>
                    <Field label="Новый токен доступа" hint="прежние учётные данные заменяются после проверки">
                      {ids => <PasswordInput ids={ids} placeholder="Новый токен доступа" autoComplete="off"
                        value={token} onChange={e => setToken(e.target.value)} />}
                    </Field>
                    <Button busy={busy} disabled={!token}
                      onClick={act(async () => { await api.replaceCredentials(projectId, token); setToken('') }, 'учётные данные заменены')}>
                      Заменить токен
                    </Button>
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

          <div className="dw-sec f-form">
            <h3>Название и проверки</h3>
            <Field label="Название">
              {ids => <TextInput ids={ids} placeholder="Название проекта" value={name} disabled={!isOwner}
                onChange={e => setName(e.target.value)} />}
            </Field>
            {checks.map((c, i) => (
              <div className="f-grid" key={i} style={{ gridTemplateColumns: '1fr 2fr auto', alignItems: 'end' }}>
                <Field label={i === 0 ? 'Проверка' : undefined}>
                  {ids => <TextInput ids={ids} placeholder="Имя" value={c.name} disabled={!isOwner}
                    onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />}
                </Field>
                <Field label={i === 0 ? 'Команда' : undefined}>
                  {ids => <TextInput ids={ids} mono placeholder="Команда" value={c.cmd} disabled={!isOwner}
                    onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, cmd: e.target.value } : x))} />}
                </Field>
                {isOwner ? <Button variant="quiet" aria-label="убрать проверку" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>✕</Button> : <span />}
              </div>
            ))}
            {isOwner && (
              <FormActions note={<Button size="sm" onClick={() => setChecks([...checks, { name: '', cmd: '' }])}>Добавить проверку</Button>}>
                <Button variant="primary" size="sm" busy={busy}
                  onClick={act(() => api.patchProject(projectId, { name, checks }), 'настройки сохранены')}>
                  Сохранить настройки
                </Button>
              </FormActions>
            )}
          </div>
        </>
      ))}

      {panel('members', () => (
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
                    <Button size="sm" variant="quiet"
                      onClick={act(() => api.setMemberRole(projectId, m.login, m.role === 'owner' ? 'member' : 'owner'),
                        'роль изменена')}>
                      {m.role === 'owner' ? 'Снять владельца' : 'Сделать владельцем'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={act(() => api.removeMember(projectId, m.login), 'участник удалён')}>
                      Удалить
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          {isOwner && (
            <div className="f-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', marginTop: 8 }}>
              <Field label="Новый участник">
                {ids => <TextInput ids={ids} mono placeholder="Логин участника" value={login} onChange={e => setLogin(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && login) act(async () => { await api.addMember(projectId, login); setLogin('') }, 'участник добавлен')() }} />}
              </Field>
              <Button busy={busy} disabled={!login}
                onClick={act(async () => { await api.addMember(projectId, login); setLogin('') }, 'участник добавлен')}>
                Добавить
              </Button>
            </div>
          )}
        </div>
      ))}

      {panel('process', () => <ProjectProcessSection projectId={projectId} isOwner={isOwner} tick={tick} />)}

      {panel('policies', () => (
        <>
          <ProjectPolicySection projectId={projectId} isOwner={isOwner} tick={tick} />
          <div className="dw-sec">
            <h3>Бюджет токенов</h3>
            {project.budget ? (
              <div className="meta-grid">
                <div className="kv"><span>дневной лимит (действует)</span>
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
              Лимит задаётся пресетом «Дневной бюджет токенов» выше. В бюджет засчитываются только сообщённые токены. Выполняющиеся стадии на паузе дорабатываются, новые не назначаются до начала следующих суток.
            </div>
          </div>
        </>
      ))}

      {panel('environments', () => <Environments projectId={projectId} isAdmin={user.admin} />)}
    </div>
  )
}
