import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stLabel, type Deployment, type EnvConfig, type Environment } from '../api/client'
import { useStore } from '../store'
import { fmtDuration, timeShort } from './ui'

// Блок «Окружения» проекта (спека web «Окружения проекта»):
// статус последней публикации, запуск, история с логом, resume после
// провала. Настройка — только администратор (форма скрыта остальным).

function depColor(status: string): string {
  const map: Record<string, string> = {
    queued: '--c-queue', deploying: '--c-run', verifying: '--c-test',
    done: '--c-done', failed: '--c-fail', rolled_back: '--c-fix',
  }
  return `var(${map[status] ?? '--muted'})`
}

function depDuration(d: Deployment): string {
  if (!d.started_at) return '—'
  const end = d.ended_at ? new Date(d.ended_at).getTime() : Date.now()
  return fmtDuration(Math.max(0, Math.round((end - new Date(d.started_at).getTime()) / 1000)))
}

const active = (s: string) => s === 'queued' || s === 'deploying' || s === 'verifying'

export function Environments({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const { tick, deployLogs } = useStore()
  const [envs, setEnvs] = useState<Environment[]>([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<Environment | 'new' | null>(null)
  const [historyEnv, setHistoryEnv] = useState<string | null>(null)
  const [history, setHistory] = useState<Deployment[]>([])
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const openLogRef = useRef<string | null>(null)

  const refresh = useCallback(() => {
    api.environments(projectId).then(setEnvs).catch(() => setEnvs([]))
  }, [projectId])
  useEffect(refresh, [refresh, tick]) // tick растёт и на deploy.status

  useEffect(() => {
    if (!historyEnv) return
    api.deployments(historyEnv).then(setHistory).catch(() => setHistory([]))
  }, [historyEnv, tick])

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr('')
    try { await fn(); refresh() } catch (e) { setErr(String(e)) }
  }

  const showLog = (d: Deployment) => {
    if (openLog === d.id) { setOpenLog(null); openLogRef.current = null; return }
    setOpenLog(d.id)
    openLogRef.current = d.id
    setLogText(null)
    if (active(d.status)) return // выполняющаяся — live-хвост из deployLogs
    if (!d.has_log) { setLogText(''); return }
    api.deploymentLog(d.id)
      .then(text => { if (openLogRef.current === d.id) setLogText(text) })
      .catch(() => { if (openLogRef.current === d.id) setLogText('') })
  }

  return (
    <div className="envs">
      <div className="page-head" style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 15 }}>Окружения</h1>
        {isAdmin && (
          <div className="right">
            <button className="btn sm" onClick={() => setEditing('new')}>Новое окружение</button>
          </div>
        )}
      </div>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {envs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Окружений нет.</div>}

      <div className="env-grid">
        {envs.map(env => {
          const last = env.last_deployment
          return (
            <div key={env.id} className="env-card">
              <div className="env-top">
                <b>{env.name}</b>
                <span className="mono muted">{env.trigger}</span>
                {env.paused && <span className="env-paused">пауза</span>}
              </div>
              <div className="env-status">
                {last ? (
                  <>
                    <span className="sess-stage" style={{ color: depColor(last.status) }}>
                      {stLabel[last.status] ?? last.status.toUpperCase()}
                    </span>
                    <span className="mono muted" title={last.version}>{last.version.slice(0, 12)}</span>
                    <span className="muted">{timeShort(last.created_at)} · {depDuration(last)}</span>
                  </>
                ) : <span className="muted">публикаций не было</span>}
              </div>
              {last && active(last.status) && (
                <div className="term sess-term">{deployLogs.get(last.id) || 'ожидание вывода…'}</div>
              )}
              {last?.status === 'failed' || last?.status === 'rolled_back' ? (
                <div className="env-detail">{last.detail}</div>
              ) : null}
              <div className="dw-actions" style={{ marginTop: 8 }}>
                {env.paused
                  ? <button className="btn sm primary" onClick={act(() => api.resumeEnv(env.id))}>Возобновить</button>
                  : <button className="btn sm primary" disabled={!!last && active(last.status)}
                      onClick={act(() => api.deploy(env.id))}>Опубликовать</button>}
                <button className="btn sm" onClick={() => setHistoryEnv(historyEnv === env.id ? null : env.id)}>
                  История
                </button>
                {isAdmin && <button className="btn sm" onClick={() => setEditing(env)}>Настроить</button>}
              </div>

              {historyEnv === env.id && (
                <div className="env-history">
                  {history.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Пусто.</div>}
                  {history.map(d => (
                    <div key={d.id}>
                      <button className={'sess-row' + (openLog === d.id ? ' open' : '')} onClick={() => showLog(d)}>
                        <span className="sess-stage" style={{ color: depColor(d.status) }}>
                          {stLabel[d.status] ?? d.status.toUpperCase()}
                        </span>
                        <span className="mono muted" title={d.version}>{d.version.slice(0, 12)}</span>
                        <span className="sess-agent">{d.initiator}</span>
                        <span className="mono">{timeShort(d.created_at)}</span>
                        <span className="mono">{depDuration(d)}</span>
                      </button>
                      {openLog === d.id && (
                        active(d.status)
                          ? <div className="term sess-term">{deployLogs.get(d.id) || 'ожидание вывода…'}</div>
                          : logText === null
                            ? <div className="term sess-term">загрузка…</div>
                            : logText === ''
                              ? <div className="term sess-term muted">лог недоступен</div>
                              : <div className="term sess-term">{logText}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <EnvForm projectId={projectId} env={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}

// Форма создания/правки окружения (админ): Verify обязателен — валидацию
// делает бэкенд (422), форма показывает его ошибку.
function EnvForm({ projectId, env, onClose, onSaved }: {
  projectId: string
  env: Environment | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(env?.name ?? '')
  const [trigger, setTrigger] = useState<string>(env?.trigger ?? 'manual')
  const [cfg, setCfg] = useState<EnvConfig>(env?.config ?? { deploy_cmd: '' })
  const [err, setErr] = useState('')

  const save = async () => {
    setErr('')
    try {
      if (env) await api.patchEnvironment(env.id, { name, trigger, config: cfg })
      else await api.createEnvironment(projectId, { name, trigger, config: cfg })
      onSaved()
    } catch (e) { setErr(String(e)) }
  }
  const del = async () => {
    setErr('')
    try { await api.deleteEnvironment(env!.id); onSaved() } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{env ? 'Окружение: ' + env.name : 'Новое окружение'}</h2>
        <input placeholder="Имя (staging, prod…)" value={name} onChange={e => setName(e.target.value)} />
        <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          Запуск:
          <select value={trigger} onChange={e => setTrigger(e.target.value)}>
            <option value="manual">вручную</option>
            <option value="auto">автоматически после merge</option>
          </select>
        </label>
        <input placeholder="Хост ([user@]host[:port], пусто — локально на runner'е)"
          value={cfg.host ?? ''} onChange={e => setCfg({ ...cfg, host: e.target.value })} />
        <input placeholder="Команда доставки (deploy_cmd)"
          value={cfg.deploy_cmd} onChange={e => setCfg({ ...cfg, deploy_cmd: e.target.value })} />
        <input placeholder="Команда проверки (verify_cmd)"
          value={cfg.verify_cmd ?? ''} onChange={e => setCfg({ ...cfg, verify_cmd: e.target.value })} />
        <input placeholder="URL health-check (verify_url)"
          value={cfg.verify_url ?? ''} onChange={e => setCfg({ ...cfg, verify_url: e.target.value })} />
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}
        <div className="row">
          {env && <button className="btn danger" onClick={del}>Удалить</button>}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={save}>Сохранить</button>
        </div>
      </div>
    </div>
  )
}
