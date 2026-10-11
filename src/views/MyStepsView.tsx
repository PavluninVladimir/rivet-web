import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type StepItem } from '../api/client'
import { timeShort } from '../components/ui'
import { useStore } from '../store'
import { Button, TextArea } from '../components/form'

// «Мои шаги» (add-process-humans, спека clients/web «Мои шаги в консоли»):
// запуски участников-людей, ждущие текущего пользователя, с действиями по
// типу шага. Карточки в стиле блока «needs attention» прототипа.

const ASK: Record<string, string> = {
  review: 'Проверьте изменения и одобрите или верните с замечаниями',
  code: 'Реализуйте задачу в ветке и отметьте готово',
  test: 'Проверьте результат и отметьте итог',
}

export function MyStepsView() {
  const { nav, tick, refreshMySteps } = useStore()
  const [items, setItems] = useState<StepItem[]>([])
  const [text, setText] = useState<Record<number, string>>({})
  const [err, setErr] = useState<Record<number, string>>({})
  // Обработанные запуски: запоздалый ответ фонового refresh не должен
  // вернуть карточку, по которой вердикт уже отправлен.
  const done = useRef(new Set<number>())
  // Порядок ответов: запоздавший ответ более раннего запроса игнорируется.
  const seq = useRef(0)

  const refresh = useCallback(() => {
    const my = ++seq.current
    api.mySteps().then(s => {
      if (my !== seq.current) return
      setItems((s ?? []).filter(x => !done.current.has(x.run_id)))
    }).catch(() => {})
  }, [])
  useEffect(refresh, [refresh, tick])

  const drop = (runId: number) => {
    done.current.add(runId)
    setItems(prev => prev.filter(x => x.run_id !== runId))
    refreshMySteps()
  }

  const [busyId, setBusyId] = useState<number | null>(null)
  const busyRef = useRef(false)
  const act = async (it: StepItem, verdict: 'ok' | 'changes' | 'fail') => {
    const detail = (text[it.run_id] ?? '').trim()
    if (verdict !== 'ok' && it.step.kind === 'review' && !detail) {
      setErr(prev => ({ ...prev, [it.run_id]: 'замечания обязательны' }))
      return
    }
    if (busyRef.current) return
    busyRef.current = true; setBusyId(it.run_id)
    try {
      await api.verdict(it.task.id, it.run_id, verdict, detail)
      drop(it.run_id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('run_closed') || msg.includes('уже закрыт')) {
        drop(it.run_id)
        return
      }
      setErr(prev => ({ ...prev, [it.run_id]: msg }))
    } finally {
      busyRef.current = false; setBusyId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Мои шаги</h1><span className="sub">запуски, ждущие вашего вердикта</span></div>
      {items.length === 0 && <div className="muted">Ничего не ждёт вашего решения.</div>}
      <div className="attention-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {items.map(it => (
          <div key={it.run_id} className="att-card step-card">
            <div className="att-head">
              <span className="att-reason">{it.step.kind.toUpperCase()} · {it.step.title}</span>
              <span className="mono muted" title="ждёт с">{timeShort(it.created_at)}</span>
            </div>
            <a className="att-task" onClick={() => nav({ view: 'epic', id: it.epic.id, taskId: it.task.id })}>
              task-{it.task.num}: {it.task.title}
            </a>
            <div className="muted" style={{ fontSize: 12 }}>{it.project.title} · {it.epic.title} · адресовано: {it.addressed}</div>
            <div className="att-msg">{ASK[it.step.kind] ?? 'Дайте вердикт'}</div>
            {it.task.pr_url && <a className="mono" href={it.task.pr_url} target="_blank" rel="noreferrer">PR: {it.task.pr_url}</a>}
            {!it.task.pr_url && it.task.branch && <div className="mono muted">ветка {it.task.branch}</div>}
            {it.context && <pre className="step-context">{it.context}</pre>}
            <TextArea className="step-text" aria-label="замечания" placeholder={it.step.kind === 'review' ? 'Замечания (обязательны при возврате)' : 'Комментарий'}
              value={text[it.run_id] ?? ''} onChange={e => { const v = e.target.value; setText(prev => ({ ...prev, [it.run_id]: v })) }} />
            {err[it.run_id] && <div className="err f-error" role="alert">{err[it.run_id]}</div>}
            <div className="step-actions">
              {it.step.kind === 'review'
                ? <>
                    <Button variant="primary" size="sm" busy={busyId === it.run_id} onClick={() => act(it, 'ok')}>Одобрить</Button>
                    <Button size="sm" busy={busyId === it.run_id} onClick={() => act(it, 'changes')}>Вернуть с замечаниями</Button>
                  </>
                : <>
                    <Button variant="primary" size="sm" busy={busyId === it.run_id} onClick={() => act(it, 'ok')}>Готово</Button>
                    <Button variant="danger" size="sm" busy={busyId === it.run_id} onClick={() => act(it, it.step.kind === 'test' ? 'changes' : 'fail')}>Провал</Button>
                  </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
