import { useEffect, useState } from 'react'
import { ProjectWizard } from '../components/ProjectWizard'
import { useStore } from '../store'

export function ProjectsView() {
  const { projects, refreshProjects, setProjectId, nav } = useStore()
  const [creating, setCreating] = useState(false)

  useEffect(refreshProjects, [refreshProjects])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Проекты</h1>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>Новый проект</button></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Название</th><th>Репозиторий</th><th>Хостинг</th><th></th></tr></thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.ID} className="rowlink" onClick={() => { setProjectId(p.ID); nav({ view: 'epics' }) }}>
              <td>{p.Name}</td>
              <td className="mono muted">{p.repo_path || p.Repo}</td>
              <td className="mono muted">{p.provider}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn sm" onClick={e => {
                  e.stopPropagation(); setProjectId(p.ID); nav({ view: 'project-settings', id: p.ID, tab: 'general' })
                }}>Настройки</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <ProjectWizard onClose={() => setCreating(false)} onCreated={p => {
          setCreating(false); refreshProjects(); setProjectId(p.ID); nav({ view: 'epics' })
        }} />
      )}
    </div>
  )
}
