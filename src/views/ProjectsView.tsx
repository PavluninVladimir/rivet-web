import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useStore } from '../store'

export function ProjectsView() {
  const { projects, refreshProjects, setProjectId, nav } = useStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [err, setErr] = useState('')

  useEffect(refreshProjects, [refreshProjects])

  const create = async () => {
    try {
      const p = await api.createProject(name, repo)
      setCreating(false); setName(''); setRepo(''); setErr('')
      refreshProjects(); setProjectId(p.ID); nav({ view: 'epics' })
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Проекты</h1>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>Новый проект</button></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Название</th><th>Репозиторий</th></tr></thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.ID} className="rowlink" onClick={() => { setProjectId(p.ID); nav({ view: 'epics' }) }}>
              <td>{p.Name}</td>
              <td className="mono muted">{p.Repo}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <div className="modal-wrap" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Новый проект</h2>
            <input placeholder="Название" value={name} onChange={e => setName(e.target.value)} />
            <input placeholder="Репозиторий (owner/name)" value={repo} onChange={e => setRepo(e.target.value)} />
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
