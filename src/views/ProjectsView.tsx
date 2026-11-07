import { useEffect, useState } from 'react'
import { ProjectWizard } from '../components/ProjectWizard'
import { routeHash, useStore } from '../store'
import { projectHome } from '../routes'
import { providerLabel } from '../components/providerLabel'

// Список проектов — вход в проект (add-project-navigation): клик по строке
// или имени открывает обзор проекта. Эскалации видны у каждого проекта,
// чтобы не терять их вне проекта.
export function ProjectsView() {
  const { projects, refreshProjects, refreshAttention, attention, nav } = useStore()
  const [creating, setCreating] = useState(false)

  // Поток событий несёт один проект: эскалации остальных перечитываются
  // при открытии списка.
  useEffect(() => { refreshProjects(); refreshAttention() }, [refreshProjects, refreshAttention])

  const escalations = (pid: string) => attention.filter(a => a.ProjectID === pid).length

  return (
    <div className="page">
      <div className="page-head">
        <h1>Проекты</h1>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>Новый проект</button></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Название</th><th>Репозиторий</th><th>Хостинг</th><th className="num">Эскалации</th><th></th></tr></thead>
        <tbody>
          {projects.map(p => {
            const n = escalations(p.ID)
            return (
              <tr key={p.ID} className="rowlink" onClick={() => nav(projectHome(p.ID))}>
                {/* Ссылка — вход с клавиатуры; клик по ней строку не дублирует. */}
                <td><a className="proj-link" href={routeHash(projectHome(p.ID))} onClick={e => e.stopPropagation()}>{p.Name}</a></td>
                <td className="mono muted">{p.repo_path || p.Repo}</td>
                <td className="muted">{providerLabel(p.provider)}</td>
                <td className="num" data-escalations={n}>
                  {n > 0 ? <span className="count warn" title="Эскалации, ждущие решения">{n}</span> : <span className="muted">—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm" onClick={e => {
                    e.stopPropagation(); nav({ view: 'project-settings', pid: p.ID, tab: 'general' })
                  }}>Настройки</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {creating && (
        // Новый проект пуст: следующий шаг — первый Epic, поэтому мастер
        // открывает Epic’и, а не обзор.
        <ProjectWizard onClose={() => setCreating(false)} onCreated={p => {
          setCreating(false); refreshProjects(); nav({ view: 'epics', pid: p.ID })
        }} />
      )}
    </div>
  )
}
