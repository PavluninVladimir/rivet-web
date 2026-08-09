import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Event, type Task } from '../api/client'
import { useStore } from '../store'
import { StBadge, attemptStr, timeShort } from './ui'

export function TaskDrawer({ taskId, onClose, onChanged }: {
  taskId: string
  onClose: () => void
  onChanged: () => void
}) {
  const { tick, logs } = useStore()
  const [task, setTask] = useState<Task | null>(null)
  const [timeline, setTimeline] = useState<Event[]>([])
  const [answer, setAnswer] = useState('')
  const [err, setErr] = useState('')
  const termRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    api.task(taskId).then(({ task, timeline }) => {
      setTask(task)
      setTimeline(timeline ?? [])
    }).catch(e => setErr(String(e)))
  }, [taskId])
  useEffect(refresh, [refresh, tick])

  const log = logs.get(taskId) ?? ''
  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight })
  }, [log])

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr('')
    try { await fn(); onChanged(); refresh() } catch (e) { setErr(String(e)) }
  }

  if (!task) return null
  const live = ['running', 'testing', 'fixing', 'review'].includes(task.Status)

  return (
    <aside id="drawer">
      <div className="dw-head">
        <div className="dw-top">
          <span className="tid">task-{task.Num}</span>
          <StBadge s={task.Status} />
          <button className="close" onClick={onClose}>✕</button>
        </div>
        <h2>{task.Title}</h2>
        <div className="dw-actions">
          {task.Status === 'review' && task.PRURL &&
            <button className="btn primary sm" onClick={act(() => api.merge(task.ID))}>Merge</button>}
          {task.PRURL &&
            <a className="btn sm" href={task.PRURL} target="_blank" rel="noreferrer">Открыть PR</a>}
          {task.Status === 'failed' &&
            <button className="btn sm" onClick={act(() => api.retry(task.ID))}>Повторить</button>}
          {!['done', 'cancelled'].includes(task.Status) &&
            <button className="btn sm danger" onClick={act(() => api.cancel(task.ID))}>Отменить</button>}
        </div>
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>

      <div className="dw-body">
        {task.Status === 'blocked' && (
          <div className="dw-sec">
            <h3>Вопрос агента</h3>
            <p style={{ fontSize: 12.5, margin: '0 0 8px' }}>{task.BlockReason}</p>
            <textarea className="answer" placeholder="Ответ / уточнение критериев…"
              value={answer} onChange={e => setAnswer(e.target.value)} />
            <div style={{ marginTop: 8 }}>
              <button className="btn primary sm" disabled={!answer.trim()}
                onClick={act(async () => { await api.answer(task.ID, answer); setAnswer('') })}>
                Ответить и вернуть в работу
              </button>
            </div>
          </div>
        )}

        <div className="dw-sec">
          <h3>Метаданные</h3>
          <div className="meta-grid">
            <div className="kv"><span>runner</span><b>{task.RunnerID || '—'}</b></div>
            <div className="kv"><span>попытки</span><b>{attemptStr(task.AttemptUsed, task.AttemptLimit)}</b></div>
            <div className="kv"><span>ветка</span><b>{task.Branch || '—'}</b></div>
            <div className="kv"><span>оценка</span><b>{task.Estimate}</b></div>
          </div>
        </div>

        {task.Description && (
          <div className="dw-sec">
            <h3>Описание</h3>
            <p style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', margin: 0 }}>{task.Description}</p>
          </div>
        )}

        {(task.Criteria?.length ?? 0) > 0 && (
          <div className="dw-sec">
            <h3>Acceptance criteria</h3>
            {task.Criteria!.map((c, i) => (
              <div key={i} className={'crit ' + (c.ok ? 'ok' : 'pend')}>
                <span className="m">{c.ok ? '✓' : '○'}</span>{c.text}
              </div>
            ))}
          </div>
        )}

        {live && (
          <div className="dw-sec">
            <h3>Live</h3>
            <div className="term" ref={termRef}>{log || 'ожидание вывода…'}</div>
          </div>
        )}

        <div className="dw-sec">
          <h3>Timeline</h3>
          <div className="tl">
            {timeline.map(e => (
              <div key={e.ID} className={'tl-row'
                  + (e.Type.includes('denied') || e.Text.includes('заблокирована') ? ' bad' : '')
                  + (e.Type === 'task.review_passed' ? ' warn' : '')}>
                <span className="t">{timeShort(e.TS)}</span>
                <span>{e.Text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
