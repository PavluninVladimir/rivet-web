import { useCallback, useEffect, useState } from 'react'
import { api, errCode, LLM_PROVIDERS, type Event, type LLMProvider, type PlannerSource, type RunnerToken, type SystemStatus, type User } from '../api/client'
import { fmtAgo, fmtDate, SecretOnce, statusColor, Tabs, timeShort } from '../components/ui'
import { useStore, type AppTab } from '../store'
import { UsageView } from './UsageView'

// Раздел «Управление приложением» (спека web): настройки уровня установки,
// адресуемые вкладки #/app-management/<tab>. Политики (пресеты, лимиты)
// приходят третьим change'ом раздела.

const TABS: { id: AppTab; label: string }[] = [
  { id: 'users', label: 'Пользователи' }, { id: 'runners', label: 'Runner’ы' },
  { id: 'models', label: 'Модели' }, { id: 'usage', label: 'Usage' },
  { id: 'audit', label: 'Аудит' }, { id: 'status', label: 'Состояние' },
]

export function AppManagement({ me, tab }: { me: User; tab: AppTab }) {
  const { nav } = useStore()
  return (
    <div className="page">
      <div className="page-head">
        <h1>Управление приложением</h1>
        <span className="sub">настройки уровня установки</span>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={t => nav({ view: 'app-management', tab: t })} />
      {tab === 'users' && <UsersTab me={me} />}
      {tab === 'runners' && <RunnerTokensTab />}
      {tab === 'models' && <ModelsTab />}
      {tab === 'usage' && <UsageView scope="installation" defaultGroup="project" title="Usage установки" sub="все проекты, метеринг установки" />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'status' && <StatusTab />}
    </div>
  )
}

// Общий помощник действий: ошибка и заметка над вкладкой.
function useActions(refresh: () => void) {
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const act = (fn: () => Promise<unknown>, msg = '') => async () => {
    setErr(''); setNote('')
    try { await fn(); setNote(msg); refresh() } catch (e) { setErr(String(e)) }
  }
  const banner = (
    <>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ color: 'var(--c-done)', fontSize: 12, marginBottom: 8 }}>{note}</div>}
    </>
  )
  return { act, banner }
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
  const { act, banner } = useActions(refresh)

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
              <button className="btn sm" disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { admin: !u.admin }),
                  u.admin ? 'права администратора сняты' : 'права администратора выданы')}>
                {u.admin ? 'Снять админа' : 'Сделать админом'}
              </button>
              <button className="btn sm"
                onClick={act(async () => {
                  const { password } = await api.resetPassword(u.id)
                  setOneTime({ login: u.login, password })
                }, 'пароль сброшен')}>
                Сбросить пароль
              </button>
              <button className="btn sm" disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { disabled: !u.disabled }),
                  u.disabled ? 'пользователь включён' : 'пользователь отключён')}>
                {u.disabled ? 'Включить' : 'Отключить'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="dw-sec">
        <h3>Новый пользователь</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Логин" value={form.login}
            onChange={e => setForm({ ...form, login: e.target.value })} />
          <input placeholder="Имя" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="password" placeholder="Пароль (от 8 символов)" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })} />
          <label className="row" style={{ gap: 6, marginRight: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.admin}
              onChange={e => setForm({ ...form, admin: e.target.checked })} />
            администратор
          </label>
          <button className="btn sm primary" disabled={!form.login || form.password.length < 8}
            onClick={act(async () => {
              await api.createUser(form)
              setForm({ login: '', name: '', password: '', admin: false })
            }, 'пользователь создан')}>
            Создать
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Вы вошли как {me.login}. Свой пароль и токены — на странице профиля.
        </div>
      </div>
    </>
  )
}

// ─── Runner'ы: токены регистрации ───────────────────────────────────────

