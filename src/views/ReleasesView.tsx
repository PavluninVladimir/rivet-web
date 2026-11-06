import { useEffect, useRef, useState } from 'react'
import { api, errCode, type Release } from '../api/client'
import { releaseAfter } from '../components/pagedList'
import { usePaged } from '../components/usePaged'
import { useStore } from '../store'
import { Button, FormNote, errText } from '../components/form'
import { useIsOwner } from '../components/useOwner'
import { Markdown } from '../components/Markdown'
import { fmtDate } from '../components/ui'

// Релизы проекта (add-sdlc-cycle, спека web «Релизы и инциденты в
// консоли»): список от новых к старым, карточка с составом и release
// notes, перегенерация владельцем.

const NOTES: Record<string, string> = { pending: 'пишутся', ready: 'готовы', template: 'по шаблону' }
const KIND: Record<string, string> = { work: 'работа', bug: 'баг', architecture: 'архитектура' }

export function ReleasesView({ id, login }: { id?: string; login: string }) {
  const { projectId, eventTick, nav } = useStore()
  // События перечитывают первую страницу и сливают её со списком: новый
  // релиз не вытесняет строку на границе, «Ещё» не теряется (pagedList).
  const { rows: list, next, err, reload: load, more } = usePaged<Release>(
    projectId ?? '',
    before => projectId ? api.releases(projectId, { limit: 50, before })
      .then(r => ({ rows: r.releases ?? [], next: r.next || null })) : null,
    releaseAfter, eventTick)
  return (
    <div className="page">
      <div className="page-head"><h1>Релизы</h1></div>
      {err && <FormNote err={err} />}
      <div className={'split' + (id ? ' with-detail' : '')}>
        <div className="panel">
          {list.length === 0 && <div className="muted" style={{ padding: 12 }}>Релизов пока нет: они появляются после успешной публикации.</div>}
          <table className="tbl">
            <tbody>
              {list.map(r => (
                <tr key={r.id} className={'rowlink' + (r.id === id ? ' sel' : '')} tabIndex={0} aria-selected={r.id === id}
                  onClick={() => nav({ view: 'releases', id: r.id })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav({ view: 'releases', id: r.id }) } }}>
                  <td><b>{r.env_name}</b></td>
                  <td className="mono" title={r.version}>{r.version.slice(0, 12)}</td>
                  <td className="muted">{fmtDate(r.created_at)}</td>
                  <td className="mono">{r.composition.length} задач{r.composition_by_time ? ' ·≈' : ''}</td>
                  <td><span className={'chip sm notes-' + r.notes_status}>{NOTES[r.notes_status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {next && <div style={{ padding: 8 }}><Button size="sm" onClick={more}>Ещё</Button></div>}
        </div>
        {id && <ReleaseCard key={id} id={id} login={login} onChanged={load} />}
      </div>
    </div>
  )
}

function ReleaseCard({ id, login, onChanged }: { id: string; login: string; onChanged: () => void }) {
  const { eventTick, nav, projectId } = useStore()
  const [r, setR] = useState<Release | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Перечитывание по событиям: применяется только последний ответ.
  const seq = useRef(0)
  useEffect(() => {
    const n = ++seq.current
    api.release(id)
      .then(v => { if (n === seq.current) { setR(v); setErr('') } })
      .catch(e => { if (n === seq.current) setErr(errText(e)) })
  }, [id, eventTick])
  const owner = useIsOwner(r?.project_id ?? null, login)
  // Релиз другого проекта по адресу этого: адрес исправляется на проект
  // релиза без записи в истории (спека web «Проект в адресе экранов проекта»).
  useEffect(() => {
    if (r?.id === id && r.project_id && projectId && r.project_id !== projectId) {
      nav({ view: 'releases', pid: r.project_id, id }, { replace: true })
    }
  }, [r, id, projectId, nav])
  const regen = async () => {
    setBusy(true); setErr('')
    try { setR(await api.regenerateNotes(id)); onChanged() }
    catch (e) { setErr(errCode(e) === 'notes_pending' ? 'release notes уже пишутся' : errText(e)) }
    finally { setBusy(false) }
  }
  if (!r) return <div className="panel detail">{err ? <FormNote err={err} /> : <span className="muted">Загрузка…</span>}</div>
  return (
    <div className="panel detail release-card">
      <div className="dw-sec">
        <h3>Релиз {r.env_name} · <span className="mono">{r.version.slice(0, 12)}</span></h3>
        <div className="muted">
          {fmtDate(r.created_at)} · инициатор {r.initiator}
          {r.composition_by_time && ' · состав по времени merge (публикацию запустил человек)'}
          {r.prev_version ? <> · прошлая версия <span className="mono">{r.prev_version.slice(0, 12)}</span></> : ' · первый релиз окружения'}
        </div>
      </div>
      <div className="dw-sec">
        <h3>Состав</h3>
        {r.composition.length === 0 && <div className="muted">Задач в составе нет.</div>}
        <ul className="cp-items">
          {r.composition.map(t => (
            <li key={t.task_id}>
              <button className="cp-item" onClick={() => nav({ view: 'epic', id: t.epic_id, taskId: t.task_id })}>
                <span className="mono">task-{t.num}</span>
                <span className="cp-title">{t.title}</span>
                <span className={'chip sm' + (t.kind === 'bug' ? ' badge-bug' : '')}>{KIND[t.kind] ?? t.kind}</span>
                <span className="muted">{t.epic_title}</span>
              </button>
              {t.incident_id && <a className="cp-sub" onClick={() => nav({ view: 'incidents', id: t.incident_id! })}>закрывает инцидент →</a>}
            </li>
          ))}
        </ul>
      </div>
      <div className="dw-sec">
        <h3>
          Release notes <span className={'chip sm notes-' + r.notes_status}>{NOTES[r.notes_status]}</span>
          {r.notes_agent && <span className="muted"> · {r.notes_agent.name}</span>}
          {r.dropped_items > 0 && <span className="muted"> · отброшено пунктов: {r.dropped_items}</span>}
        </h3>
        {r.notes_status === 'pending' && !r.notes_md ? <div className="muted">Релиз-инженер пишет release notes…</div>
          : <Markdown text={r.notes_md ?? ''} />}
        {owner && (
          <div className="dw-actions" style={{ marginTop: 8 }}>
            <Button size="sm" busy={busy} disabled={r.notes_status === 'pending'} onClick={regen}>Перегенерировать</Button>
          </div>
        )}
        {err && <FormNote err={err} />}
      </div>
    </div>
  )
}
