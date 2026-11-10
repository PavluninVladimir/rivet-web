import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Epic, type Task } from '../api/client'
import { ClaimControl, StBadge } from '../components/ui'
import { AttCard } from '../components/AttCard'
import { Performer } from '../components/RoleChip'
import { attentionTarget } from '../components/overviewLogic'
import { useStore } from '../store'

// Сквозной список задач проекта + очередь needs attention. Эскалации —
// только текущего проекта (add-project-navigation): остальные видны
// счётчиками в списке проектов.
export function TasksView() {
  const { projectId, nav, href, tick, attention: all, refreshAttention } = useStore()
  const attention = useMemo(() => all.filter(a => a.ProjectID === projectId), [all, projectId])
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
              const claim = <ClaimControl id={a.ID} claimedBy={a.ClaimedBy} onClaimed={refreshAttention} />
              // Эскалация публикации (DEPLOY_FAILED) не привязана к задаче:
              // карточка ведёт к окружениям на странице настроек проекта.
              if (attentionTarget(a) === 'environments') {
                return <AttCard key={a.ID} href={href({ view: 'project-settings', pid: a.ProjectID, tab: 'environments' })}
                  tid={a.DeploymentID ? 'deploy' : 'хост'} reason={a.Reason} msg={a.Message} act={<>{claim}{' '}К окружениям →</>} />
              }
              // Эскалация уровня проекта (движок политик недоступен, учётные
              // данные хостинга не работают): ни задачи, ни публикации —
              // карточка ведёт в настройки проекта, к политикам или к
              // репозиторию, где заменяется токен.
              if (!a.TaskID) {
                return <AttCard key={a.ID} href={href({ view: 'project-settings', pid: a.ProjectID, tab: a.Reason === 'SCM_CREDENTIALS' ? 'general' : 'policies' })}
                  tid="проект" reason={a.Reason} msg={a.Message} act={<>{claim}{' '}К настройкам →</>} />
              }
              // Пока задача не нашлась в списке, адреса нет: карточка без
              // перехода, «Взять в работу» доступна и так.
              const row = rows.find(r => r.task.ID === a.TaskID)
              return <AttCard key={a.ID} href={row ? href({ view: 'epic', pid: a.ProjectID, id: row.epic.ID, taskId: a.TaskID }) : undefined}
                tid={`task-${row?.task.Num ?? '?'}`} reason={a.Reason} msg={a.Message} act={<>{claim}{' '}Открыть →</>} />
            })}
          </div>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>Задача</th><th>Название</th><th>Epic</th><th>Статус</th><th>Исполнитель</th></tr></thead>
        <tbody>
          {filtered.map(({ epic, task }) => (
            <tr key={task.ID} className="rowlink" onClick={() => nav({ view: 'epic', id: epic.ID, taskId: task.ID })}>
              <td className="id">task-{task.Num}</td>
              {/* Ссылка — вход с клавиатуры; клик по ней строку не дублирует. */}
              <td><a className="row-link" href={href({ view: 'epic', id: epic.ID, taskId: task.ID })} onClick={ev => ev.stopPropagation()}>{task.Title}</a></td>
              <td className="muted">{epic.Title}</td>
              <td><StBadge s={task.Status} /></td>
              <td className="mono muted"><Performer roleId={task.RoleID} agentName={task.AgentName} runnerName={task.RunnerName} runnerId={task.RunnerID} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
