import { useCallback, useEffect, useState } from 'react'
import { api, type Epic, type Task } from '../api/client'
import { StBadge } from '../components/ui'
import { useStore } from '../store'

// Сквозной список задач проекта + очередь needs attention.
export function TasksView() {
  const { projectId, nav, tick, attention } = useStore()
  const [rows, setRows] = useState<{ epic: Epic; task: Task }[]>([])
  const [q, setQ] = useState('')

  const refresh = useCallback(async () => {
    if (!projectId) return
    const epics = (await api.epics(projectId)) ?? []
    const all: { epic: Epic; task: Task }[] = []
    for (const e of epics) {
      const view = await api.epic(e.ID)
      for (const t of view.tasks ?? []) all.push({ epic: e, task: t })
    }
    setRows(all)
  }, [projectId])
  useEffect(() => { refresh().catch(() => {}) }, [refresh, tick])

  const filtered = rows.filter(({ task }) =>
    !q || task.Title.toLowerCase().includes(q.toLowerCase()) || `task-${task.Num}`.includes(q))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Задачи</h1>
        <span className="sub">{rows.length} всего</span>
        <div className="right">
          <input className="search" placeholder="Фильтр…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {attention.length > 0 && (
        <div className="attention" style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14 }}>
          <div className="attention-head"><h2>Требует внимания</h2><span className="n">{attention.length}</span></div>
          <div className="attention-row">
            {attention.map(a => {
              const row = rows.find(r => r.task.ID === a.TaskID)
              return (
                <button key={a.ID} className="att-card"
                  onClick={() => row && nav({ view: 'epic', id: row.epic.ID, taskId: a.TaskID })}>
                  <div className="att-top">
                    <span className="tid mono">task-{row?.task.Num ?? '?'}</span>
                    <span className="att-reason">{a.Reason}</span>
                  </div>
                  <div className="att-msg">{a.Message}</div>
                  <div className="att-act">Открыть →</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>Задача</th><th>Название</th><th>Epic</th><th>Статус</th><th>Runner</th></tr></thead>
        <tbody>
          {filtered.map(({ epic, task }) => (
            <tr key={task.ID} className="rowlink" onClick={() => nav({ view: 'epic', id: epic.ID, taskId: task.ID })}>
              <td className="id">task-{task.Num}</td>
              <td>{task.Title}</td>
              <td className="muted">{epic.Title}</td>
              <td><StBadge s={task.Status} /></td>
              <td className="mono muted">{task.RunnerID || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
