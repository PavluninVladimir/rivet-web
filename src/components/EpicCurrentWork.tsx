import type { EpicView, Task } from '../api/client'
import { useStore } from '../store'
import { Performer } from './RoleChip'
import { taskWork } from './epicWork'

export function EpicCurrentWork({ epic, tasks }: { epic: EpicView; tasks: Task[] }) {
  const { team, href } = useStore()
  const rows = tasks.map(task => ({ task, work: taskWork(task, team) }))
  const active = rows.filter(r => r.work.assigned)
  const waiting = rows.filter(({ task, work }) => !work.assigned && !['done', 'cancelled'].includes(task.Status)
    && (task.Status !== 'queued' || task.WaitReason || task.BlockReason))
  const queued = tasks.filter(t => t.Status === 'queued' && !t.WaitReason && !t.BlockReason).length
  const closed = tasks.length > 0 && tasks.every(t => ['done', 'cancelled'].includes(t.Status))
  const summary = active.length ? `В работе: ${active.length}` : !tasks.length ? 'В Epic пока нет задач'
    : tasks.every(t => t.Status === 'done') ? 'Все задачи выполнены' : closed ? 'Незавершённых задач нет' : 'Нет назначенной работы'
  const list = (items: typeof rows) => <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0', display: 'grid', gap: 6 }}>
    {items.map(({ task, work }) => <li key={task.ID} style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, overflowWrap: 'anywhere' }}>
      <a className="tlink" style={{ minWidth: 0 }} href={href({ view: 'epic', pid: epic.ProjectID, id: epic.ID, taskId: task.ID })}>
        <span className="mono">task-{task.Num}</span> · {task.Title}
      </a>
      <span className="muted">{work.label}</span>
      {work.assigned && <Performer roleId={work.roleId} agentName={work.agentName} runnerName={work.runnerName} />}
    </li>)}
  </ul>
  return <section className="dw-sec" aria-label="Текущая работа" style={{ paddingBottom: 10 }}>
    <h3>Текущая работа</h3>
    <p role="status">{summary}</p>
    {list(active)}
    {waiting.length > 3 ? <details key={epic.ID}>
      <summary style={{ cursor: 'pointer' }}>Ожидают задачи: {waiting.length}</summary>
      {list(waiting)}
    </details> : list(waiting)}
    {queued > 0 && <p className="muted">В очереди: {queued}</p>}
  </section>
}
