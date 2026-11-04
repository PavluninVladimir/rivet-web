import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errCode, type Incident, type IncidentFilter } from '../api/client'
import { incidentAfter } from '../components/pagedList'
import { usePaged } from '../components/usePaged'
import { useStore } from '../store'
import { Button, Field, FormNote, TextArea, errText } from '../components/form'
import { Markdown } from '../components/Markdown'
import { StBadge, fmtAgo, fmtDate } from '../components/ui'
import { useIsOwner } from '../components/useOwner'
import { BugRef } from '../components/BugRef'
import { bugOpen } from '../components/bugState'

// Инциденты проекта (add-sdlc-cycle, спека web «Релизы и инциденты в
// консоли»): открытые и смягчённые первыми, карточка с доказательствами в
// свёрнутых блоках, описанием, задачей-багом, историей и ручным закрытием.

const STATUS: Record<string, string> = { open: 'открыт', mitigated: 'смягчён', resolved: 'закрыт' }
const RESOLUTION: Record<string, string> = { fixed: 'исправлен', self: 'самоустранился', manual: 'закрыт вручную' }
const FILTERS: { id: IncidentFilter; label: string }[] = [
  { id: 'active', label: 'активные' }, { id: 'open', label: 'открытые' }, { id: 'mitigated', label: 'смягчённые' }, { id: 'resolved', label: 'закрытые' },
]

