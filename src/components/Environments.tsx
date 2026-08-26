import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stLabel, type Deployment, type EnvConfig, type Environment } from '../api/client'
import { useStore } from '../store'
import { fmtDuration, timeShort } from './ui'
import { Button, Field, FormActions, FormNote, Select, TagsInput, TextInput, errText, useBusy } from './form'

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

  const [actBusy, setActBusy] = useState<string | null>(null)
  const act = (key: string, fn: () => Promise<unknown>) => async () => {
    if (actBusy) return
    setErr(''); setActBusy(key)
    try { await fn(); refresh() } catch (e) { setErr(errText(e)) } finally { setActBusy(null) }
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
            <Button size="sm" onClick={() => setEditing('new')}>Новое окружение</Button>
          </div>
        )}
      </div>
      {err && <div style={{ marginBottom: 8 }}><FormNote err={err} /></div>}
      {envs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Окружений нет.</div>}

      <div className="env-grid">
        {envs.map(env => {
          const last = env.last_deployment
          return (
            <div key={env.id} className="env-card">
              <div className="env-top">
                <b>{env.name}</b>
                <span className="mono muted">{env.trigger}</span>
                <span className="mono muted" title="тип исполнения">
                  {env.exec_type === 'pipeline' ? 'пайплайн хостинга'
                    : env.exec_type === 'k8s' ? 'kubernetes'
                      : env.exec_type === 'gitops' ? 'gitops' : 'ssh'}
                </span>
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
                    {last.external_url && (
                      <a className="mono" href={last.external_url} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}>
                        {env.exec_type === 'gitops' ? 'коммит ↗' : 'прогон ↗'}
                      </a>
                    )}
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
                  ? <Button variant="primary" size="sm" busy={actBusy === env.id} disabled={!!actBusy && actBusy !== env.id} onClick={act(env.id, () => api.resumeEnv(env.id))}>Возобновить</Button>
                  : <Button variant="primary" size="sm" busy={actBusy === env.id} disabled={(!!last && active(last.status)) || (!!actBusy && actBusy !== env.id)}
                      onClick={act(env.id, () => api.deploy(env.id))}>Опубликовать</Button>}
                <Button size="sm" onClick={() => setHistoryEnv(historyEnv === env.id ? null : env.id)}>
                  История
                </Button>
                {isAdmin && <Button size="sm" onClick={() => setEditing(env)}>Настроить</Button>}
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
                      {d.external_url && (
                        <div className="muted" style={{ fontSize: 11.5, padding: '0 8px 4px' }}>
                          {env.exec_type === 'gitops' ? 'коммит версии' : 'прогон пайплайна'}:{' '}
                          <a href={d.external_url} target="_blank" rel="noreferrer">{d.external_url}</a>
                        </div>
                      )}
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
  const [execType, setExecType] = useState<string>(env?.exec_type ?? 'ssh')
  const [cfg, setCfg] = useState<EnvConfig>(env?.config ?? { deploy_cmd: '' })
  const [caps, setCaps] = useState<string[]>(env?.runner_caps ?? [])
  const [err, setErr] = useState('')
  const [busy, run] = useBusy()
  // Внешний пайплайн исполняет хостинг: команд и хоста у него нет,
  // Verify — проверка URL со стороны Rivet. У Kubernetes команды собирает
  // сам Rivet из параметров кластера.
  const external = execType === 'pipeline'
  const k8s = execType === 'k8s'
  const gitops = execType === 'gitops'
  const nameErr = !name.trim() && err ? 'Укажите имя окружения' : undefined

  const save = () => run(async () => {
    setErr('')
    try {
      if (env) await api.patchEnvironment(env.id, { name, trigger, config: cfg, runner_caps: caps })
      else await api.createEnvironment(projectId, { name, trigger, exec_type: execType, config: cfg, runner_caps: caps })
      onSaved()
    } catch (e) { setErr(errText(e)) }
  })
  const del = () => run(async () => {
    setErr('')
    try { await api.deleteEnvironment(env!.id); onSaved() } catch (e) { setErr(errText(e)) }
  })
  const text = (label: string, key: keyof EnvConfig, placeholder: string, hint?: string, mono = true) => (
    <Field label={label} hint={hint}>
      {ids => <TextInput ids={ids} mono={mono} placeholder={placeholder} value={(cfg[key] as string | undefined) ?? ''}
        onChange={e => setCfg({ ...cfg, [key]: e.target.value })} />}
    </Field>
  )

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal f-form" onClick={e => e.stopPropagation()}>
        <h2>{env ? 'Окружение: ' + env.name : 'Новое окружение'}</h2>
        <Field label="Имя" error={nameErr}>
          {ids => <TextInput ids={ids} placeholder="Имя (staging, prod…)" autoFocus value={name} onChange={e => setName(e.target.value)} />}
        </Field>
        <div className="f-grid">
          <Field label="Запуск">
            {ids => <Select ids={ids} value={trigger} onChange={e => setTrigger(e.target.value)}>
              <option value="manual">вручную</option>
              <option value="auto">автоматически после merge</option>
            </Select>}
          </Field>
          {!env && (
            <Field label="Доставка">
              {ids => <Select ids={ids} value={execType} onChange={e => setExecType(e.target.value)}>
                <option value="ssh">своя (Linux-хост по SSH)</option>
                <option value="k8s">своя (Kubernetes)</option>
                <option value="pipeline">пайплайн хостинга (CI/CD)</option>
                <option value="gitops">GitOps (коммит версии)</option>
              </Select>}
            </Field>
          )}
        </div>
        {external ? (
          <>
            {text('Пайплайн хостинга', 'pipeline', 'Пайплайн хостинга (для GitHub Actions — файл workflow)')}
            {text('Ветка запуска', 'ref', 'Ветка запуска (пусто — базовая ветка проекта)', 'пусто, если базовая ветка проекта')}
          </>
        ) : gitops ? (
          <>
            {text('Репозиторий конфигурации', 'repo', 'Репозиторий конфигурации (пусто — репозиторий проекта)', 'пусто, если репозиторий проекта')}
            {text('Ветка коммита', 'ref', 'Ветка коммита (пусто — базовая ветка проекта)')}
            {text('Файл с версией', 'file', 'Файл с версией (envs/prod/values.yaml)')}
            {text('Ключ YAML', 'key', 'Ключ YAML (image.tag; пусто — файл целиком)', 'пусто, если файл целиком')}
          </>
        ) : k8s ? (
          <>
            {text('Namespace', 'namespace', 'Namespace')}
            {text('Каталог манифестов', 'manifests', 'Каталог манифестов в репозитории (deploy/k8s)')}
            {text('Объект для проверки выката', 'workload', 'Объект для проверки выката (deployment/api)')}
            {text('Helm-чарт', 'chart', 'Или helm-чарт в репозитории (charts/api)', 'вместо манифестов')}
            {text('Релиз helm', 'release', 'Релиз helm')}
          </>
        ) : (
          <>
            {text('Хост', 'host', "Хост ([user@]host[:port], пусто — локально на runner'е)", "пусто, если команды выполняются на runner'е")}
            {text('Команда доставки', 'deploy_cmd', 'Команда доставки (deploy_cmd)')}
            {text('Команда проверки', 'verify_cmd', 'Команда проверки (verify_cmd)')}
          </>
        )}
        {text('URL health-check', 'verify_url', 'URL health-check (verify_url)')}
        {!external && !gitops && (
          <Field label="Capabilities runner'а публикации" optional hint="пусто, если подходит любой deploy-runner">
            {ids => <TagsInput ids={ids} value={caps} onChange={setCaps} placeholder="Capability runner'а публикации через запятую (пусто — любой deploy-runner)" />}
          </Field>
        )}
        <FormActions note={<FormNote err={err || undefined} />}>
          {env && <Button variant="danger" busy={busy} onClick={del}>Удалить</Button>}
          <Button variant="quiet" onClick={onClose}>Отмена</Button>
          <Button variant="primary" busy={busy} busyLabel="сохраняю…" onClick={save}>Сохранить</Button>
        </FormActions>
      </div>
    </div>
  )
}
