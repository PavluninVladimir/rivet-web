import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, DEFAULT_PROCESS, type ProcessDoc, type ProcessLocks, type Runner } from '../api/client'
import { ProcessEditor, type EditorError } from './ProcessEditor'
import { shortHash } from './PolicyPanel'

// Секция «Процесс» (add-process-editor): в настройках проекта — процесс
// проекта или унаследованный, редактирование владельцем; на вкладке
// «Политики» установки — процесс по умолчанию и ограничения.

function parseError(e: unknown): EditorError {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof ApiError) {
    const d = e.data as { step?: string; field?: string } | null
    return { step: d?.step || undefined, field: d?.field || undefined, message: msg }
  }
  return { message: msg }
}

export function ProjectProcessSection({ projectId, isOwner, tick }: { projectId: string; isOwner: boolean; tick: number }) {
  const [effective, setEffective] = useState<ProcessDoc | null>(null)
  const [source, setSource] = useState<'project' | 'installation'>('installation')
  const [hash, setHash] = useState('')
  const [fromGit, setFromGit] = useState(false)
  const [doc, setDoc] = useState<ProcessDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [runners, setRunners] = useState<Runner[]>([])
  const [err, setErr] = useState<EditorError | null>(null)
  const [note, setNote] = useState('')
  // dirty в ref: фоновый refresh читает актуальное значение, не перезапускаясь
  // на каждую правку; seq отсекает запоздавшие ответы после сохранения.
  const dirtyRef = useRef(false)
  const seq = useRef(0)
  const markDirty = (v: boolean) => { dirtyRef.current = v; setDirty(v) }

  const refresh = useCallback(() => {
    const my = ++seq.current
    api.projectPolicy(projectId).then(p => {
      if (my !== seq.current) return
      // Без документа в политике действует процесс по умолчанию.
      const eff = p.effective.process ?? DEFAULT_PROCESS
      setEffective(eff)
      setSource(p.process_source ?? (p.overrides.process ? 'project' : 'installation'))
      setHash(p.effective_hash)
      setFromGit(p.source?.kind === 'git')
      setDoc(cur => (cur && dirtyRef.current) ? cur : structuredClone(eff))
    }).catch(e => { if (my === seq.current) setErr(parseError(e)) })
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [projectId])
  useEffect(refresh, [refresh, tick])

  if (!doc) return <div className="dw-sec"><h3>Процесс</h3><div className="muted">загрузка…</div></div>
  const editable = isOwner && !fromGit
  const applySaved = (r: { effective: { process?: ProcessDoc | null }; process_source?: 'project' | 'installation'; effective_hash: string }, src: 'project' | 'installation') => {
    seq.current++ // ответы refresh, начатых до сохранения, больше не нужны
    const eff = r.effective.process ?? DEFAULT_PROCESS
    markDirty(false)
    setEffective(eff)
    setSource(r.process_source ?? src)
    setHash(r.effective_hash)
    setDoc(structuredClone(eff))
  }
  const save = async () => {
    setErr(null); setNote('')
    try {
      const r = await api.putProjectPolicy(projectId, { process: doc })
      applySaved(r, 'project')
      setNote(`сохранена версия проекта ${r.version?.version} (${shortHash(r.version?.hash)})`)
    } catch (e) { setErr(parseError(e)) }
  }
  const reset = async () => {
    setErr(null); setNote('')
    try {
      const r = await api.putProjectPolicy(projectId, { process: null })
      applySaved(r, 'installation')
      setNote('процесс проекта снят, действует процесс установки')
    } catch (e) { setErr(parseError(e)) }
  }
  return (
    <div className="dw-sec proc-section">
      <h3>Процесс</h3>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
        {source === 'project' ? 'процесс проекта' : 'наследуется от установки'} · действующая политика <span className="mono">{shortHash(hash)}</span>
        {fromGit && ' · политика из репозитория, только чтение'}
        {!isOwner && ' · только просмотр'}
      </div>
      {note && <div className="note">{note}</div>}
      <ProcessEditor doc={doc} runners={runners} readOnly={!editable} error={err}
        onChange={d => { setDoc(d); markDirty(true) }} />
      {editable && (
        <div className="proc-row" style={{ marginTop: 8 }}>
          <button className="btn primary sm" disabled={!dirty} onClick={save}>Сохранить процесс</button>
          {source === 'project' && <button className="btn sm" onClick={reset}>Вернуться к процессу установки</button>}
          {dirty && effective && <button className="btn sm" onClick={() => { setDoc(structuredClone(effective)); markDirty(false); setErr(null) }}>Отменить правки</button>}
        </div>
      )}
    </div>
  )
}

export function InstallationProcessSection({ doc, locks, readOnly, onChange }: {
  doc: ProcessDoc
  locks: ProcessLocks
  readOnly?: boolean
  onChange: (doc: ProcessDoc, locks: ProcessLocks) => void
}) {
  const [runners, setRunners] = useState<Runner[]>([])
  useEffect(() => { api.runners().then(r => setRunners(r ?? [])).catch(() => {}) }, [])
  const kinds = ['code', 'test', 'review', 'prompt']
  const required = new Set(locks.required_kinds ?? [])
  // Ограничения без пустых ключей: снятое ограничение исчезает из объекта,
  // и пустой объект превращается в null у родителя.
  const emit = (l: ProcessLocks) => {
    const clean: ProcessLocks = {}
    if (l.required_kinds?.length) clean.required_kinds = l.required_kinds
    if (l.min_participants && Object.keys(l.min_participants).length) clean.min_participants = l.min_participants
    if (l.human_review) clean.human_review = true
    onChange(doc, clean)
  }
  const toggleRequired = (k: string, on: boolean) => {
    const next = new Set(required)
    if (on) next.add(k); else next.delete(k)
    emit({ ...locks, required_kinds: Array.from(next) })
  }
  return (
    <div className="dw-sec proc-section">
      <h3>Процесс по умолчанию</h3>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
        Действует для проектов без собственного процесса.
      </div>
      <ProcessEditor doc={doc} runners={runners} readOnly={readOnly} onChange={d => onChange(d, locks)} />
      <h3 style={{ marginTop: 12 }}>Ограничения на процессы проектов</h3>
      <div className="proc-row proc-opts">
        <span className="muted">обязательные шаги:</span>
        {kinds.map(k => (
          <label key={k}><input type="checkbox" disabled={readOnly} checked={required.has(k)} onChange={e => toggleRequired(k, e.target.checked)} /> {k}</label>
        ))}
      </div>
      <div className="proc-row proc-opts">
        <label><input type="checkbox" disabled={readOnly} checked={!!locks.human_review}
          onChange={e => emit({ ...locks, human_review: e.target.checked })} /> человек на review обязателен</label>
        <label>минимум участников на review
          <input type="number" min={1} style={{ width: 56 }} disabled={readOnly} value={locks.min_participants?.review ?? ''}
            onChange={e => {
              const mp = { ...(locks.min_participants ?? {}) }
              if (e.target.value) mp.review = Number(e.target.value); else delete mp.review
              emit({ ...locks, min_participants: mp })
            }} />
        </label>
      </div>
    </div>
  )
}
