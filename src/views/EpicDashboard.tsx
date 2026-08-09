import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, stColor, type EpicView, type Runner, type Task } from '../api/client'
import { Dag, type DagFilter } from '../components/Dag'
import { TaskDrawer } from '../components/TaskDrawer'
import { StBadge } from '../components/ui'
import { useStore } from '../store'

const SEG_ORDER = ['done', 'running', 'testing', 'fixing', 'review', 'ready', 'queued', 'blocked', 'failed', 'cancelled']

export function EpicDashboard({ epicId, taskId }: { epicId: string; taskId?: string }) {
  const { nav, tick, attention } = useStore()
  const [epic, setEpic] = useState<EpicView | null>(null)
  const [runners, setRunners] = useState<Runner[]>([])
  const [mode, setMode] = useState<'graph' | 'list'>('graph')
  const [filter, setFilter] = useState<DagFilter>('all')
  const [hideDone, setHideDone] = useState(false)
  const [showCP, setShowCP] = useState(false)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const refresh = useCallback(() => {
    api.epic(epicId).then(setEpic).catch(e => setErr(String(e)))
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [epicId])
  useEffect(refresh, [refresh, tick])

  const tasks: Task[] = useMemo(() => epic?.tasks ?? [], [epic])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tasks) c[t.Status] = (c[t.Status] ?? 0) + 1
    return c
  }, [tasks])

  const openTask = (id: string) => nav({ view: 'epic', id: epicId, taskId: id })
  const closeTask = () => nav({ view: 'epic', id: epicId })

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr('')
    try { await fn(); refresh() } catch (e) { setErr(String(e)) }
  }

  if (!epic) return <div className="page">{err || 'Загрузка…'}</div>

  const total = tasks.reduce((s, t) => s + t.Estimate, 0) || 1
  const epicAtt = attention.filter(a => tasks.some(t => t.ID === a.TaskID))
  const online = runners.filter(r => r.Status !== 'offline')

  return (
    <div className="view-epic">
      <div className="epic-head">
        <div className="epic-title-row">
          <span className="epic-id">EPIC</span>
          <h1>{epic.Title}</h1>
          <StBadge s={epic.Status} />
          <div className="epic-actions">
            {epic.Status === 'planned' && tasks.length === 0 &&
              <button className="btn" onClick={act(() => api.decompose(epic.ID))}>Декомпозировать</button>}
            {epic.Status === 'planned' && <button className="btn primary" onClick={act(() => api.epicAction(epic.ID, 'start'))}>Запустить</button>}
            {epic.Status === 'running' && <button className="btn" onClick={act(() => api.epicAction(epic.ID, 'pause'))}>Пауза</button>}
            {epic.Status === 'paused' && <button className="btn primary" onClick={act(() => api.epicAction(epic.ID, 'resume'))}>Возобновить</button>}
            {['planned', 'paused', 'done'].includes(epic.Status) &&
              <button className="btn" onClick={act(() => api.epicAction(epic.ID, 'archive'))}>Архивировать</button>}
            <button className="btn" onClick={() => setAdding(true)}>Добавить задачу</button>
          </div>
        </div>
        <div className="epic-meta-row">
          <span className="pct">{epic.progress.pct}%</span>
          <div className="progress">
            {SEG_ORDER.filter(s => counts[s]).map(s => {
              const est = tasks.filter(t => t.Status === s).reduce((sum, t) => sum + t.Estimate, 0)
              return <i key={s} style={{ width: `${(est / total) * 100}%`, background: `var(${stColor[s] ?? '--c-queue'})` }} />
            })}
          </div>
          <span className="sub">{counts['done'] ?? 0} / {tasks.length} задач · взвешено по оценке</span>
          <div className="epic-chips">
            {SEG_ORDER.filter(s => s !== 'done' && counts[s]).map(s => (
              <span key={s} className="chip">
                <span className="dot" style={{ background: `var(${stColor[s] ?? '--c-queue'})` }} />
                {s} <span className="n">{counts[s]}</span>
              </span>
            ))}
          </div>
        </div>
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginTop: 6 }}>{err}</div>}
      </div>

      {epicAtt.length > 0 && (
        <div className="attention">
          <div className="attention-head"><h2>Требует внимания</h2><span className="n">{epicAtt.length}</span></div>
          <div className="attention-row">
            {epicAtt.slice(0, 3).map(a => {
              const t = tasks.find(x => x.ID === a.TaskID)
              return (
                <button key={a.ID} className="att-card" onClick={() => openTask(a.TaskID)}>
                  <div className="att-top"><span className="tid mono">task-{t?.Num ?? '?'}</span><span className="att-reason">{a.Reason}</span></div>
                  <div className="att-msg">{a.Message}</div>
                  <div className="att-act">Открыть →</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="epic-body">
        <div className="dag-panel">
          <div className="dag-toolbar">
            <div className="seg">
              <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Граф</button>
              <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Список</button>
            </div>
            <div className="seg">
              {(['all', 'active', 'review', 'blocked', 'done'] as DagFilter[]).map(f => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {{ all: 'Все', active: 'Активные', review: 'Review', blocked: 'Блок', done: 'Готово' }[f]}
                </button>
              ))}
            </div>
            <button className={'tglbtn' + (hideDone ? ' on' : '')} onClick={() => setHideDone(h => !h)}>Скрыть завершённые</button>
            <button className={'tglbtn' + (showCP ? ' on' : '')} onClick={() => setShowCP(c => !c)}>Критический путь</button>
          </div>
          {mode === 'graph'
            ? <Dag tasks={tasks} filter={filter} hideDone={hideDone} showCP={showCP} selected={taskId} onSelect={openTask} />
            : (
              <div className="epic-list">
                <table className="tbl">
                  <thead><tr><th>Задача</th><th>Название</th><th>Статус</th><th>Runner</th><th className="num">Попытки</th></tr></thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr key={t.ID} className="rowlink" onClick={() => openTask(t.ID)}>
                        <td className="id">task-{t.Num}</td>
                        <td>{t.Title}</td>
                        <td><StBadge s={t.Status} /></td>
                        <td className="mono muted">{t.RunnerID || '—'}</td>
                        <td className="num">{t.AttemptUsed}/{t.AttemptLimit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <aside className="rail">
          <div className="rail-head"><h2>Runner’ы</h2><span className="n">{online.length} online</span></div>
          <div className="rail-body">
            {online.map(r => (
              <div key={r.ID} className="runner-card">
                <div className="rc-top">
                  <span className="name">{r.ID}</span>
                  <span className="muted" style={{ fontSize: 10.5 }}>{r.Model || r.Agent}</span>
                  <StBadge s={r.Status} />
                </div>
                {r.TaskID && <div className="rc-action mono">{tasks.find(t => t.ID === r.TaskID) ? `task-${tasks.find(t => t.ID === r.TaskID)!.Num}` : 'занят'}</div>}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {taskId && <TaskDrawer taskId={taskId} onClose={closeTask} onChanged={refresh} />}
      {adding && <AddTaskModal epicId={epic.ID} tasks={tasks} onClose={() => setAdding(false)} onAdded={refresh} />}
    </div>
  )
}

function AddTaskModal({ epicId, tasks, onClose, onAdded }: {
  epicId: string; tasks: Task[]; onClose: () => void; onAdded: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [criteria, setCriteria] = useState('')
  const [deps, setDeps] = useState<string[]>([])
  const [err, setErr] = useState('')

  const create = async () => {
    try {
      await api.addTask(epicId, {
        title, description,
        criteria: criteria.split('\n').map(s => s.trim()).filter(Boolean),
        deps,
      })
      onAdded(); onClose()
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Новая задача</h2>
        <input placeholder="Название" value={title} onChange={e => setTitle(e.target.value)} />
        <textarea placeholder="Описание (самодостаточное — агент не видит остальной план)" rows={4}
          value={description} onChange={e => setDescription(e.target.value)} />
        <textarea placeholder="Acceptance criteria — по одному на строку" rows={3}
          value={criteria} onChange={e => setCriteria(e.target.value)} />
        {tasks.length > 0 && (
          <select multiple size={Math.min(4, tasks.length)} className="search" style={{ width: '100%' }}
            value={deps} onChange={e => setDeps([...e.target.selectedOptions].map(o => o.value))}>
            {tasks.map(t => <option key={t.ID} value={t.ID}>task-{t.Num} · {t.Title}</option>)}
          </select>
        )}
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}
        <div className="row">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!title.trim()} onClick={create}>Создать</button>
        </div>
      </div>
    </div>
  )
}
