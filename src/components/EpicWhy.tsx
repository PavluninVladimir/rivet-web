import { useEffect, useState } from 'react'
import { api, isSystemEpic, type Epic, type EpicView, type Need } from '../api/client'
import { Button, Field, FormActions, FormNote, Select, errText, useBusy } from './form'
import { IMPORTANCE_LABEL, KIND_LABEL, waitingText } from './discovery'
import { useStore } from '../store'

// Дашборд Epic'а (add-product-discovery, спека web «Обоснование и
// зависимости на дашборде Epic»): плашка ожидания зависимостей, блок
// «Зачем этот Epic» и зависимости с правкой для владельца.

export function EpicWaiting({ epic }: { epic: EpicView }) {
  const { nav } = useStore()
  const refs = epic.WaitingFor ?? []
  if (epic.Status !== 'running' || refs.length === 0) return null
  return (
    <div className="budget-pause deps-wait" title={waitingText(refs)}>
      Ждёт Epic{' '}
      {refs.map((r, i) => (
        <span key={r.id}>
          {i > 0 && ', '}
          <a onClick={() => nav({ view: 'epic', id: r.id })}>«{r.title}»</a>
          {r.status === 'archived' && ' (в архиве, снимите зависимость)'}
        </span>
      ))}
      . Задачи начнут назначаться, когда эти Epic’и завершатся.
    </div>
  )
}

export function EpicWhy({ epic, login, onChanged }: { epic: EpicView; login?: string; onChanged: () => void }) {
  const { nav, projectId, setProjectId } = useStore()
  const [isOwner, setIsOwner] = useState(false)
  const [epics, setEpics] = useState<Epic[]>([])
  const [editing, setEditing] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, run] = useBusy()

  useEffect(() => {
    let live = true
    api.members(epic.ProjectID)
      .then(ms => { if (live) setIsOwner((ms ?? []).some(m => m.login === login && m.role === 'owner')) })
      .catch(() => { if (live) setIsOwner(false) })
    api.epics(epic.ProjectID).then(e => { if (live) setEpics(e ?? []) }).catch(() => {})
    return () => { live = false }
  }, [epic.ProjectID, login])

  // Старый бэкенд не отдаёт DependsOn: правки зависимостей у него нет.
  const supported = epic.DependsOn !== undefined
  const deps = epic.DependsOn ?? []
  const needs: Need[] = epic.Discovery?.needs ?? []
  const closed = epic.Status === 'done' || epic.Status === 'archived'
  // Системные Epic'и («Сопровождение», «Архитектура проекта») в
  // зависимостях не участвуют: редактора у них нет.
  const editable = isOwner && !closed && !isSystemEpic(epic)
  if (!supported) return null
  if (!epic.Discovery && !epic.Priority && deps.length === 0 && !editable) return null
  // Версия исследования — в проекте Epic'а: переключаем проект, если
  // в консоли выбран другой.
  const openRun = (runId: string) => {
    if (projectId !== epic.ProjectID) setProjectId(epic.ProjectID)
    nav({ view: 'discovery', runId })
  }
  // Варианты правки: Epic'и проекта без архивных, без самого Epic'а и без
  // системных, плюс уже выбранные архивные — их видно и можно снять.
  const options = epics.filter(e => e.ID !== epic.ID && !isSystemEpic(e)
    && (e.Status !== 'archived' || (editing ?? []).includes(e.ID)))

  const save = () => run(async () => {
    setErr('')
    try { await api.putEpicDeps(epic.ID, editing ?? []); setEditing(null); onChanged() } catch (e) { setErr(errText(e)) }
  })
  const title = (id: string) => epics.find(e => e.ID === id)?.Title ?? id
  const status = (id: string) => epics.find(e => e.ID === id)?.Status

  return (
    <div className="epic-why">
      {(epic.Discovery || epic.Priority) && (
        <div className="dw-sec">
          <h3>Зачем этот Epic</h3>
          <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            {epic.Priority && <span className={'chip prio-' + epic.Priority}>приоритет <span className="n">{epic.Priority}</span></span>}
            {epic.Discovery && (
              <a onClick={() => openRun(epic.Discovery!.run_id)}>исследование, версия {epic.Discovery.version} →</a>
            )}
          </div>
          {needs.map(n => (
            <div key={n.id} className="need-card">
              <div className="need-top">
                <b>{n.title}</b>
                <span className="chip"><span className="n">{KIND_LABEL[n.kind] ?? n.kind}</span></span>
                <span className={'chip imp-' + n.importance}><span className="n">{IMPORTANCE_LABEL[n.importance] ?? n.importance}</span></span>
              </div>
              {(n.evidence ?? []).map((q, i) => (
                <blockquote key={i} className="quote">
                  <div className="quote-text">«{q.text}»</div>
                  <div className="quote-src">
                    {q.respondent_role || 'респондент'} · интервью «{q.interview_title}», строка {q.line}
                  </div>
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="dw-sec">
        <h3>Зависит от</h3>
        {editing === null
          ? (
            <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {deps.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>зависимостей нет</span>}
              {deps.map(id => (
                <span key={id} className="chip">
                  <a onClick={() => nav({ view: 'epic', id })}>{title(id)}</a>
                  {status(id) && <span className="n">{status(id)}</span>}
                </span>
              ))}
              {editable && <Button size="sm" variant="quiet" onClick={() => setEditing(deps)}>Изменить</Button>}
            </div>
          )
          : (
            <div className="f-form">
              <Field label="Epic’и проекта" hint="задачи этого Epic’а ждут, пока выбранные Epic’и не завершатся" error={err || undefined}>
                {ids => (
                  <Select ids={ids} multiple rows={Math.min(6, Math.max(2, options.length))} value={editing}
                    onChange={e => setEditing([...e.target.selectedOptions].map(o => o.value))}>
                    {options.map(e => (
                      <option key={e.ID} value={e.ID}>{e.Title} · {e.Status === 'archived' ? 'в архиве' : e.Status}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <FormActions note={<FormNote />}>
                <Button variant="quiet" onClick={() => { setEditing(null); setErr('') }}>Отмена</Button>
                <Button variant="primary" busy={busy} onClick={save}>Сохранить</Button>
              </FormActions>
            </div>
          )}
      </div>
    </div>
  )
}