export function IncidentsView({ id, login }: { id?: string; login: string }) {
  const { projectId, eventTick, nav } = useStore()
  const [filter, setFilter] = useState<IncidentFilter>('active')
  // События перечитывают первую страницу и сливают её со списком: «Ещё» и
  // догруженный хвост не теряются (pagedList).
  const { rows: list, next, err, reload: load, more } = usePaged<Incident>(
    (projectId ?? '') + '|' + filter,
    before => projectId ? api.incidents(projectId, { status: filter, limit: 50, before })
      .then(r => ({ rows: r.incidents ?? [], next: r.next || null })) : null,
    incidentAfter, eventTick)
  return (
    <div className="page">
      <div className="page-head">
        <h1>Инциденты</h1>
        <div className="right" role="group" aria-label="фильтр">
          {FILTERS.map(f => (
            <button key={f.id} className={'chip' + (f.id === filter ? ' on' : '')} aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>
      {err && <FormNote err={err} />}
      <div className={'split' + (id ? ' with-detail' : '')}>
        <div className="panel">
          {list.length === 0 && <div className="muted" style={{ padding: 12 }}>Инцидентов нет.</div>}
          <table className="tbl">
            <tbody>
              {list.map(i => (
                <tr key={i.id} className={'rowlink' + (i.id === id ? ' sel' : '')} tabIndex={0} aria-selected={i.id === id}
                  onClick={() => nav({ view: 'incidents', id: i.id })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav({ view: 'incidents', id: i.id }) } }}>
                  <td><span className={'inc-status s-' + i.status}>{STATUS[i.status]}</span></td>
                  <td><span className={'inc-sev s-' + i.severity}>{i.severity}</span></td>
                  <td className="inc-title">{i.title}{i.needs_human && <span className="cn-human" title="нужен человек" aria-label="нужен человек">!</span>}</td>
                  <td className="muted">{i.env_name}</td>
                  <td className="mono">×{i.occurrences}</td>
                  <td><BugRef bug={i.bug_task} /></td>
                  <td className="muted mono">{fmtAgo(i.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {next && <div style={{ padding: 8 }}><Button size="sm" onClick={more}>Ещё</Button></div>}
        </div>
        {id && <IncidentCard key={id} id={id} login={login} onChanged={load} />}
      </div>
    </div>
  )
}

function Evidence({ title, text }: { title: string; text?: string }) {
  if (!text) return null
  return (
    <details className="inc-ev">
      <summary>{title}</summary>
      <pre className="term">{text}</pre>
    </details>
  )
}

function IncidentCard({ id, login, onChanged }: { id: string; login: string; onChanged: () => void }) {
  const { eventTick, nav } = useStore()
  const [inc, setInc] = useState<Incident | null>(null)
  const owner = useIsOwner(inc?.project_id ?? null, login)
  // loadErr — ошибка чтения карточки, actErr — ошибка действия владельца:
  // удачное перечитывание снимает первую, следующее действие — вторую.
  const [loadErr, setLoadErr] = useState('')
  const [actErr, setActErr] = useState('')
  const [comment, setComment] = useState('')
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const reload = useCallback(() => {
    const n = ++seq.current
    api.incident(id)
      .then(v => { if (n === seq.current) { setInc(v); setLoadErr('') } })
      .catch(e => { if (n === seq.current) setLoadErr(errText(e)) })
  }, [id])
  useEffect(reload, [reload, eventTick])
  const act = async (fn: () => Promise<Incident>) => {
    setBusy(true); setActErr('')
    try { setInc(await fn()); setClosing(false); onChanged() }
    catch (e) {
      const code = errCode(e)
      setActErr(code === 'incident_resolved' ? 'инцидент уже закрыт' : code === 'bug_exists' ? 'у инцидента уже есть незавершённая задача-баг' : errText(e))
      // Конфликт значит, что карточка устарела: перечитать сразу.
      if (code === 'incident_resolved' || code === 'bug_exists') { reload(); onChanged() }
    }
    finally { setBusy(false) }
  }
  const err = actErr || loadErr
  if (!inc) return <div className="panel detail">{err ? <FormNote err={err} /> : <span className="muted">Загрузка…</span>}</div>
  const d = inc.description
  const ev = inc.evidence ?? {}
  const active = inc.status !== 'resolved'
  // Баг открыт так же, как на бэкенде (BugState.Unfinished): отменённый и
  // смерженный баг не мешает создать новый. Баг по шаблонному описанию ждёт
  // подтверждения владельца.
  const open = bugOpen(inc.bug_task)
  const templateBug = inc.needs_human && !open && d.status === 'template'
  return (
    <div className="panel detail incident-card">
      <div className="dw-sec">
        <h3>
          <span className={'inc-status s-' + inc.status}>{STATUS[inc.status]}</span>{' '}
          <span className={'inc-sev s-' + inc.severity}>{inc.severity}</span>{' '}
          {inc.source === 'release' ? 'провал публикации' : 'наблюдение'} · {inc.env_name}
        </h3>
        <div className="inc-head">{inc.title}</div>
        <div className="muted">
          впервые {fmtDate(inc.first_seen)} · последний раз {fmtAgo(inc.last_seen)} · повторов {inc.occurrences}
          {inc.resolution ? ` · ${RESOLUTION[inc.resolution] ?? inc.resolution}` : ''}
        </div>
        {inc.needs_human && (
          <div className="model-warn" role="status">
            {inc.bug_cancelled_by ? `Задачу-баг отменил ${inc.bug_cancelled_by}: новая сама не создаётся.`
              : templateBug ? 'Описание собрано по шаблону из сырых логов: задачу-баг создаёт владелец после просмотра доказательств.'
                : 'Нужен человек: сопровождение упёрлось в лимит.'}
          </div>
        )}
        {inc.skipped_daily && !open && <div className="muted">Баг не создан: превышен суточный лимит новых инцидентов.</div>}
      </div>

      <div className="dw-sec">
        <h3>Описание {d.status === 'pending' ? '· пишется' : d.status === 'template' ? '· по шаблону' : d.agent ? `· ${d.agent.name}` : ''}</h3>
        {d.status === 'pending' && !d.summary ? <div className="muted">Инженер сопровождения описывает инцидент…</div> : (
          <>
            {d.summary && <p>{d.summary}</p>}
            {d.cause && <p><b>Вероятная причина:</b> {d.cause}</p>}
            {d.reproduction.length > 0 && <ol>{d.reproduction.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            {d.bug.title && (
              <details className="inc-ev">
                <summary>Предложение бага: {d.bug.title}</summary>
                <Markdown text={d.bug.description} />
                {d.bug.criteria.length > 0 && <ul>{d.bug.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              </details>
            )}
          </>
        )}
      </div>

      <div className="dw-sec">
        <h3>Задача-баг</h3>
        {inc.bug_task
          ? <button className="cp-item" onClick={() => {
              const taskId = inc.bug_task!.id
              api.task(taskId).then(r => nav({ view: 'epic', id: r.task.EpicID, taskId })).catch(() => nav({ view: 'tasks' }))
            }}>
              <span className="mono">task-{inc.bug_task.num}</span><StBadge s={inc.bug_task.status} />
            </button>
          : <span className="muted">нет</span>}
        {inc.mitigated_release_id && <a className="cp-sub" onClick={() => nav({ view: 'releases', id: inc.mitigated_release_id })}>релиз с исправлением →</a>}
      </div>

      <div className="dw-sec">
        <h3>Доказательства</h3>
        {ev.stage && <div className="muted">этап: {ev.stage}</div>}
        <Evidence title="Вывод проверки" text={ev.check_output} />
        <Evidence title="Логи" text={ev.logs} />
        <Evidence title="Лог публикации" text={ev.deploy_log} />
      </div>

      <div className="dw-sec">
        <h3>История</h3>
        <ul className="inc-history">
          {(inc.history ?? []).map((h, i) => (
            <li key={i}><span className="mono muted">{fmtDate(h.at)}</span> <span className={'inc-status s-' + h.status}>{STATUS[h.status] ?? h.status}</span> <span className="muted">{h.by}</span> {h.note}</li>
          ))}
        </ul>
      </div>

      {owner && active && (
        <div className="dw-sec">
          {closing ? (
            <>
              <Field label="Комментарий к закрытию" error={err && !comment.trim() ? 'нужен комментарий' : undefined}>
                {ids => <TextArea ids={ids} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} placeholder="Что сделано, почему инцидент можно закрыть" />}
              </Field>
              <div className="dw-actions">
                <Button size="sm" variant="primary" busy={busy} disabled={!comment.trim()} onClick={() => act(() => api.resolveIncident(id, comment))}>Закрыть инцидент</Button>
                <Button size="sm" variant="quiet" onClick={() => setClosing(false)}>Отмена</Button>
              </div>
            </>
          ) : (
            <div className="dw-actions">
              <Button size="sm" onClick={() => setClosing(true)}>Закрыть вручную</Button>
              {(inc.bug_cancelled_by || templateBug) && !open && (
                <Button size="sm" busy={busy} onClick={() => act(() => api.rebugIncident(id))}>
                  {templateBug ? 'Создать баг' : 'Создать баг заново'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {err && <FormNote err={err} />}
    </div>
  )
}
