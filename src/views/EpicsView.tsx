import { useCallback, useEffect, useState } from 'react'
import { api, type Epic } from '../api/client'
import { StBadge } from '../components/ui'
import { Button, Field, FormActions, FormNote, TextArea, TextInput, errText, useBusy } from '../components/form'
import { useStore } from '../store'

export function EpicsView() {
  const { projectId, nav, tick } = useStore()
  const [epics, setEpics] = useState<Epic[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [err, setErr] = useState('')
  const [busy, run] = useBusy()

  const refresh = useCallback(() => {
    if (projectId) api.epics(projectId).then(e => setEpics(e ?? [])).catch(() => {})
  }, [projectId])
  useEffect(refresh, [refresh, tick])

  const create = () => run(async () => {
    if (!projectId) return
    try {
      const e = await api.createEpic(projectId, title, goal)
      setCreating(false); setTitle(''); setGoal(''); setErr('')
      nav({ view: 'epic', id: e.ID })
    } catch (e) { setErr(errText(e)) }
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Epic’и</h1>
        <div className="right"><Button variant="primary" onClick={() => setCreating(true)}>Новый Epic</Button></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Название</th><th>Статус</th><th>Цель</th></tr></thead>
        <tbody>
          {epics.map(e => (
            <tr key={e.ID} className="rowlink" onClick={() => nav({ view: 'epic', id: e.ID })}>
              <td>
                {e.Title}
                {e.SourceKey && (
                  <span className="chip" style={{ marginLeft: 8 }} title={`импортировано: ${e.SourceKey}`}>
                    <span className="n">история · {e.Created.slice(0, 10)}</span>
                  </span>
                )}
              </td>
              <td><StBadge s={e.Status} /></td>
              <td className="muted" style={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.Goal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <div className="modal-wrap" onClick={() => setCreating(false)}>
          <div className="modal f-form" onClick={e => e.stopPropagation()}>
            <h2>Новый Epic</h2>
            <Field label="Название">
              {ids => <TextInput ids={ids} placeholder="Название" autoFocus value={title} onChange={e => setTitle(e.target.value)} />}
            </Field>
            <Field label="Цель" hint="что нужно сделать; текст уйдёт в декомпозицию">
              {ids => <TextArea ids={ids} placeholder="Цель — что нужно сделать (пойдёт в декомпозицию)" rows={5}
                value={goal} onChange={e => setGoal(e.target.value)} />}
            </Field>
            <FormActions note={<FormNote err={err || undefined} />}>
              <Button variant="quiet" onClick={() => setCreating(false)}>Отмена</Button>
              <Button variant="primary" busy={busy} disabled={!title.trim()} onClick={create}>Создать</Button>
            </FormActions>
          </div>
        </div>
      )}
    </div>
  )
}
