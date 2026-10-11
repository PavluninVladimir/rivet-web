import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type AgentCatalog, type Member, type Participant, type ProcessDoc, type ProcessStep, type Runner } from '../api/client'
import { Button, Checkbox, Combo, Field, FormActions, FormNote, NumberInput, Select, TextArea, TextInput } from './form'
import { HAS_PARTICIPANTS, KIND_LABEL, OUTCOMES, defaultTarget, newStepId, type Outcome } from './processLayout'

// Модальные окна графа процесса (add-process-graph-editor, design решения
// 4 и 5): окно шага со всеми полями и окно одного перехода. Правки
// применяются по «Готово», Escape отменяет и возвращает фокус.

export interface StepError { step?: string; field?: string; message: string }

const KINDS: ProcessStep['kind'][] = ['code', 'test', 'review', 'prompt', 'merge', 'deploy']
const OUTCOME_LABEL: Record<Outcome, string> = { ok: 'ok', changes: 'changes', fail: 'fail' }

// Обёртка окна у правого края: граф слева остаётся виден.
const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SideModal({ title, titleId, onClose, children }: { title: ReactNode; titleId: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Фокус внутрь окна и по кругу: Tab не уходит на граф и страницу за ним.
    const el = box.current
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-wrap side" onClick={onClose}>
      <div className="modal side f-form" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="quiet" size="sm" aria-label="закрыть" onClick={onClose}>✕</Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function targetOptions(doc: ProcessDoc, self: string, outcome: Outcome) {
  const def = defaultTarget(doc, self, outcome)
  const opts: { v: string; label: string }[] = [{ v: '', label: `${def === 'done' ? 'готово' : def === 'escalate' ? 'эскалация' : def} (по умолчанию)` }]
  for (const s of doc.steps) if (s.enabled !== false) opts.push({ v: s.id, label: s.id })
  opts.push({ v: 'escalate', label: 'эскалация' }, { v: 'done', label: 'готово' })
  return opts
}

export function StepModal({ doc, index, isNew, at, runners, members, readOnly, error, onApply, onInsert, onDelete, onMove, onClose }: {
  doc: ProcessDoc
  index: number             // индекс шага; у нового — -1
  isNew?: boolean
  at?: number               // куда вставить новый шаг
  runners: Runner[]
  members?: Member[]
  readOnly?: boolean
  error?: StepError | null
  onApply: (index: number, step: ProcessStep) => void
  onInsert: (at: number, step: ProcessStep) => void
  onDelete: (index: number) => void
  onMove: (index: number, dir: -1 | 1) => void
  onClose: () => void
}) {
  const source = isNew ? undefined : doc.steps[index]
  const [draft, setDraft] = useState<ProcessStep>(() => source
    ? structuredClone(source)
    : { id: newStepId(doc, 'review'), kind: 'review', participants: [{ agent: {} }] })

  // Каталог агентов (add-agent-profiles): профили и агенты вне каталога,
  // объявленные runner'ами; модели у профиля — его привязки.
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  // Свободный ввод агента вне списков (runner ещё не зарегистрирован).
  const [customKind, setCustomKind] = useState<Record<number, boolean>>({})
  useEffect(() => { api.agents().then(setCatalog).catch(() => setCatalog({ agents: [], external: [] })) }, [])
  const profiles = (catalog?.agents ?? []).filter(a => a.enabled)
  const externalKinds = Array.from(new Set([...(catalog?.external ?? []).map(e => e.id), ...runners.map(r => r.Agent).filter(k => k && !profiles.some(a => a.id === k))])).sort()
  const profileOf = (kind?: string) => profiles.find(a => a.id === kind)
  const modelsFor = (kind?: string) => {
    const prof = profileOf(kind)
    if (prof && prof.models.length > 0) return Array.from(new Set(prof.models.filter(m => !m.unavailable).map(m => m.model)))
    return Array.from(new Set(runners.filter(r => !kind || r.Agent === kind).flatMap(r => r.Models ?? []))).sort()
  }
  const logins = useMemo(() => (members ?? []).map(m => m.login).sort(), [members])

  const patch = (p: Partial<ProcessStep>) => setDraft(d => ({ ...d, ...p }))
  const setKind = (kind: ProcessStep['kind']) => {
    const p: Partial<ProcessStep> = { kind }
    if (!HAS_PARTICIPANTS.has(kind)) { p.participants = undefined; p.on = draft.on?.ok ? { ok: draft.on.ok } : undefined }
    else if (!draft.participants?.length) p.participants = [{ agent: {} }]
    if (kind !== 'prompt') p.prompt = undefined
    if (isNew) p.id = newStepId(doc, kind)
    patch(p)
  }
  const parts = draft.participants ?? []
  const setPart = (k: number, p: Participant) => patch({ participants: parts.map((x, j) => (j === k ? p : x)) })
  const withParts = HAS_PARTICIPANTS.has(draft.kind)
  const off = draft.enabled === false

  // Ошибка сервера у поля: field вида on.changes, participants[1].login, prompt.
  const mine = error && !isNew && error.step === source?.id ? error : null
  const matches = (name: string) => !!mine?.field && (mine.field === name || mine.field.startsWith(name + '.') || mine.field.startsWith(name + '['))
  const fe = (name: string) => (matches(name) ? mine!.message : undefined)
  // Ошибка без поля или с полем вне формы (например, locks) — заметкой вверху.
  const FIELDS = ['id', 'kind', 'title', 'prompt', 'capabilities', 'mode', 'require', 'attempts', 'participants', 'on']
  const topErr = mine && !FIELDS.some(matches) ? mine.message : undefined
  const idTrim = draft.id.trim()
  const idErr = !idTrim ? 'Укажите идентификатор' : (doc.steps.some((s, i) => s.id === idTrim && i !== index) ? 'Такой идентификатор уже есть' : fe('id'))
  const canApply = !readOnly && !idErr && (draft.kind !== 'prompt' || !!draft.prompt?.trim())

  const apply = () => {
    if (!canApply) return
    const clean: ProcessStep = { ...draft, id: draft.id.trim(), title: draft.title?.trim() || undefined }
    if (clean.on) {
      const on = Object.fromEntries(Object.entries(clean.on).filter(([, v]) => v)) as ProcessStep['on']
      clean.on = on && Object.keys(on).length ? on : undefined
    }
    if (isNew) onInsert(at ?? doc.steps.length, clean); else onApply(index, clean)
    onClose()
  }
  const titleId = 'step-modal-title'
  const heading = isNew ? 'Новый шаг' : <>Шаг <span className="mono">{source?.id}</span></>

  return (
    <SideModal title={heading} titleId={titleId} onClose={onClose}>
      {topErr && <FormNote err={topErr} />}
      <div className="f-grid">
        <Field label="Тип">
          {ids => <Select ids={ids} value={draft.kind} disabled={readOnly} onChange={e => setKind(e.target.value as ProcessStep['kind'])}>
            {KINDS.map(k => <option key={k} value={k}>{k} · {KIND_LABEL[k]}</option>)}
          </Select>}
        </Field>
        <Field label="Идентификатор" error={idErr} hint="латиница, цифры, дефис">
          {ids => <TextInput ids={ids} mono value={draft.id} disabled={readOnly} onChange={e => patch({ id: e.target.value })} />}
        </Field>
      </div>
      <Field label="Название" optional error={fe('title')}>
        {ids => <TextInput ids={ids} autoFocus placeholder="название" value={draft.title ?? ''} disabled={readOnly}
          onChange={e => patch({ title: e.target.value })} />}
      </Field>
      {draft.kind === 'prompt' && (
        <Field label="Задание агенту" hint="пусть закончит строкой VERDICT: OK | CHANGES: … | FAIL: …" error={fe('prompt') ?? (draft.prompt?.trim() ? undefined : 'Текст задания обязателен')}>
          {ids => <TextArea ids={ids} className="step-text" placeholder="Задание агенту" value={draft.prompt ?? ''} disabled={readOnly}
            onChange={e => patch({ prompt: e.target.value })} />}
        </Field>
      )}

      {withParts && (
        <Field label="Участники" error={fe('participants')}>
          {() => <div className="f-form" style={{ gap: 6 }} data-participants>
            {parts.map((p, k) => {
              const isUser = !!p.user
              return (
                <div key={k} className="proc-participant" data-participant={k}>
                  <span className="mono muted">p{k + 1}</span>
                  <Select size="sm" aria-label="тип участника" value={isUser ? 'user' : 'agent'} disabled={readOnly}
                    onChange={e => setPart(k, e.target.value === 'user' ? { user: { role: 'owner' } } : { agent: {} })}>
                    <option value="agent">агент</option>
                    <option value="user">человек</option>
                  </Select>
                  {!isUser && <>
                    {customKind[k] || (p.agent?.kind && !profiles.some(a => a.id === p.agent?.kind) && !externalKinds.includes(p.agent.kind))
                      ? <Combo className="f-sm" aria-label="агент" options={[...profiles.map(a => a.id), ...externalKinds]} placeholder="идентификатор агента" value={p.agent?.kind ?? ''} disabled={readOnly}
                          aria-invalid={fe(`participants[${k}].agent.kind`) ? true : undefined}
                          onChange={e => setPart(k, { agent: { ...p.agent, kind: e.target.value || undefined } })} />
                      : <Select size="sm" aria-label="агент" value={p.agent?.kind ?? ''} disabled={readOnly}
                          aria-invalid={fe(`participants[${k}].agent.kind`) ? true : undefined}
                          onChange={e => {
                            // Смена агента сбрасывает модель: у нового её может не быть.
                            if (e.target.value === '__custom') { setCustomKind(c => ({ ...c, [k]: true })); setPart(k, { agent: {} }); return }
                            setPart(k, { agent: { kind: e.target.value || undefined } })
                          }}>
                          <option value="">любой агент</option>
                          {profiles.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                          {externalKinds.length > 0 && <optgroup label="вне каталога">
                            {externalKinds.map(k2 => <option key={k2} value={k2}>{k2}</option>)}
                          </optgroup>}
                          <option value="__custom">другой агент…</option>
                        </Select>}
                    {profileOf(p.agent?.kind)?.models.length
                      ? <Select size="sm" aria-label="модель" value={p.agent?.model ?? ''} disabled={readOnly}
                          aria-invalid={fe(`participants[${k}].agent.model`) ? true : undefined}
                          onChange={e => setPart(k, { agent: { ...p.agent, model: e.target.value || undefined } })}>
                          <option value="">по умолчанию{profileOf(p.agent?.kind)?.default_model ? ` (${profileOf(p.agent?.kind)!.default_model!.model})` : ''}</option>
                          {modelsFor(p.agent?.kind).map(m => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      : <Combo className="f-sm" aria-label="модель" options={modelsFor(p.agent?.kind)} placeholder="любая модель" value={p.agent?.model ?? ''} disabled={readOnly}
                          aria-invalid={fe(`participants[${k}].agent.model`) ? true : undefined}
                          onChange={e => setPart(k, { agent: { ...p.agent, model: e.target.value || undefined } })} />}
                  </>}
                  {isUser && <>
                    <Select size="sm" aria-label="как выбирать человека" value={p.user?.login !== undefined ? 'login' : 'role'} disabled={readOnly}
                      onChange={e => setPart(k, e.target.value === 'login' ? { user: { login: '' } } : { user: { role: 'owner' } })}>
                      <option value="role">по роли</option>
                      <option value="login">по логину</option>
                    </Select>
                    {p.user?.login !== undefined
                      ? <Combo className="f-sm mono" aria-label="логин участника" options={logins} placeholder="логин участника" value={p.user.login} disabled={readOnly}
                          onChange={e => setPart(k, { user: { login: e.target.value } })} />
                      : <Select size="sm" aria-label="роль" value={p.user?.role ?? 'owner'} disabled={readOnly}
                          onChange={e => setPart(k, { user: { role: e.target.value } })}>
                          <option value="owner">owner</option>
                          <option value="member">member</option>
                        </Select>}
                  </>}
                  {!readOnly && <Button variant="quiet" size="sm" aria-label="убрать участника"
                    onClick={() => {
                      // Индексы участников сдвигаются: флаг свободного ввода сдвигается вместе с ними.
                      setCustomKind(c => Object.fromEntries(Object.entries(c).filter(([i]) => Number(i) !== k).map(([i, v]) => [Number(i) > k ? Number(i) - 1 : Number(i), v])))
                      patch({ participants: parts.filter((_, j) => j !== k) })
                    }}>✕</Button>}
                </div>
              )
            })}
            {!readOnly && <div><Button size="sm" onClick={() => patch({ participants: [...parts, { agent: {} }] })}>+ участник</Button></div>}
          </div>}
        </Field>
      )}

      {withParts && (
        <div className="f-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Режим" error={fe('mode')}>
            {ids => <Select ids={ids} value={draft.mode ?? 'parallel'} disabled={readOnly} onChange={e => patch({ mode: e.target.value as ProcessStep['mode'] })}>
              <option value="parallel">parallel</option>
              <option value="sequential">sequential</option>
            </Select>}
          </Field>
          <Field label="Правило" error={fe('require')}>
            {ids => <Select ids={ids} value={draft.require ?? 'all'} disabled={readOnly} onChange={e => patch({ require: e.target.value as ProcessStep['require'] })}>
              <option value="all">все</option>
              <option value="any">любой</option>
            </Select>}
          </Field>
          <Field label="Проходов" error={fe('attempts')}>
            {ids => <NumberInput ids={ids} min={1} width={90} placeholder="по пресету" value={draft.attempts ?? ''} disabled={readOnly}
              onChange={e => patch({ attempts: e.target.value ? Number(e.target.value) : undefined })} />}
          </Field>
        </div>
      )}

      <div className="f-grid" style={{ gridTemplateColumns: withParts ? '1fr 1fr 1fr' : '1fr' }}>
        {(withParts ? OUTCOMES : ['ok' as Outcome]).map(o => (
          <Field key={o} label={`${OUTCOME_LABEL[o]} →`} error={fe(`on.${o}`) ?? (o === 'ok' && mine?.field === 'on' ? mine.message : undefined)}>
            {ids => <Select ids={ids} value={draft.on?.[o] ?? ''} disabled={readOnly}
              onChange={e => patch({ on: { ...(draft.on ?? {}), [o]: e.target.value || undefined } })}>
              {targetOptions(doc, draft.id, o).map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </Select>}
          </Field>
        ))}
      </div>

      {!isNew && !readOnly && (
        <div className="f-actions" style={{ justifyContent: 'flex-start' }}>
          <Checkbox checked={!off} onChange={on => patch({ enabled: on ? undefined : false })} label="включён" />
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" aria-label="переместить левее" disabled={index === 0} onClick={() => onMove(index, -1)}>←</Button>
          <Button size="sm" variant="quiet" aria-label="переместить правее" disabled={index === doc.steps.length - 1} onClick={() => onMove(index, 1)}>→</Button>
          <Button size="sm" variant="danger" onClick={() => { onDelete(index); onClose() }}>Удалить шаг</Button>
        </div>
      )}
      <FormActions>
        <Button variant="quiet" onClick={onClose}>{readOnly ? 'Закрыть' : 'Отмена'}</Button>
        {!readOnly && <Button variant="primary" disabled={!canApply} onClick={apply}>{isNew ? 'Добавить шаг' : 'Готово'}</Button>}
      </FormActions>
    </SideModal>
  )
}

export function TransitionModal({ doc, stepId, outcome, readOnly, onApply, onClose }: {
  doc: ProcessDoc
  stepId: string
  outcome: Outcome
  readOnly?: boolean
  onApply: (target: string | undefined) => void
  onClose: () => void
}) {
  const step = doc.steps.find(s => s.id === stepId)
  const [value, setValue] = useState(step?.on?.[outcome] ?? '')
  const titleId = 'transition-modal-title'
  return (
    <SideModal titleId={titleId} onClose={onClose}
      title={<>Исход <span className={'mono outcome-' + outcome}>{OUTCOME_LABEL[outcome]}</span> шага <span className="mono">{stepId}</span></>}>
      <Field label="Куда переходит задача" hint="«по умолчанию» следует порядку шагов и меняется вместе с ним">
        {ids => <Select ids={ids} autoFocus value={value} disabled={readOnly} onChange={e => setValue(e.target.value)}>
          {targetOptions(doc, stepId, outcome).map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </Select>}
      </Field>
      <FormActions>
        <Button variant="quiet" onClick={onClose}>{readOnly ? 'Закрыть' : 'Отмена'}</Button>
        {!readOnly && <Button variant="primary" onClick={() => { onApply(value || undefined); onClose() }}>Готово</Button>}
      </FormActions>
    </SideModal>
  )
}