function RunnerTokensTab() {
  const [tokens, setTokens] = useState<RunnerToken[]>([])
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null)
  const [form, setForm] = useState({ name: '', expires: '' })
  // Адрес протокола и TLS — из состояния установки, чтобы команда запуска
  // runner'а была верной для нестандартного порта и TLS-only установки.
  const [plane, setPlane] = useState<{ addr: string; tls: boolean }>({ addr: `${location.hostname}:8090`, tls: false })
  const refresh = useCallback(() => {
    api.runnerTokens().then(t => setTokens(t ?? [])).catch(() => {})
    api.systemStatus().then(s => {
      const d = s.components.find(c => c.name === 'runners')?.data as { grpc_addr?: string; tls?: boolean } | undefined
      if (!d?.grpc_addr) return
      // Адрес прослушивания вида ":8090", "0.0.0.0:8090" или "[::]:8090" —
      // подставляем хост консоли; порт — после последнего двоеточия.
      const i = d.grpc_addr.lastIndexOf(':')
      const host = i >= 0 ? d.grpc_addr.slice(0, i) : d.grpc_addr
      const port = i >= 0 ? d.grpc_addr.slice(i + 1) : ''
      const wildcard = host === '' || host === '0.0.0.0' || host === '[::]' || host === '::'
      const h = wildcard ? location.hostname : host
      setPlane({ addr: port ? `${h}:${port}` : d.grpc_addr, tls: !!d.tls })
    }).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner } = useActions(refresh)

  // Действующий — не отозван и не просрочен: бэкенд отклоняет и те, и другие.
  const expired = (t: RunnerToken) => !!t.expires_at && new Date(t.expires_at).getTime() <= Date.now()
  const active = tokens.filter(t => !t.revoked_at && !expired(t))
  const revoked = tokens.filter(t => t.revoked_at || expired(t))

  const row = (t: RunnerToken) => (
    <tr key={t.id} className={t.revoked_at || expired(t) ? 'muted' : ''}>
      <td>{t.name}</td>
      <td className="mono muted">{t.prefix}…</td>
      <td className="muted">{fmtDate(t.created_at)} · {t.created_by}</td>
      <td className="muted">{t.expires_at ? fmtDate(t.expires_at) : 'бессрочно'}</td>
      <td className="muted">{t.last_used_at ? fmtAgo(t.last_used_at) : 'не использовался'}</td>
      <td style={{ textAlign: 'right' }}>
        {t.revoked_at
          ? <span className="muted" style={{ fontSize: 11 }}>отозван {fmtDate(t.revoked_at)}</span>
          : expired(t)
            ? <span className="muted" style={{ fontSize: 11 }}>истёк</span>
            : <button className="btn sm" onClick={act(() => api.revokeRunnerToken(t.id), 'токен отозван: новые подключения по нему отклоняются')}>Отозвать</button>}
      </td>
    </tr>
  )

  return (
    <>
      {banner}
      {created && (
        <SecretOnce title={`Токен регистрации «${created.name}»`} secret={created.secret}
          hint="Показывается один раз. Передайте его runner'ам через RIVET_RUNNER_TOKEN или флаг -token."
          onHide={() => setCreated(null)} />
      )}
      <div className="dw-sec">
        <h3>Токены регистрации</h3>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Runner подключается к control plane только с токеном регистрации. Один токен можно раздать нескольким runner'ам.
          Отзыв закрывает новые подключения, уже открытые соединения доживают до обрыва: для немедленного вывода используйте drain.
        </div>
        <table className="tbl">
          <thead><tr><th>Имя</th><th>Префикс</th><th>Создан</th><th>Срок</th><th>Использован</th><th></th></tr></thead>
          <tbody>
            {active.map(row)}
            {active.length === 0 && <tr><td colSpan={6} className="muted">Действующих токенов нет — runner'ы не смогут подключиться.</td></tr>}
            {revoked.map(row)}
          </tbody>
        </table>
      </div>
      <div className="dw-sec">
        <h3>Новый токен</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Имя (например, office-fleet)" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="datetime-local" title="срок действия (пусто — бессрочно)" value={form.expires}
            onChange={e => setForm({ ...form, expires: e.target.value })} />
          <button className="btn sm primary" disabled={!form.name}
            onClick={act(async () => {
              const res = await api.createRunnerToken(form.name, form.expires ? new Date(form.expires).toISOString() : undefined)
              setCreated({ name: res.token.name, secret: res.secret })
              setForm({ name: '', expires: '' })
            }, 'токен создан')}>
            Создать
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Запуск runner'а на хосте с рабочими копиями:
        </div>
        <pre className="mono" style={{ fontSize: 11.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>
          {`RIVET_RUNNER_TOKEN=rrt_… rivet-runner -plane ${plane.addr}${plane.tls ? ' -tls' : ''} -id <имя> -agent claude-code -caps coding`}
        </pre>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {plane.tls
            ? <>Протокол под TLS: для своего корневого сертификата добавьте <span className="mono">-tls-ca</span>.</>
            : <>Протокол без TLS: токен идёт открытым текстом, порт должен быть закрыт периметром (включается <span className="mono">RIVET_GRPC_TLS_CERT/KEY</span> на rivetd).</>}
        </div>
      </div>
    </>
  )
}

// ─── Модели ─────────────────────────────────────────────────────────────

function ModelsTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [source, setSource] = useState<PlannerSource>('none')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string>>({})
  const refresh = useCallback(() => {
    api.models().then(r => { setProviders(r.providers ?? []); setSource(r.source) }).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner } = useActions(refresh)

  const save = (id: string, patch: { key?: string; model?: string; active?: boolean }, msg: string) =>
    act(async () => {
      try {
        await api.putModel(id, patch)
        setKeys(k => ({ ...k, [id]: '' }))
      } catch (e) {
        if (errCode(e) === 'no_secret_key') {
          throw new Error('Ключ шифрования установки (RIVET_SECRET_KEY) не задан: ключи моделей сохранить нельзя. Задайте его в окружении rivetd и перезапустите.')
        }
        throw e
      }
    }, msg)

  const stateLabel = (p: LLMProvider) => p.state === 'ok' ? 'в порядке' : p.state === 'invalid' ? 'неверен' : 'не проверен'
  const stateColor = (p: LLMProvider) => p.state === 'ok' ? 'var(--c-done)' : p.state === 'invalid' ? 'var(--c-block)' : 'var(--c-review)'

  return (
    <>
      {banner}
      <div className="dw-sec">
        <h3>Модель для декомпозиции Epic</h3>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          {source === 'db' && 'Активный провайдер задан здесь и применяется без перезапуска.'}
          {source === 'env' && 'В базе активного провайдера нет: используется ключ из окружения установки (запасной источник). Сохраните ключ здесь, чтобы управлять им из консоли.'}
          {source === 'none' && 'Модель не настроена ни здесь, ни в окружении: декомпозиция Epic отвечает отказом «модель не настроена».'}
        </div>
        {LLM_PROVIDERS.map(def => {
          const p = providers.find(x => x.provider === def.id)
          const modelVal = models[def.id] ?? p?.model ?? ''
          return (
            <div className="set-row" key={def.id}>
              <div className="lbl">
                <b>{def.label}{p?.active && <span className="chip" style={{ marginLeft: 8 }}><span className="n">активен</span></span>}</b>
                <span>
                  {p
                    ? <>ключ <span className="mono">{p.key_prefix || '••••'}…</span> · <span style={{ color: stateColor(p) }}>{stateLabel(p)}</span>
                      {p.check_detail && <> · {p.check_detail}</>} · проверен {fmtDate(p.checked_at)} · изменил {p.updated_by}</>
                    : 'ключ не сохранён'}
                </span>
              </div>
              <div className="ctl">
                <input type="password" placeholder={p ? 'новый ключ' : 'API-ключ'} style={{ width: 200 }}
                  value={keys[def.id] ?? ''} onChange={e => setKeys({ ...keys, [def.id]: e.target.value })} />
                <input placeholder={`модель (${def.defaultModel})`} style={{ width: 180 }}
                  value={modelVal} onChange={e => setModels({ ...models, [def.id]: e.target.value })} />
                <button className="btn sm primary" disabled={!p && !keys[def.id]}
                  onClick={save(def.id, {
                    ...(keys[def.id] ? { key: keys[def.id] } : {}),
                    ...(modelVal !== (p?.model ?? '') ? { model: modelVal } : {}),
                    ...(!p ? { active: true } : {}),
                  }, 'провайдер сохранён')}>
                  Сохранить
                </button>
                {p && !p.active && <button className="btn sm" onClick={save(def.id, { active: true }, `активен ${def.label}`)}>Сделать активным</button>}
                {p && <button className="btn sm" onClick={act(() => api.checkModel(def.id), 'ключ проверен')}>Проверить</button>}
                {p && <button className="btn sm" onClick={act(() => api.deleteModel(def.id), 'провайдер удалён')}>Удалить</button>}
              </div>
            </div>
          )
        })}
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Ключ хранится зашифрованным и повторно не показывается. При сохранении он проверяется запросом списка моделей у провайдера.
          {source === 'none' && !providers.length && <> Если ключа шифрования установки нет, сохранение ответит подсказкой.</>}
        </div>
      </div>
    </>
  )
}

// ─── Аудит ──────────────────────────────────────────────────────────────

const AUDIT_TYPES = ['', 'user.bootstrap', 'user.created', 'user.admin_changed', 'user.state_changed', 'user.password_reset',
  'runner.registered', 'runner_token.created', 'runner_token.revoked', 'llm_provider.updated', 'llm_provider.removed']

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
    }).catch(e => setErr(String(e)))
  }, [type])
  useEffect(() => { load() }, [load])

  const last = events[events.length - 1]?.ID
  return (
    <>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <select className="search" value={type} onChange={e => setType(e.target.value)}>
          {AUDIT_TYPES.map(t => <option key={t} value={t}>{t || 'все типы'}</option>)}
        </select>
        <button className="btn sm" onClick={() => load()}>Обновить</button>
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
      {more && last && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => load(last)}>Показать ещё</button>}
    </>
  )
}

