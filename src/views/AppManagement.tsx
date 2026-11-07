import { useCallback, useEffect, useState } from 'react'
import { api, type Event, type RunnerToken, type SystemStatus, type User } from '../api/client'
import { fmtAgo, fmtDate, SecretOnce, statusColor, Tabs, timeShort } from '../components/ui'
import { InstallationPolicyPanel } from '../components/PolicyPanel'
import { Button, Checkbox, Field, FormActions, FormNote, PasswordInput, Select, TagsInput, TextInput, errText, fieldError, useBusy } from '../components/form'
import { bindingGroups, planeFromStatus, runnerCommand, type Plane } from '../components/runnerTokens'
import { useStore, type AppTab } from '../store'
import { UsageView } from './UsageView'
import { ConnectionsTab } from './ConnectionsTab'
import { AgentsTab } from './AgentsTab'
import { RolesTab } from './RolesTab'
import { TeamTab } from './TeamTab'
import { ErrorBoundary } from '../components/ErrorBoundary'

// Раздел «Управление приложением» (спека web): настройки уровня установки,
// адресуемые вкладки #/app-management/<tab>. Вкладка «Политики» — место
// прототиповского Settings (orchestrator policy): пресеты установки.

const TABS: { id: AppTab; label: string }[] = [
  { id: 'users', label: 'Пользователи' }, { id: 'runners', label: 'Runner’ы' },
  { id: 'agents', label: 'Агент Rivet' }, { id: 'team', label: 'Команда' }, { id: 'roles', label: 'Шаблоны ролей' },
  { id: 'connections', label: 'Подключения' }, { id: 'policies', label: 'Политики' },
  { id: 'usage', label: 'Usage' },
  { id: 'audit', label: 'Аудит' }, { id: 'status', label: 'Состояние' },
]

export function AppManagement({ me, tab }: { me: User; tab: AppTab }) {
  const { nav, refreshProjects } = useStore()
  return (
    <div className="page">
      <div className="page-head">
        <h1>Управление приложением</h1>
        <span className="sub">настройки уровня установки</span>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={t => nav({ view: 'app-management', tab: t })} />
      {/* Своя граница у вкладки: сломанная вкладка не гасит раздел, другие
          вкладки открываются как обычно. */}
      <ErrorBoundary key={tab} what={`вкладку «${TABS.find(t => t.id === tab)?.label ?? tab}»`}>
      {tab === 'users' && <UsersTab me={me} />}
      {tab === 'runners' && <RunnerTokensTab />}
      {tab === 'agents' && <AgentsTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'policies' && <InstallationPolicyPanel onSaved={refreshProjects} />}
      {tab === 'usage' && <UsageView scope="installation" defaultGroup="project" title="Usage установки" sub="все проекты, метеринг установки" />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'status' && <StatusTab />}
      </ErrorBoundary>
    </div>
  )
}

// Общий помощник действий: ошибка и заметка над вкладкой.
export function useActions(refresh: () => void) {
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, run] = useBusy()
  const act = (fn: () => Promise<unknown>, msg = '') => () => run(async () => {
    setErr(''); setNote('')
    try { await fn(); setNote(msg); refresh() } catch (e) { setErr(errText(e)) }
  })
  const banner = (err || note) ? <div style={{ marginBottom: 8 }}><FormNote err={err || undefined} ok={note || undefined} /></div> : null
  return { act, banner, busy }
}

// ─── Пользователи ───────────────────────────────────────────────────────

