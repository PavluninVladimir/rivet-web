import { useState } from 'react'
import { api, type ArchitectureAssessmentView } from '../api/client'
import { useStore } from '../store'
import { Button, errText } from './form'

const STATUS = { pending: 'Ожидает Архитектора', running: 'Архитектор оценивает влияние', waiting: 'Оценка ожидает', passed: 'Архитектурная оценка пройдена', failed: 'Оценка не завершена' }

export function EpicAssessment({ epicId, projectId, view, onChanged }: { epicId: string; projectId: string; view?: ArchitectureAssessmentView; onChanged: () => void }) {
  const { href } = useStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!view?.required) return null
  const a = view.assessment
  const result = a?.result
  const retry = async () => {
    setBusy(true); setErr('')
    try { await api.retryEpicAssessment(epicId); onChanged() } catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }
  return <section className="dw-sec" aria-label="Архитектурная оценка Epic" style={{ overflowWrap: 'anywhere' }}>
    <h3>Архитектура → Планирование</h3>
    <p role="status">{a ? STATUS[a.status] : STATUS.pending}{a?.agent_name ? ` · ${a.agent_name}` : ''}</p>
    {a?.discovery_run_id && <a className="tlink" href={href({ view: 'discovery', pid: projectId, runId: a.discovery_run_id })}>Исходное исследование</a>}
    {a?.error && <p role="status">{a.error}</p>}
    {a?.planning_error && <p role="status">{a.planning_error}</p>}
    {result ? <>
      <p><b>{result.decision === 'no_change' ? 'Архитектурные изменения не нужны' : 'Есть архитектурные требования'}</b></p>
      <p>{result.summary}</p>
      {a?.existing_plan && <p className="muted">Этот план создан до архитектурной оценки. Перед запуском проверьте его с учётом полученных ограничений. Задачи сохранены; выполнение не запускалось автоматически.</p>}
      {([['Влияние', result.impact ?? []], ['Ограничения для плана', result.constraints ?? []], ['Документация', result.documentation ?? []], ['Риски', result.risks ?? []]] as const).map(([label, items]) => items.length > 0 && <div key={label}><b>{label}</b><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
      {a?.decompose_requested && <p className="muted">Запрошенный план составляется автоматически. Запуск выполнения остаётся отдельным действием.</p>}
    </> : <p className="muted">До успешной оценки планирование и первый запуск закрыты.{a?.decompose_requested ? ' Запрос на план сохранён: после оценки Тимлид продолжит автоматически.' : ''}</p>}
    {a?.status === 'failed' && <Button busy={busy} onClick={retry}>Повторить архитектурную оценку</Button>}
    {err && <div className="f-error" role="alert">{err}</div>}
  </section>
}
