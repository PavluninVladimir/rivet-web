import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, defaultProcess, type Member, type ProcessDoc, type ProcessLocks, type Runner } from '../api/client'
import { ProcessGraph } from './ProcessGraph'
import type { StepError as EditorError } from './StepModal'
import { shortHash } from './PolicyPanel'
import { Button, Checkbox, NumberInput, useBusy } from './form'

// Секция «Процесс» (add-process-editor, add-process-graph-editor): в
// настройках проекта — процесс проекта или унаследованный графом,
// редактирование владельцем; на вкладке «Политики» установки — процесс
// по умолчанию и ограничения.

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
  const [members, setMembers] = useState<Member[]>([])
  const [err, setErr] = useState<EditorError | null>(null)
  const [note, setNote] = useState('')
  const [busy, run] = useBusy()
  // dirty в ref: фоновый refresh читает актуальное значение, не перезапускаясь
  // на каждую правку; seq отсекает запоздавшие ответы после сохранения.
  const dirtyRef = useRef(false)
  const seq = useRef(0)
  const markDirty = (v: boolean) => { dirtyRef.current = v; setDirty(v) }

  const refresh = useCallback(() => {
    const my = ++seq.current
    api.projectPolicy(projectId).then(p => {
      if (my !== seq.current) return
      // Без документа в политике действует процесс по умолчанию; при
      // выключенном tester_agent сервер снимает в нём тестировщика, редактор
      // показывает то же (иначе сохранение сделало бы роль явной).
      const eff = p.effective.process ?? defaultProcess(p.effective.tester_agent)
      setEffective(eff)
      setSource(p.process_source ?? (p.overrides.process ? 'project' : 'installation'))
      setHash(p.effective_hash)
      setFromGit(p.source?.kind === 'git')
      setDoc(cur => (cur && dirtyRef.current) ? cur : structuredClone(eff))
    }).catch(e => { if (my === seq.current) setErr(parseError(e)) })
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
    api.members(projectId).then(m => setMembers(m ?? [])).catch(() => {})
  }, [projectId])
  useEffect(refresh, [refresh, tick])

  if (!doc) return <div className="dw-sec"><h3>Процесс</h3><div className="muted">загрузка…</div></div>
  const editable = isOwner && !fromGit
  const applySaved = (r: { effective: { process?: ProcessDoc | null; tester_agent?: boolean }; process_source?: 'project' | 'installation'; effective_hash: string }, src: 'project' | 'installation') => {
    seq.current++ // ответы refresh, начатых до сохранения, больше не нужны
    const eff = r.effective.process ?? defaultProcess(r.effective.tester_agent)
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
      {err && !err.step && <div className="err f-error" role="alert">{err.message}</div>}
      <ProcessGraph doc={doc} runners={runners} members={members} readOnly={!editable} error={err}
        onChange={d => { setDoc(d); markDirty(true); setErr(null) }} />
      {editable && (
        <div className="proc-row" style={{ marginTop: 8 }}>
          <Button variant="primary" size="sm" busy={busy} disabled={!dirty} onClick={() => run(save)}>Сохранить процесс</Button>
          {source === 'project' && <Button size="sm" busy={busy} onClick={() => run(reset)}>Вернуться к процессу установки</Button>}
          {dirty && effective && <Button size="sm" variant="quiet" onClick={() => { setDoc(structuredClone(effective)); markDirty(false); setErr(null) }}>Отменить правки</Button>}
        </div>
      )}
    </div>
  )
}

// Правка графа и правка ограничений приходят родителю разными колбэками:
// ограничения не должны делать показанный процесс по умолчанию явным
// (см. withLocks). explicit — процесс установки задан явно: тогда можно
// вернуться к встроенному, на котором действует tester_agent.
export function InstallationProcessSection({ doc, locks, readOnly, explicit, onProcessChange, onLocksChange, onResetProcess }: {
  doc: ProcessDoc
  locks: ProcessLocks
  readOnly?: boolean
  explicit?: boolean
  onProcessChange: (doc: ProcessDoc) => void
  onLocksChange: (locks: ProcessLocks) => void
  onResetProcess?: () => void
}) {
  const [runners, setRunners] = useState<Runner[]>([])
  useEffect(() => { api.runners().then(r => setRunners(r ?? [])).catch(() => {}) }, [])
  const kinds = ['code', 'test', 'review', 'prompt']
  const required = new Set(locks.required_kinds ?? [])
  const toggleRequired = (k: string, on: boolean) => {
    const next = new Set(required)
    if (on) next.add(k); else next.delete(k)
    onLocksChange({ ...locks, required_kinds: Array.from(next) })
  }
  return (
    <div className="dw-sec proc-section">
      <h3>Процесс по умолчанию</h3>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
        Действует для проектов без собственного процесса.
        {explicit ? ' Процесс установки задан явно.' : ' Сейчас это встроенный процесс.'}
      </div>
      <ProcessGraph doc={doc} runners={runners} locks={locks} readOnly={readOnly} onChange={onProcessChange} />
      {explicit && !readOnly && onResetProcess && (
        <div className="proc-row" style={{ marginTop: 8 }}>
          <Button size="sm" onClick={onResetProcess}
            title="снять явный процесс: снова действует встроенный, к нему применяется выключение тестировщика">
            Вернуться к встроенному процессу
          </Button>
        </div>
      )}
      <h3 style={{ marginTop: 12 }}>Ограничения на процессы проектов</h3>
      <div className="proc-row proc-opts">
        <span className="muted">обязательные шаги:</span>
        {kinds.map(k => (
          <Checkbox key={k} disabled={readOnly} checked={required.has(k)} label={k} onChange={on => toggleRequired(k, on)} />
        ))}
      </div>
      <div className="proc-row proc-opts">
        <Checkbox disabled={readOnly} checked={!!locks.human_review} label="человек на review обязателен"
          onChange={on => onLocksChange({ ...locks, human_review: on })} />
        <label>минимум участников на review
          <NumberInput min={1} width={56} disabled={readOnly} value={locks.min_participants?.review ?? ''}
            onChange={e => {
              const mp = { ...(locks.min_participants ?? {}) }
              if (e.target.value) mp.review = Number(e.target.value); else delete mp.review
              onLocksChange({ ...locks, min_participants: mp })
            }} />
        </label>
      </div>
    </div>
  )
}