function UsersTab({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([])
  // Одноразовый пароль показывается ровно один раз (спека web).
  const [oneTime, setOneTime] = useState<{ login: string; password: string } | null>(null)
  const [form, setForm] = useState({ login: '', name: '', password: '', admin: false })

  const refresh = useCallback(() => {
    api.users().then(u => setUsers(u ?? [])).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)

  // Последний активный администратор: у него действия «снять права» и
  // «отключить» недоступны, а не отклоняются после нажатия.
  const activeAdmins = users.filter(u => u.admin && !u.disabled).length
  const locked = (u: User) => u.admin && !u.disabled && activeAdmins <= 1

  return (
    <>
      {banner}
      {oneTime && (
        <SecretOnce title={`Одноразовый пароль для ${oneTime.login}`} secret={oneTime.password}
          hint="Показывается один раз. Пользователь войдёт с ним и должен будет сменить пароль."
          onHide={() => setOneTime(null)} />
      )}
      <div className="dw-sec">
        <h3>Пользователи</h3>
        <div className="sess-list">
          {users.map(u => (
            <div className="sess-row" key={u.id}>
              <span className="mono">{u.login}</span>
              <span className="sess-agent">{u.name}</span>
              {u.admin && <span className="chip"><span className="n">админ</span></span>}
              <span className={u.disabled ? 'muted' : ''}>{u.disabled ? 'отключён' : 'активен'}</span>
              <Button size="sm" variant="quiet" disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { admin: !u.admin }),
                  u.admin ? 'права администратора сняты' : 'права администратора выданы')}>
                {u.admin ? 'Снять админа' : 'Сделать админом'}
              </Button>
              <Button size="sm" variant="quiet"
                onClick={act(async () => {
                  const { password } = await api.resetPassword(u.id)
                  setOneTime({ login: u.login, password })
                }, 'пароль сброшен')}>
                Сбросить пароль
              </Button>
              <Button size="sm" variant={u.disabled ? 'default' : 'danger'} disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { disabled: !u.disabled }),
                  u.disabled ? 'пользователь включён' : 'пользователь отключён')}>
                {u.disabled ? 'Включить' : 'Отключить'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="dw-sec f-form" style={{ maxWidth: 760 }}>
        <h3>Новый пользователь</h3>
        <div className="f-grid">
          <Field label="Логин" hint="латиница, цифры, «._-»">
            {ids => <TextInput ids={ids} mono placeholder="Логин" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />}
          </Field>
          <Field label="Имя" optional>
            {ids => <TextInput ids={ids} placeholder="Имя" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Пароль" hint="не короче 8 символов; пользователь сменит его при первом входе">
            {ids => <PasswordInput ids={ids} placeholder="Пароль (от 8 символов)" autoComplete="new-password" value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} />}
          </Field>
          <Field label="Права">
            {() => <div style={{ height: 'var(--f-h)', display: 'flex', alignItems: 'center' }}>
              <Checkbox checked={form.admin} label="администратор установки" onChange={v => setForm({ ...form, admin: v })} />
            </div>}
          </Field>
        </div>
        <FormActions>
          <Button variant="primary" size="sm" busy={busy} disabled={!form.login || form.password.length < 8}
            onClick={act(async () => {
              await api.createUser(form)
              setForm({ login: '', name: '', password: '', admin: false })
            }, 'пользователь создан')}>
            Создать
          </Button>
        </FormActions>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Вы вошли как {me.login}. Свой пароль и токены — на странице профиля.
        </div>
      </div>
    </>
  )
}

// ─── Runner'ы: токены регистрации ───────────────────────────────────────

// Сколько последних отказов регистрации показывает вкладка. Полная лента
// в «Аудите».
const REJECTIONS_SHOWN = 5

