import { useCallback, useEffect, useState } from 'react'
import { api, type Epic } from '../api/client'
import { StBadge } from '../components/ui'
import { useStore } from '../store'

export function EpicsView() {
  const { projectId, nav, tick } = useStore()
  const [epics, setEpics] = useState<Epic[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [err, setErr] = useState('')

  const refresh = useCallback(() => {
    if (projectId) api.epics(projectId).then(e => setEpics(e ?? [])).catch(() => {})
  }, [projectId])
  useEffect(refresh, [refresh, tick])

  const create = async () => {
    if (!projectId) return
    try {
      const e = await api.createEpic(projectId, title, goal)
      setCreating(false); setTitle(''); setGoal(''); setErr('')
      nav({ view: 'epic', id: e.ID })
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Epic’и</h1>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>Новый Epic</button></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Название</th><th>Статус</th><th>Цель</th></tr></thead>
        <tbody>
          {epics.map(e => (
            <tr key={e.ID} className="rowlink" onClick={() => nav({ view: 'epic', id: e.ID })}>
              <td>{e.Title}</td>
              <td><StBadge s={e.Status} /></td>
              <td className="muted" style={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.Goal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <div className="modal-wrap" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Новый Epic</h2>
            <input placeholder="Название" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea placeholder="Цель — что нужно сделать (пойдёт в декомпозицию)" rows={5}
              value={goal} onChange={e => setGoal(e.target.value)} />
            {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}
            <div className="row">
              <button className="btn" onClick={() => setCreating(false)}>Отмена</button>
              <button className="btn primary" onClick={create}>Создать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
