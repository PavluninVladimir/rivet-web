import { useMemo, useState } from 'react'
import type { ProcessDoc, ProcessStep, Participant, Runner } from '../api/client'

// Редактор процесса (add-process-editor, спека clients/web «Редактор
// процесса»): шаги карточками по порядку, участники строками, переходы
// списками. Состояние локальное, документ отдаётся наверх на сохранение.

const KINDS: { kind: ProcessStep['kind']; label: string }[] = [
  { kind: 'code', label: 'code · реализация' },
  { kind: 'test', label: 'test · проверки' },
  { kind: 'review', label: 'review · ревью' },
  { kind: 'prompt', label: 'prompt · задание агенту' },
  { kind: 'merge', label: 'merge' },
  { kind: 'deploy', label: 'deploy · публикация' },
]

const HAS_PARTICIPANTS = new Set(['code', 'test', 'review', 'prompt'])

export interface EditorError { step?: string; field?: string; message: string }

export function ProcessEditor({ doc, runners, readOnly, error, onChange }: {
  doc: ProcessDoc
  runners: Runner[]
  readOnly?: boolean
  error?: EditorError | null
  onChange: (doc: ProcessDoc) => void
}) {
  const [addKind, setAddKind] = useState<ProcessStep['kind']>('review')
  const agentKinds = useMemo(() => Array.from(new Set(runners.map(r => r.Agent).filter(Boolean))).sort(), [runners])
  const modelsFor = (kind: string) => Array.from(new Set(runners
    .filter(r => !kind || r.Agent === kind)
    .flatMap(r => r.Models ?? []))).sort()
  const targets = ['', ...doc.steps.filter(s => s.enabled !== false).map(s => s.id), 'escalate', 'done']

  const update = (i: number, patch: Partial<ProcessStep>) =>
    onChange({ steps: doc.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= doc.steps.length) return
    const steps = doc.steps.slice()
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    onChange({ steps })
  }
  const remove = (i: number) => onChange({ steps: doc.steps.filter((_, j) => j !== i) })
  const add = () => {
    const base = addKind
    let id: string = base
    for (let n = 2; doc.steps.some(s => s.id === id); n++) id = `${base}-${n}`
    const step: ProcessStep = { id, kind: base }
    if (HAS_PARTICIPANTS.has(base)) step.participants = [{ agent: {} }]
    if (base === 'prompt') step.prompt = ''
    onChange({ steps: [...doc.steps, step] })
  }
  const setParticipant = (i: number, k: number, p: Participant) =>
    update(i, { participants: (doc.steps[i].participants ?? []).map((x, j) => (j === k ? p : x)) })
  return (
    <div className="proc-editor">
      {error && !error.step && <div className="err">{error.message}</div>}
      {doc.steps.map((s, i) => {
        const disabled = readOnly
        const off = s.enabled === false
        const on = s.on ?? {}
        return (
          <div key={i} className={'proc-step' + (off ? ' off' : '') + (error?.step === s.id ? ' has-err' : '')} data-step={s.id}>
            <div className="proc-head">
              <span className="mono muted">{i + 1}</span>
              <input className="proc-id" value={s.id} disabled={disabled} title="идентификатор шага"
                onChange={e => update(i, { id: e.target.value })} />
              <select value={s.kind} disabled={disabled} onChange={e => {
                const kind = e.target.value as ProcessStep['kind']
                const patch: Partial<ProcessStep> = { kind }
                if (!HAS_PARTICIPANTS.has(kind)) patch.participants = undefined
                else if (!s.participants?.length) patch.participants = [{ agent: {} }]
                if (kind !== 'prompt') patch.prompt = undefined
                update(i, patch)
              }}>
                {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <input className="proc-title" placeholder="название" value={s.title ?? ''} disabled={disabled}
                onChange={e => update(i, { title: e.target.value })} />
              <label className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                <input type="checkbox" checked={!off} disabled={disabled} onChange={e => update(i, { enabled: e.target.checked ? undefined : false })} /> включён
              </label>
              {!disabled && <>
                <button className="btn sm" title="выше" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn sm" title="ниже" onClick={() => move(i, 1)} disabled={i === doc.steps.length - 1}>↓</button>
                <button className="btn sm" title="удалить" onClick={() => remove(i)}>✕</button>
              </>}
            </div>
            {error?.step === s.id && <div className="err">{error.field ? `${error.field}: ` : ''}{error.message}</div>}

            {s.kind === 'prompt' && (
              <div className="proc-row">
                <textarea className="step-text" placeholder="Задание агенту. Пусть закончит строкой VERDICT: OK | CHANGES: … | FAIL: …"
                  value={s.prompt ?? ''} disabled={disabled} onChange={e => update(i, { prompt: e.target.value })} />
              </div>
            )}

            {HAS_PARTICIPANTS.has(s.kind) && (
              <div className="proc-participants">
                <div className="muted" style={{ fontSize: 11.5 }}>участники</div>
                {(s.participants ?? []).map((p, k) => {
                  const isUser = !!p.user
                  return (
                    <div key={k} className="proc-participant">
                      <span className="mono muted">p{k + 1}</span>
                      <select value={isUser ? 'user' : 'agent'} disabled={disabled}
                        onChange={e => setParticipant(i, k, e.target.value === 'user' ? { user: { role: 'owner' } } : { agent: {} })}>
                        <option value="agent">агент</option>
                        <option value="user">человек</option>
                      </select>
                      {!isUser && <>
                        <input list={`agent-kinds-${s.id}`} placeholder="любой агент" value={p.agent?.kind ?? ''} disabled={disabled}
                          onChange={e => setParticipant(i, k, { agent: { ...p.agent, kind: e.target.value || undefined } })} />
                        <datalist id={`agent-kinds-${s.id}`}>{agentKinds.map(a => <option key={a} value={a} />)}</datalist>
                        <input list={`models-${s.id}-${k}`} placeholder="любая модель" value={p.agent?.model ?? ''} disabled={disabled}
                          onChange={e => setParticipant(i, k, { agent: { ...p.agent, model: e.target.value || undefined } })} />
                        <datalist id={`models-${s.id}-${k}`}>{modelsFor(p.agent?.kind ?? '').map(m => <option key={m} value={m} />)}</datalist>
                      </>}
                      {isUser && <>
                        <select value={p.user?.login !== undefined ? 'login' : 'role'} disabled={disabled}
                          onChange={e => setParticipant(i, k, e.target.value === 'login' ? { user: { login: '' } } : { user: { role: 'owner' } })}>
                          <option value="role">по роли</option>
                          <option value="login">по логину</option>
                        </select>
                        {p.user?.login !== undefined
                          ? <input placeholder="логин участника" value={p.user.login} disabled={disabled}
                              onChange={e => setParticipant(i, k, { user: { login: e.target.value } })} />
                          : <select value={p.user?.role ?? 'owner'} disabled={disabled}
                              onChange={e => setParticipant(i, k, { user: { role: e.target.value } })}>
                              <option value="owner">owner</option>
                              <option value="member">member</option>
                            </select>}
                      </>}
                      {!disabled && <button className="btn sm" onClick={() => update(i, { participants: (s.participants ?? []).filter((_, j) => j !== k) })}>✕</button>}
                    </div>
                  )
                })}
                {!disabled && <button className="btn sm" onClick={() => update(i, { participants: [...(s.participants ?? []), { agent: {} }] })}>+ участник</button>}
              </div>
            )}

            {HAS_PARTICIPANTS.has(s.kind) && (
              <div className="proc-row proc-opts">
                <label>режим
                  <select value={s.mode ?? 'parallel'} disabled={disabled} onChange={e => update(i, { mode: e.target.value as ProcessStep['mode'] })}>
                    <option value="parallel">parallel</option>
                    <option value="sequential">sequential</option>
                  </select>
                </label>
                <label>правило
                  <select value={s.require ?? 'all'} disabled={disabled} onChange={e => update(i, { require: e.target.value as ProcessStep['require'] })}>
                    <option value="all">все</option>
                    <option value="any">любой</option>
                  </select>
                </label>
                <label>проходов
                  <input type="number" min={1} style={{ width: 56 }} value={s.attempts ?? ''} placeholder="по пресету" disabled={disabled}
                    onChange={e => update(i, { attempts: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </div>
            )}

            <div className="proc-row proc-opts">
              <label>ok →
                <select value={on.ok ?? ''} disabled={disabled} onChange={e => update(i, { on: { ...on, ok: e.target.value || undefined } })}>
                  {targets.map(t => <option key={t} value={t}>{t || 'следующий'}</option>)}
                </select>
              </label>
              {HAS_PARTICIPANTS.has(s.kind) && <>
                <label>changes →
                  <select value={on.changes ?? ''} disabled={disabled} onChange={e => update(i, { on: { ...on, changes: e.target.value || undefined } })}>
                    {targets.map(t => <option key={t} value={t}>{t || 'ближайший code'}</option>)}
                  </select>
                </label>
                <label>fail →
                  <select value={on.fail ?? ''} disabled={disabled} onChange={e => update(i, { on: { ...on, fail: e.target.value || undefined } })}>
                    {targets.map(t => <option key={t} value={t}>{t || 'escalate'}</option>)}
                  </select>
                </label>
              </>}
            </div>
          </div>
        )
      })}
      {!readOnly && (
        <div className="proc-row" style={{ marginTop: 6 }}>
          <select value={addKind} onChange={e => setAddKind(e.target.value as ProcessStep['kind'])}>
            {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <button className="btn sm" onClick={add}>+ шаг</button>
        </div>
      )}
    </div>
  )
}