// ─── Состояние ──────────────────────────────────────────────────────────

const COMPONENT_LABEL: Record<string, string> = {
  database: 'База данных', blob: 'Хранилище транскриптов', secrets: 'Ключ шифрования',
  planner: 'Модель декомпозиции', runners: 'Runner’ы',
}

function StatusTab() {
  const [st, setSt] = useState<SystemStatus | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    api.systemStatus().then(s => { setSt(s); setErr('') }).catch(e => setErr(String(e)))
  }, [])
  useEffect(load, [load])

  if (err) return <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>
  if (!st) return <div className="muted">Загрузка…</div>
  const planner = st.components.find(c => c.name === 'planner')?.data as { source?: string; provider?: string; model?: string } | undefined
  const runners = st.components.find(c => c.name === 'runners')?.data as { online?: number; total?: number } | undefined
  return (
    <>
      <div className="stat-strip">
        <div className="mini-stat"><div className="v" style={{ color: statusColor(st.status) }}>{st.status.toUpperCase()}</div><div className="l">Общее состояние</div></div>
        <div className="mini-stat"><div className="v">{st.version}</div><div className="l">Версия сборки</div></div>
        <div className="mini-stat"><div className="v">v{st.protocol_version}</div><div className="l">Протокол runner’ов</div></div>
        <div className="mini-stat"><div className="v">{runners?.online ?? 0}<em>/ {runners?.total ?? 0}</em></div><div className="l">Runner’ы в сети</div></div>
        <div className="mini-stat"><div className="v" style={{ fontSize: 13 }}>{planner?.source === 'none' ? '—' : `${planner?.provider}`}<em>{planner?.source === 'env' ? 'окружение' : planner?.source === 'db' ? 'консоль' : ''}</em></div><div className="l">Модель: {planner?.model || 'не настроена'}</div></div>
      </div>
      <div className="dw-sec">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Компоненты</h3>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={load}>Обновить</button>
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