function RunnerTokensTab() {
  const { nav } = useStore()
  const [tokens, setTokens] = useState<RunnerToken[]>([])
  const [rejections, setRejections] = useState<Event[]>([])
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null)
  const [form, setForm] = useState<{ name: string; expires: string; runners: string[] }>({ name: '', expires: '', runners: [] })
  const [runnersErr, setRunnersErr] = useState('')
  // Адрес протокола, TLS и mTLS берутся из состояния установки, чтобы команда
  // запуска runner'а была верной для нестандартного порта и TLS-only
  // установки.
  const [plane, setPlane] = useState<Plane>({ addr: `${location.hostname}:8090`, tls: false, clientCert: false })
  const refresh = useCallback(() => {
    api.runnerTokens().then(t => setTokens(t ?? [])).catch(() => {})
    api.events({ scope: 'installation', type: 'runner.rejected', latest: true, limit: REJECTIONS_SHOWN })
      // latest отдаёт последние события по возрастанию: свежий отказ сверху.
      .then(e => setRejections((e ?? []).slice().reverse())).catch(() => {})
    api.systemStatus().then(s => {
      const p = planeFromStatus(s.components.find(c => c.name === 'runners')?.data as Parameters<typeof planeFromStatus>[0], location.hostname)
      if (p) setPlane(p)
    }).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)

  // Действующий — не отозван и не просрочен: бэкенд отклоняет и те, и другие.
  const expired = (t: RunnerToken) => !!t.expires_at && new Date(t.expires_at).getTime() <= Date.now()
  const active = tokens.filter(t => !t.revoked_at && !expired(t))
  const revoked = tokens.filter(t => t.revoked_at || expired(t))

  const bindings = (t: RunnerToken) => {
    if (!t.runners) return <span className="muted">—</span>
    const groups = bindingGroups(t.runners)
    // Отозванный или истёкший токен без привязок уже ни к кому не привяжется.
    if (groups.length === 0) return <span className="muted" style={{ fontSize: 11.5 }}>
      {t.revoked_at || expired(t) ? 'не привязан' : 'привяжется к первому зарегистрированному runner’у'}</span>
    return (
      <div className="tok-bind">
        {groups.map(g => (
          <div key={g.source}>
            <span className="muted">{g.label}</span>
            {g.ids.map(id => <span key={id} className="f-tag ro">{id}</span>)}
          </div>
        ))}
      </div>
    )
  }

  const row = (t: RunnerToken) => (
    <tr key={t.id} className={t.revoked_at || expired(t) ? 'muted' : ''}>
      <td>{t.name}</td>
      <td className="mono muted">{t.prefix}…</td>
      <td>{bindings(t)}</td>
      <td className="muted">{fmtDate(t.created_at)} · {t.created_by}</td>
      <td className="muted">{t.expires_at ? fmtDate(t.expires_at) : 'бессрочно'}</td>
      <td className="muted">{t.last_used_at ? fmtAgo(t.last_used_at) : 'не использовался'}</td>
      <td style={{ textAlign: 'right' }}>
        {t.revoked_at
          ? <span className="muted" style={{ fontSize: 11 }}>отозван {fmtDate(t.revoked_at)}</span>
          : expired(t)
            ? <span className="muted" style={{ fontSize: 11 }}>истёк</span>
            : <Button size="sm" variant="danger" onClick={act(() => api.revokeRunnerToken(t.id), 'токен отозван: новые подключения по нему отклоняются')}>Отозвать</Button>}
      </td>
    </tr>
  )

  // Выпуск: ошибка списка runner'ов показывается у поля, остальные у кнопки
  // формы. Успех: однократный показ секрета над вкладкой.
  const [creating, runCreate] = useBusy()
  const [createErr, setCreateErr] = useState('')
  const create = () => runCreate(async () => {
    setRunnersErr(''); setCreateErr('')
    try {
      const res = await api.createRunnerToken(form.name, form.expires ? new Date(form.expires).toISOString() : undefined,
        form.runners.length ? form.runners : undefined)
      setCreated({ name: res.token.name, secret: res.secret })
      setForm({ name: '', expires: '', runners: [] })
      refresh()
    } catch (e) {
      const fe = fieldError(e, 'runner_ids')
      if (fe) setRunnersErr(fe)
      else setCreateErr(errText(e))
    }
  })

  return (
    <>
      {banner}
      {created && (
        <SecretOnce title={`Токен регистрации «${created.name}»`} secret={created.secret}
          hint="Показывается один раз. Сохраните его в файл с правами 0600 и передайте runner'ам путь в RIVET_RUNNER_TOKEN_FILE."
          onHide={() => setCreated(null)} />
      )}
      <div className="dw-sec">
        <h3>Токены регистрации</h3>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Runner подключается к control plane только с токеном регистрации, выпущенным для его идентификатора.
          Один токен можно выпустить для нескольких runner'ов одного хоста, токен без списка привяжется к первому
          зарегистрированному. Отзыв закрывает новые подключения, уже открытые соединения доживают до обрыва: для
          немедленного вывода используйте drain.
        </div>
        <table className="tbl">
          <thead><tr><th>Имя</th><th>Префикс</th><th>Runner’ы</th><th>Создан</th><th>Срок</th><th>Использован</th><th></th></tr></thead>
          <tbody>
            {active.map(row)}
            {active.length === 0 && <tr><td colSpan={7} className="muted">Действующих токенов нет, runner'ы не смогут подключиться.</td></tr>}
            {revoked.map(row)}
          </tbody>
        </table>
      </div>
      <div className="dw-sec">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Последние отказы регистрации</h3>
          <Button size="sm" variant="quiet" style={{ marginLeft: 'auto' }} onClick={() => nav({ view: 'app-management', tab: 'audit' })}>Все в «Аудите»</Button>
        </div>
        {rejections.map(e => (
          <div key={e.ID} className="act-row rej-row">
            <span className="t" title={fmtDate(e.TS)}>{fmtDate(e.TS).slice(0, 10)} {timeShort(e.TS)}</span>
            <span className="who mono">{e.ActorID}</span>
            <span>{String(e.Payload?.reason ?? e.Text)}{e.Payload?.token_name ? <span className="muted"> · токен «{String(e.Payload.token_name)}»</span> : null}</span>
          </div>
        ))}
        {rejections.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Отказов не было.</div>}
      </div>
      <div className="dw-sec f-form" style={{ maxWidth: 760 }}>
        <h3>Новый токен</h3>
        <div className="f-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
          <Field label="Имя">
            {ids => <TextInput ids={ids} placeholder="Имя (например, office-host)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Срок действия" optional>
            {ids => <TextInput ids={ids} type="datetime-local" title="срок действия (пусто — бессрочно)" value={form.expires}
              onChange={e => setForm({ ...form, expires: e.target.value })} />}
          </Field>
        </div>
        <Field label="Runner’ы" optional error={runnersErr || undefined}
          hint="Идентификаторы runner'ов (-id), для которых выпускается токен: Enter или запятая добавляют, список можно вставить через запятую или пробел. Если список пуст, токен привяжется к первому runner'у, который с ним зарегистрируется.">
          {ids => <TagsInput ids={ids} value={form.runners} placeholder="local-worker, local-reviewer" split={/[\s,]+/}
            onChange={v => { setForm({ ...form, runners: v }); setRunnersErr('') }} />}
        </Field>
        <FormActions note={createErr ? <FormNote err={createErr} /> : undefined}>
          <Button variant="primary" busy={creating} disabled={!form.name || busy} onClick={create}>Создать</Button>
        </FormActions>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Запуск runner'а на хосте с рабочими копиями:
        </div>
        <pre className="mono" style={{ fontSize: 11.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>
          {runnerCommand(plane, form.runners[0] ?? '')}
        </pre>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
          Токен держите в файле с правами 0600: так его не видно в списке процессов (переменная <span className="mono">RIVET_RUNNER_TOKEN</span> тоже
          работает). <span className="mono">-id</span> должен совпадать с runner'ом, для которого выпущен токен. Агент Rivet запускает команды в
          песочнице без сети, она есть на Linux с user namespaces. Без неё runner стартует только с <span className="mono">-unsandboxed</span>,
          и команды агента видят сеть. Runner выкатки запускается с <span className="mono">-caps deploy</span> и без агента.
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {plane.clientCert
            ? <>Протокол требует клиентский сертификат (mTLS): Common Name или DNS-имя сертификата равно <span className="mono">-id</span>, ключ в файле с правами 0600. Для своего корня сервера добавьте <span className="mono">-tls-ca</span>.</>
            : plane.tls
              ? <>Протокол под TLS: для своего корневого сертификата добавьте <span className="mono">-tls-ca</span>. Клиентские сертификаты включаются <span className="mono">RIVET_GRPC_CLIENT_CA</span> на rivetd.</>
              : <>Протокол без TLS: токен идёт открытым текстом, порт должен быть закрыт периметром (включается <span className="mono">RIVET_GRPC_TLS_CERT/KEY</span> на rivetd).</>}
        </div>
      </div>
    </>
  )
}

// ─── Аудит ──────────────────────────────────────────────────────────────

const AUDIT_TYPES = ['', 'user.bootstrap', 'user.created', 'user.admin_changed', 'user.state_changed', 'user.password_reset',
  'runner.registered', 'runner.rejected', 'runner_token.created', 'runner_token.bound', 'runner_token.revoked',
  'connection.created', 'connection.updated', 'connection.deleted', 'connection.key_replaced', 'connection.checked', 'connection.discovered', 'planner.model_changed',
  'agent.created', 'agent.updated', 'agent.deleted', 'runner.secrets_delivered']

function AuditTab() {
  const [events, setEvents] = useState<Event[]>([])
  const [type, setType] = useState('')
  const [err, setErr] = useState('')
  const [more, setMore] = useState(true)
  const PAGE = 100

  const load = useCallback((after?: number) => {
    api.events({ scope: 'installation', type: type || undefined, cursor: after, limit: PAGE }).then(e => {
      const batch = e ?? []
      setMore(batch.length === PAGE)
      setEvents(cur => after ? [...cur, ...batch] : batch)
      setErr('')
    }).catch(e => setErr(errText(e)))
  }, [type])
  useEffect(() => { load() }, [load])

  const last = events[events.length - 1]?.ID
  return (
    <>
      {err && <div style={{ marginBottom: 8 }}><FormNote err={err} /></div>}
      <div className="filters">
        <Select size="sm" aria-label="тип события" value={type} onChange={e => setType(e.target.value)}>
          {AUDIT_TYPES.map(t => <option key={t} value={t}>{t || 'все типы'}</option>)}
        </Select>
        <Button size="sm" onClick={() => load()}>Обновить</Button>
        <span className="muted" style={{ fontSize: 11.5 }}>события уровня установки: учётные записи, runner'ы, токены, ключи моделей</span>
      </div>
      {events.map(e => (
        <div key={e.ID} className="act-row">
          <span className="t" title={fmtDate(e.TS)}>{fmtDate(e.TS).slice(0, 10)} {timeShort(e.TS)}</span>
          <span className="who">{e.ActorKind}{e.ActorID ? `:${e.ActorID}` : ''}</span>
          <span><span className="mono muted" style={{ fontSize: 11, marginRight: 6 }}>{e.Type}</span>{e.Text}</span>
        </div>
      ))}
      {events.length === 0 && <div className="muted">Событий нет.</div>}
      {more && last && <Button size="sm" style={{ marginTop: 8 }} onClick={() => load(last)}>Показать ещё</Button>}
    </>
  )
}

// ─── Состояние ──────────────────────────────────────────────────────────

const COMPONENT_LABEL: Record<string, string> = {
  database: 'База данных', blob: 'Хранилище транскриптов', secrets: 'Ключ шифрования',
  planner: 'Модель декомпозиции', policy: 'Движок политик', runners: 'Runner’ы',
}

function StatusTab() {
  const [st, setSt] = useState<SystemStatus | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    api.systemStatus().then(s => { setSt(s); setErr('') }).catch(e => setErr(errText(e)))
  }, [])
  useEffect(load, [load])

  if (err) return <FormNote err={err} />
  if (!st) return <div className="muted">Загрузка…</div>
  const planner = st.components.find(c => c.name === 'planner')?.data as { source?: string; connection_id?: string; model?: string } | undefined
  const runners = st.components.find(c => c.name === 'runners')?.data as { online?: number; total?: number } | undefined
  return (
    <>
      <div className="stat-strip">
        <div className="mini-stat"><div className="v" style={{ color: statusColor(st.status) }}>{st.status.toUpperCase()}</div><div className="l">Общее состояние</div></div>
        <div className="mini-stat"><div className="v">{st.version}</div><div className="l">Версия сборки</div></div>
        <div className="mini-stat"><div className="v">v{st.protocol_version}</div><div className="l">Протокол runner’ов</div></div>
        <div className="mini-stat"><div className="v">{runners?.online ?? 0}<em>/ {runners?.total ?? 0}</em></div><div className="l">Runner’ы в сети</div></div>
        <div className="mini-stat"><div className="v" style={{ fontSize: 13 }}>{planner?.source === 'none' ? '—' : `${planner?.connection_id}`}<em>{planner?.source === 'env' ? 'окружение' : planner?.source === 'catalog' ? 'каталог' : ''}</em></div><div className="l">Модель: {planner?.model || 'не настроена'}</div></div>
      </div>
      <div className="dw-sec">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Компоненты</h3>
          <Button size="sm" style={{ marginLeft: 'auto' }} onClick={load}>Обновить</Button>
        </div>
        <div className="status-grid">
          {st.components.map(c => (
            <div key={c.name} style={{ display: 'contents' }}>
              <span>{COMPONENT_LABEL[c.name] ?? c.name}</span>
              <span className="st-dot" style={{ color: statusColor(c.status) }}>{c.status}</span>
              <span className="muted">{c.detail}</span>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Запущен {fmtDate(st.started_at)}. Публичная проверка <span className="mono">/api/v1/health</span> отвечает по базе данных и деталей не раскрывает.
        </div>
      </div>
    </>
  )
}
