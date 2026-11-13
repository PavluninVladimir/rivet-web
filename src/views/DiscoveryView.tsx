import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError, api,
  type AgentRole, type BacklogEpic, type BacklogRow, type DiscoveryState, type Epic, type FeedbackCoverage, type Interview, type Need, type Persona,
  type Quote, type Run, type RunSummary, type User,
} from '../api/client'
import { Button, Checkbox, Field, FormActions, FormNote, Select, TextArea, TextInput, errText, useBusy } from '../components/form'
import { RoleChip } from '../components/RoleChip'
import { fmtDate, Tabs } from '../components/ui'
import { FeedbackForm } from '../components/FeedbackForm'
import {
  DROPPED_KIND_LABEL, IMPORTANCE_LABEL, KIND_LABEL, PRIORITIES, RUN_STATUS_LABEL, SIZES,
  analystName, backlogField, decomposeText, depOptions, droppedSummary, emptyEpic, feedbackExcerpt, highlightRange, interviewLines, linkLabel,
  needsByPersona, nextHumanKey, personaColor, progressPct, progressText, quoteLines, removeEpic, sizeText, usageText, validateRow,
  feedbackNote, quoteSource, runIsOlder, withMissing,
} from '../components/discovery'
import { answerMaterial, canEditDiscovery, discoveryOutcome, OUTCOME_LABEL } from '../components/discoveryOutcomes'
import { useStore } from '../store'

// Представление «Исследование» (спека clients/web, add-product-discovery):
// интервью, анализ Аналитиком, персоны и потребности с цитатами, раздел
// отброшенного, бэклог с правкой и утверждением, история версий.

// Поле ошибки API: внутри конверта error.
function apiField(e: unknown): string | undefined {
  return e instanceof ApiError ? (e.data as { error?: { field?: string } } | null)?.error?.field : undefined
}
function apiExtra<T>(e: unknown, key: string): T | undefined {
  return e instanceof ApiError ? (e.data as { error?: Record<string, unknown> } | null)?.error?.[key] as T | undefined : undefined
}

// Подсказка, где чинится ошибка запуска анализа.
function startHint(e: unknown): string {
  if (!(e instanceof ApiError)) return ''
  switch (e.code) {
    case 'analyst_disabled': return ' Шаблон включает администратор: «Управление» → «Шаблоны ролей».'
    case 'model_not_configured':
    case 'model_invalid': return ' Модель Аналитика выбирается в «Управление» → «Команда» или у шаблона роли.'
    default: return ''
  }
}

export function DiscoveryView({ user, runId }: { user: User; runId?: string }) {
  const { projectId, projects, discoveryTick, nav, href, roleOf } = useStore()
  const project = projects.find(p => p.ID === projectId)
  const [state, setState] = useState<DiscoveryState | null>(null)
  const [selected, setSelected] = useState<Run | null>(null)
  const [epics, setEpics] = useState<Epic[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [err, setErr] = useState('')
  // unsupported — сервер без исследования (старая версия rivetd): 404 на /discovery.
  const [unsupported, setUnsupported] = useState(false)
  const [startErr, setStartErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [answerSeed, setAnswerSeed] = useState('')
  const [viewer, setViewer] = useState<{ id: string; quote?: Quote } | null>(null)
  // selErr — ошибка открытой версии отдельно от ошибки состояния: успешное
  // перечитывание состояния её не стирает.
  const [selErr, setSelErr] = useState<{ msg: string; notFound: boolean } | null>(null)
  // lostDraft — несохранённые правки бэклога пропали вместе с версией
  // (новый анализ или утверждение другим владельцем).
  const [lostDraft, setLostDraft] = useState(false)
  const [busy, run] = useBusy()

  // Применяется ответ новее последнего применённого: запоздавший старый не
  // возвращает прежнее состояние, а частые события не отбрасывают все
  // ответы подряд, пока сервер отвечает медленнее, чем они идут.
  const seq = useRef({ state: 0, epics: 0, selected: 0 })
  const applied = useRef({ state: 0, epics: 0, selected: 0 })
  const refresh = useCallback(() => {
    if (!projectId) return
    const n = ++seq.current.state
    api.discovery(projectId)
      .then(s => {
        if (n <= applied.current.state) return
        applied.current.state = n
        // Версия из ответа PUT или approve может быть новее ответа GET,
        // отправленного раньше: старшая не заменяется младшей.
        setState(prev => prev?.current && s.current && runIsOlder(s.current, prev.current) ? { ...s, current: prev.current } : s)
        setErr(''); setUnsupported(false)
      })
      .catch(e => {
        if (n <= applied.current.state) return
        if (e instanceof ApiError && e.status === 404 && e.code !== 'not_found') setUnsupported(true)
        else setErr(errText(e))
      })
    const m = ++seq.current.epics
    api.epics(projectId).then(e => {
      if (m <= applied.current.epics) return
      applied.current.epics = m
      setEpics(e ?? [])
    }).catch(() => {})
  }, [projectId])
  // Открытая версия из истории: перечитывается тем же сигналом.
  const loadSelected = useCallback(() => {
    const n = ++seq.current.selected
    if (!projectId || !runId) { setSelected(null); setSelErr(null); return }
    const want = runId
    api.analysis(projectId, runId)
      .then(r => {
        // Ответ про прошлую версию (адрес уже сменился) не применяется.
        if (n <= applied.current.selected || want !== runIdRef.current || r.id !== want) return
        applied.current.selected = n
        setSelected(prev => prev && runIsOlder(r, prev) ? prev : r)
        setSelErr(null)
      })
      .catch(e => {
        if (n <= applied.current.selected || want !== runIdRef.current) return
        applied.current.selected = n
        // 404 новой версии не оставляет на экране прошлую.
        setSelected(null)
        setSelErr({ msg: errText(e), notFound: e instanceof ApiError && e.status === 404 })
      })
  }, [projectId, runId])
  // Версия из ответа сохранения или утверждения: кладётся в состояние
  // сразу, черновик и пропсы меняются одним рендером.
  const applyRun = useCallback((r: Run) => {
    setSelected(prev => prev && prev.id === r.id && !runIsOlder(r, prev) ? r : prev)
    setState(prev => prev?.current && prev.current.id === r.id && !runIsOlder(r, prev.current) ? { ...prev, current: r } : prev)
  }, [])
  // Ход анализа и декомпозиции обновляется по счётчику событий потока
  // проекта (не теряет события одной пачки), переподключение тоже его
  // увеличивает.
  useEffect(refresh, [refresh, discoveryTick])
  // Смена версии в адресе: ответы прошлых запросов больше не применяются.
  useEffect(() => {
    applied.current.selected = seq.current.selected
    setSelected(null)
    setSelErr(null)
  }, [runId])
  useEffect(loadSelected, [loadSelected, discoveryTick])
  useEffect(() => {
    if (!projectId) return
    let live = true
    api.members(projectId)
      .then(ms => { if (live) setIsOwner((ms ?? []).some(m => m.login === user.login && m.role === 'owner')) })
      .catch(() => { if (live) setIsOwner(false) })
    return () => { live = false }
  }, [projectId, user.login])

  const runIdRef = useRef(runId)
  runIdRef.current = runId
  const current = runId ? selected : state?.current ?? null
  const interviews = state?.interviews ?? []
  // Отзывы пользователей (add-user-feedback): нет у старого rivetd.
  const feedback = state?.feedback ?? []
  // Правки черновика исчезают вместе с версией: при смене текущей версии
  // с несохранёнными правками показывается заметка. Признак правок хранится
  // по id версии: эффект нового черновика (он срабатывает раньше эффекта
  // родителя) не стирает признак прошлого.
  const dirtyBy = useRef<Record<string, boolean>>({})
  const shownRun = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = shownRun.current
    if (prev && current?.id !== prev) {
      if (dirtyBy.current[prev]) setLostDraft(true)
      delete dirtyBy.current[prev]
    }
    shownRun.current = current?.id
  }, [current?.id])
  const onDirty = useCallback((id: string, d: boolean) => {
    dirtyBy.current[id] = d
    if (d) setLostDraft(false)
  }, [])
  const openQuote = useCallback((q: Quote) => setViewer({ id: q.interview, quote: q }), [])
  const closeViewer = useCallback(() => setViewer(null), [])
  const reloadAll = useCallback(() => { refresh(); loadSelected() }, [refresh, loadSelected])

  const start = () => run(async () => {
    if (!projectId) return
    setStartErr('')
    try { await api.startAnalysis(projectId); refresh() } catch (e) { setStartErr(errText(e) + startHint(e)) }
  })

  if (!projectId) return <div className="page"><span className="muted">Выберите проект.</span></div>
  if (unsupported) return <div className="page"><span className="muted">Исследование недоступно на этой версии сервера.</span></div>
  if (!state) return <div className="page">{err || 'Загрузка…'}</div>

  const analystRole = roleOf('analyst')
  const running = state.current?.status === 'running'

  return (
    <div className="page disc">
      <div className="page-head">
        <h1>Исследование</h1>
        <span className="sub">{project?.Name}{isOwner ? '' : ' · только просмотр'}</span>
        <div className="right">
          {isOwner && <Button onClick={() => {setAnswerSeed('');setAdding(true)}}>Добавить интервью</Button>}
          {isOwner && (
            <Button variant="primary" busy={busy || running} busyLabel="анализ идёт…"
              disabled={interviews.length === 0 && feedback.length === 0} onClick={start}>Запустить анализ</Button>
          )}
        </div>
      </div>
      {startErr && <FormNote err={startErr} />}
      {err && <FormNote err={err} />}
      {lostDraft && (
        <div className="budget-pause" role="status">
          Версия исследования сменилась (новый анализ или переход к другой версии): несохранённые правки бэклога прошлой версии не сохранены.{' '}
          <Button size="sm" variant="quiet" onClick={() => setLostDraft(false)}>Понятно</Button>
        </div>
      )}
      {runId && selErr && (
        <div className="budget-pause" role="alert">
          {selErr.notFound
            ? 'Версия исследования не найдена в этом проекте: ссылка могла вести в другой проект.'
            : 'Версия исследования не загрузилась: ' + selErr.msg}{' '}
          <Button size="sm" onClick={() => nav({ view: 'discovery' })}>К текущей версии</Button>
        </div>
      )}

      {current && <RunStatusBar run={current} role={analystRole} isHistory={!!runId} onBack={() => nav({ view: 'discovery' })} />}
      {current && ['ready','approved','superseded'].includes(current.status) && <DiscoveryDecision run={current} isOwner={isOwner} onQuote={openQuote} onAnswer={text=>{setAnswerSeed(text);setAdding(true)}} />}

      <InterviewsSection interviews={interviews} isOwner={isOwner} projectId={projectId}
        onOpen={id => setViewer({ id })} onChanged={refresh} />

      {state.feedback !== undefined && (
        <FeedbackSection feedback={feedback} unaccounted={state.feedback_unaccounted ?? 0} coverage={state.feedback_coverage} isOwner={isOwner}
          projectId={projectId} onOpen={id => setViewer({ id })} onChanged={refresh} />
      )}

      {current && (current.status === 'failed') && <FailedSection run={current} />}
      {current && (current.personas?.length ?? 0) > 0 && <ResultsSection run={current} onQuote={openQuote} />}
      {current && (current.dropped?.length ?? 0) > 0 && <DroppedSection run={current} />}
      {current && discoveryOutcome(current)==='backlog_ready' && (current.backlog?.length ?? 0) > 0 && (
        <BacklogSection key={current.id} run={current} projectId={projectId} epics={epics}
          isOwner={isOwner} onChanged={reloadAll} onRun={applyRun} onDirty={onDirty} epicHref={id => href({ view: 'epic', id })} />
      )}

      <VersionsSection versions={state.versions ?? []} currentId={current?.id}
        onOpen={id => nav(id === state.current?.id ? { view: 'discovery' } : { view: 'discovery', runId: id })} />

      {adding && <AddInterviewModal initialText={answerSeed} projectId={projectId} onClose={() => {setAdding(false);setAnswerSeed('')}} onAdded={() => { setAdding(false); setAnswerSeed(''); refresh() }} />}
      {viewer && <InterviewViewer projectId={projectId} id={viewer.id} quote={viewer.quote} onClose={closeViewer} />}
    </div>
  )
}

function DiscoveryDecision({run,isOwner,onQuote,onAnswer}:{run:Run;isOwner:boolean;onQuote:(q:Quote)=>void;onAnswer:(text:string)=>void}) {
  const outcome=discoveryOutcome(run)
  const source=(s:NonNullable<Run['sources']>[number],i:number)=><button key={i} className="btn sm" onClick={()=>onQuote({interview:s.material_id,line:s.line,text:s.quote,interview_title:'Материал решения',respondent_role:''})}>Материал · строка {s.line}: {s.quote}</button>
  return <section className="dw-sec" aria-label="Исход исследования"><h3>{outcome?OUTCOME_LABEL[outcome]:'Исход не подтверждён'}</h3>
    {run.outcome_legacy&&<p className="muted">Историческая версия. Исход прочитан без изменения сохранённой истории.</p>}
    {!outcome&&<p role="alert">{run.outcome_error||'Сервер вернул неизвестный или неполный исход. Редактирование и создание Epic недоступны.'}</p>}
    {run.rationale&&<p style={{whiteSpace:'pre-wrap'}}>{run.rationale}</p>}
    <div className="disc-decision-sources">{(run.sources??[]).map(source)}</div>
    {(run.questions??[]).map(q=><article key={q.id} className="disc-question"><h4>{q.text}</h4><p>Зачем уточнить: {q.reason}</p><div className="disc-decision-sources">{q.sources.map(source)}</div>{isOwner&&<Button size="sm" onClick={()=>onAnswer(answerMaterial(run,q))}>Добавить ответ материалом</Button>}</article>)}
    {outcome==='needs_clarification'&&<p>Ответ сохраняется новым материалом. После добавления ответов отдельно нажмите «Запустить анализ». Предыдущая версия не изменяется, задачи автоматически не запускаются.</p>}
    {outcome==='no_development_recommended'&&<p>Анализ завершён без создания работ. Новые сведения можно добавить материалом и явно запустить новую версию.</p>}
  </section>
}

// ─── статус версии ──────────────────────────────────────────────────────

function RunStatusBar({ run, role, isHistory, onBack }: {
  run: Run; role: AgentRole | undefined; isHistory: boolean; onBack: () => void
}) {
  const pct = progressPct(run)
  return (
    <div className="disc-status">
      <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="epic-id">v{run.version}</span>
        <span className={'st st-' + statusClass(run.status)}>{RUN_STATUS_LABEL[run.status] ?? run.status}</span>
        <RoleChip role={role} roleId="analyst" title={run.role?.title} name={run.agent?.name} small />
        {run.model && <span className="chip"><span className="n">{run.model}</span></span>}
        <span className="sub mono">{usageText(run.usage)}</span>
        {run.outdated && <span className="chip" title="интервью или отзыв версии удалены"><span className="n">устарела</span></span>}
        {isHistory && <Button size="sm" variant="quiet" onClick={onBack}>к текущей версии</Button>}
      </div>
      {run.status === 'running' && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12.5 }}>{progressText(run)}</div>
          <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${pct}%`, background: 'var(--c-run)' }} /></div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        начата {fmtDate(run.started_at)}{run.finished_at ? ` · завершена ${fmtDate(run.finished_at)}` : ''}
        {run.approved ? ` · утверждена ${fmtDate(run.approved.at)}${run.approved.by ? ' · ' + run.approved.by : ''}` : ''}
      </div>
    </div>
  )
}

function statusClass(s: string): string {
  return s === 'running' ? 'running' : s === 'ready' ? 'review' : s === 'approved' ? 'done' : s === 'failed' ? 'failed' : 'cancelled'
}

function FailedSection({ run }: { run: Run }) {
  return (
    <div className="dw-sec">
      <h3>Анализ не завершён</h3>
      <div className="budget-pause">{run.error || 'причина не указана'}</div>
      {(run.defects?.length ?? 0) > 0 && (
        <ul className="disc-defects">{run.defects!.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
    </div>
  )
}

// ─── интервью ───────────────────────────────────────────────────────────

function InterviewsSection({ interviews, isOwner, projectId, onOpen, onChanged }: {
  interviews: Interview[]; isOwner: boolean; projectId: string; onOpen: (id: string) => void; onChanged: () => void
}) {
  const [err, setErr] = useState('')
  // confirm — интервью, удаление которого ждёт подтверждения.
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const del = (iv: Interview) => run(async () => {
    setErr('')
    try { await api.deleteInterview(projectId, iv.id); setConfirm(null); onChanged() } catch (e) { setErr(errText(e)) }
  })
  return (
    <div className="dw-sec">
      <h3>Интервью · {interviews.length}</h3>
      {interviews.length === 0
        ? <div className="muted" style={{ fontSize: 12.5 }}>Интервью пока нет.{isOwner ? ' Загрузите расшифровку файлом .md или вставьте текст.' : ''}</div>
        : (
          <table className="tbl">
            <thead><tr><th>Название</th><th>Роль респондента</th><th>Дата</th><th>Размер</th><th>Загрузил</th><th /></tr></thead>
            <tbody>
              {interviews.map(iv => (
                <tr key={iv.id} className="rowlink" onClick={() => onOpen(iv.id)}>
                  {/* Кнопка — открытие с клавиатуры; клик по ней строку не дублирует. */}
                  <td><button type="button" className="row-link" onClick={e => { e.stopPropagation(); onOpen(iv.id) }}>{iv.title}</button></td>
                  <td className="muted">{iv.respondent_role || '—'}</td>
                  <td className="mono muted">{iv.held_at ?? '—'}</td>
                  <td className="mono muted">{sizeText(iv.chars, iv.lines)}</td>
                  <td className="mono muted">{iv.created_by}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    {isOwner && confirm !== iv.id && (
                      <Button size="sm" variant="quiet" aria-label={`удалить ${iv.title}`} onClick={() => { setErr(''); setConfirm(iv.id) }}>Удалить</Button>
                    )}
                    {isOwner && confirm === iv.id && (
                      <span className="iv-confirm">
                        <span className="muted">Удалить? Версии с ним станут устаревшими.</span>{' '}
                        <Button size="sm" variant="danger" busy={busy} onClick={() => del(iv)}>Удалить</Button>
                        <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>Отмена</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {err && <FormNote err={err} />}
    </div>
  )
}

// ─── отзывы пользователей (add-user-feedback) ────────────────────────────

// Отзывы проекта: число неучтённых, форма для любого участника, список с
// источником, датой и началом текста, удаление владельцем.
function FeedbackSection({ feedback, unaccounted, coverage, isOwner, projectId, onOpen, onChanged }: {
  feedback: Interview[]; unaccounted: number; coverage: FeedbackCoverage | null | undefined; isOwner: boolean; projectId: string
  onOpen: (id: string) => void; onChanged: () => void
}) {
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const del = (fb: Interview) => run(async () => {
    setErr('')
    try { await api.deleteInterview(projectId, fb.id); setConfirm(null); onChanged() } catch (e) { setErr(errText(e)) }
  })
  return (
    <div className="dw-sec disc-feedback">
      <h3>Отзывы пользователей · {feedback.length}</h3>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {feedbackNote(unaccounted, feedback.length, coverage)}
      </div>
      <FeedbackForm projectId={projectId} onAdded={onChanged} />
      {feedback.length > 0 && (
        <table className="tbl">
          <thead><tr><th>Источник</th><th>Отзыв</th><th>Дата</th><th>Добавил</th><th /></tr></thead>
          <tbody>
            {feedback.map(fb => (
              <tr key={fb.id} className="rowlink" onClick={() => onOpen(fb.id)}>
                <td><button type="button" className="row-link" onClick={e => { e.stopPropagation(); onOpen(fb.id) }}>{fb.source || fb.respondent_role}</button></td>
                <td className="muted">{feedbackExcerpt(fb.excerpt ?? fb.text)}</td>
                <td className="mono muted">{fmtDate(fb.created_at)}</td>
                <td className="mono muted">{fb.created_by || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  {isOwner && confirm !== fb.id && (
                    <Button size="sm" variant="quiet" aria-label={`удалить отзыв ${fb.source ?? ''}`} onClick={() => { setErr(''); setConfirm(fb.id) }}>Удалить</Button>
                  )}
                  {isOwner && confirm === fb.id && (
                    <span className="iv-confirm">
                      <span className="muted">Удалить? Версии с ним станут устаревшими.</span>{' '}
                      <Button size="sm" variant="danger" busy={busy} onClick={() => del(fb)}>Удалить</Button>
                      <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>Отмена</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err && <FormNote err={err} />}
    </div>
  )
}

function AddInterviewModal({ projectId, onClose, onAdded, initialText='' }: { initialText?:string; projectId: string; onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<'file' | 'text'>(initialText?'text':'file')
  const [title, setTitle] = useState(initialText?'Ответы на вопросы исследования':'')
  const [role, setRole] = useState('')
  const [heldAt, setHeldAt] = useState('')
  const [text, setText] = useState(initialText)
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [busy, run] = useBusy()

  const save = () => run(async () => {
    setErr(null)
    try {
      if (mode === 'file') {
        if (!file) { setErr({ msg: 'выберите файл', field: 'file' }); return }
        await api.uploadInterview(projectId, file, { title, respondent_role: role, held_at: heldAt || undefined })
      } else {
        await api.addInterview(projectId, { title, respondent_role: role, held_at: heldAt || undefined, text })
      }
      onAdded()
    } catch (e) {
      const limit = apiExtra<number>(e, 'limit')
      setErr({ msg: errText(e) + (limit && e instanceof ApiError && e.code === 'interview_too_large' ? ` (лимит ${limit.toLocaleString('ru-RU')})` : ''), field: apiField(e) })
    }
  })
  const fe = (f: string) => err?.field === f ? err.msg : undefined

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal f-form" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <h2>Новое интервью</h2>
        <Tabs tabs={[{ id: 'file', label: 'Файлом' }, { id: 'text', label: 'Текстом' }]} active={mode} onChange={setMode} />
        <Field label="Название" optional={mode === 'file'} hint={mode === 'file' ? 'без названия берётся первый заголовок «# …» или имя файла' : undefined} error={fe('title')}>
          {ids => <TextInput ids={ids} autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, Менеджер по продажам" />}
        </Field>
        <Field label="Роль респондента" error={fe('respondent_role')}>
          {ids => <TextInput ids={ids} value={role} onChange={e => setRole(e.target.value)} placeholder="Менеджер по продажам" />}
        </Field>
        <Field label="Дата интервью" optional error={fe('held_at')}>
          {ids => <input type="date" {...{ id: ids.id }} value={heldAt} onChange={e => setHeldAt(e.target.value)} />}
        </Field>
        {mode === 'file'
          ? (
            <Field label="Файл" hint=".md или .txt в UTF-8, до 200 000 символов" error={fe('file') ?? fe('text')}>
              {ids => <input type="file" id={ids.id} accept=".md,.txt,.markdown,text/markdown,text/plain"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />}
            </Field>
          )
          : (
            <Field label="Текст интервью" hint="реплики удобно подписывать «**И:**» и «**Р:**»" error={fe('text')}>
              {ids => <TextArea ids={ids} rows={10} value={text} onChange={e => setText(e.target.value)} />}
            </Field>
          )}
        <FormActions note={<FormNote err={err && !err.field ? err.msg : undefined} />}>
          <Button variant="quiet" onClick={onClose}>Отмена</Button>
          <Button variant="primary" busy={busy} busyLabel="загрузка…" onClick={save}>Добавить</Button>
        </FormActions>
      </div>
    </div>
  )
}

// Окно текста интервью с нумерацией строк и подсветкой цитаты. memo:
// окно не перерисовывается на каждый чанк лога в потоке проекта, строки
// пересчитываются только при смене текста или цитаты.
const InterviewViewer = memo(function InterviewViewer({ projectId, id, quote, onClose }: {
  projectId: string; id: string; quote?: Quote; onClose: () => void
}) {
  const [iv, setIv] = useState<Interview | null>(null)
  const [err, setErr] = useState('')
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    api.interview(projectId, id).then(v => { if (live) setIv(v) }).catch(e => { if (live) setErr(errText(e)) })
    return () => { live = false }
  }, [projectId, id])
  useEffect(() => { target.current?.scrollIntoView({ block: 'center' }) }, [iv])
  const rows = useMemo(() => {
    const lines = interviewLines(iv?.text ?? '')
    const range = quote ? quoteLines(quote) : null
    return lines.map((text, i) => {
      const n = i + 1
      const hl = quote ? highlightRange(text, n, quote) : null
      return (
        <div key={n} ref={range && n === range.from ? target : undefined} className={'iv-line' + (hl ? ' hl' : '')}>
          <span className="iv-n">{n}</span>
          <span className="iv-t">
            {hl ? <>{text.slice(0, hl[0])}<mark>{text.slice(hl[0], hl[1])}</mark>{text.slice(hl[1])}</> : text || ' '}
          </span>
        </div>
      )
    })
  }, [iv, quote])
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal iv-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{iv?.title ?? 'Интервью'}{iv?.deleted ? ' · удалено' : ''}</h2>
          <Button size="sm" variant="quiet" aria-label="закрыть" onClick={onClose}>✕</Button>
        </div>
        {iv && <div className="muted" style={{ fontSize: 12 }}>{iv.respondent_role || 'роль не указана'}{iv.held_at ? ` · ${iv.held_at}` : ''} · {sizeText(iv.chars, iv.lines)}</div>}
        {err && <FormNote err={err} />}
        <div className="iv-text">{rows}</div>
      </div>
    </div>
  )
})

// ─── результаты ─────────────────────────────────────────────────────────

function ResultsSection({ run, onQuote }: { run: Run; onQuote: (q: Quote) => void }) {
  const personas = run.personas ?? []
  const groups = needsByPersona(personas, run.needs ?? [])
  return (
    <>
      <div className="dw-sec">
        <h3>Персоны · {personas.length}</h3>
        <div className="disc-personas">
          {personas.map(p => (
            <div key={p.id} className="runner-card persona-card" style={{ ['--pc' as string]: personaColor(personas, p.id) }}>
              <div className="rc-top"><span className="role-swatch" style={{ ['--rc' as string]: 'var(--pc)' }} /><span className="name">{p.name}</span>
                <span className="chip" style={{ marginLeft: 'auto' }}><span className="n">{(run.needs ?? []).filter(n => n.persona === p.id).length}</span> потребн.</span></div>
              <div className="rc-action" style={{ whiteSpace: 'normal' }}>{p.description}</div>
              <div className="muted" style={{ fontSize: 11 }}>материалы: {(p.interviews ?? []).length}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="dw-sec">
        <h3>Потребности · {(run.needs ?? []).length}</h3>
        {groups.map(g => (
          <div key={g.persona?.id ?? '-'} className="disc-group">
            <div className="disc-group-head">{g.persona?.name ?? 'Без персоны'}</div>
            {g.needs.map(n => <NeedCard key={n.id} need={n} personas={personas} onQuote={onQuote} />)}
          </div>
        ))}
      </div>
    </>
  )
}

export function NeedCard({ need, personas, onQuote }: { need: Need; personas: Persona[]; onQuote?: (q: Quote) => void }) {
  return (
    <div className="need-card">
      <div className="need-top">
        <span className="mono muted">{need.id}</span>
        <b>{need.title}</b>
        <span className="chip"><span className="n">{KIND_LABEL[need.kind] ?? need.kind}</span></span>
        <span className={'chip imp-' + need.importance}><span className="n">{IMPORTANCE_LABEL[need.importance] ?? need.importance}</span></span>
      </div>
      {(need.evidence ?? []).map((q, i) => (
        <blockquote key={i} className="quote" style={{ ['--pc' as string]: personaColor(personas, need.persona) }}>
          <div className="quote-text">«{q.text}»</div>
          <div className="quote-src">
            {onQuote
              ? <button type="button" className="tlink" onClick={() => onQuote(q)}>{quoteSource(q)}</button>
              : <>{quoteSource(q)}</>}
            {q.respondent_role && q.kind !== 'feedback' && <span className="muted"> · {q.respondent_role}</span>}
          </div>
        </blockquote>
      ))}
    </div>
  )
}

function DroppedSection({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const dropped = run.dropped ?? []
  return (
    <div className="dw-sec">
      <h3>Отброшено при проверке · {dropped.length}</h3>
      <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12.5 }}>{droppedSummary(dropped)}</span>
        <Button size="sm" variant="quiet" onClick={() => setOpen(o => !o)}>{open ? 'Скрыть' : 'Показать'}</Button>
      </div>
      {open && (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>Вид</th><th>Что</th><th>Причина</th></tr></thead>
          <tbody>
            {dropped.map((d, i) => (
              <tr key={i}>
                <td className="mono muted">{DROPPED_KIND_LABEL[d.kind] ?? d.kind}</td>
                <td style={{ maxWidth: 520, overflowWrap: 'anywhere' }}>{d.ref}</td>
                <td className="muted">{d.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── бэклог ─────────────────────────────────────────────────────────────

// Поля строки, у которых есть свой элемент правки: ошибки остальных полей
// показываются под строкой.
const ROW_FIELDS = new Set(['title', 'goal', 'depends_on', 'needs'])

type BacklogErr = { msg: string; rowKey?: string; field?: string; conflict?: number }

function BacklogSection({ run, projectId, epics, isOwner, onChanged, onRun, onDirty, epicHref }: {
  run: Run; projectId: string; epics: Epic[]; isOwner: boolean; onChanged: () => void
  onRun: (r: Run) => void; onDirty: (runId: string, dirty: boolean) => void; epicHref: (id: string) => string
}) {
  const editable = isOwner && canEditDiscovery(run)
  const [draft, setDraft] = useState<BacklogEpic[]>(() => (run.backlog ?? []).map(stripRow))
  // baseRev — ревизия, от которой идёт черновик: сохранение и утверждение
  // идут с ней, а не с ревизией последнего ответа сервера.
  const [baseRev, setBaseRev] = useState(run.backlog_rev)
  const [dirty, setDirty] = useState(false)
  const [decompose, setDecompose] = useState(true)
  const [err, setErr] = useState<BacklogErr | null>(null)
  // Раздельный «занят» у сохранения и утверждения: крутится только нажатая
  // кнопка, а заблокированы обе.
  const [saving, actSave] = useBusy()
  const [approving, actApprove] = useBusy()
  const busy = saving || approving
  const needs = run.needs ?? []
  const rows: BacklogRow[] = run.backlog ?? []
  // Чужая правка (ревизия на сервере новее черновика): без своих правок
  // черновик пересобирается, со своими — баннер с предложением перечитать.
  // Ревизии растут монотонно: ответ GET, отставший от своего сохранения,
  // черновик не откатывает.
  const staleRev = run.backlog_rev > baseRev ? run.backlog_rev : null
  useEffect(() => {
    if (run.backlog_rev > baseRev && !dirty && !busy) {
      setDraft((run.backlog ?? []).map(stripRow))
      setBaseRev(run.backlog_rev)
    }
  }, [run.backlog_rev, run.backlog, baseRev, dirty, busy])
  useEffect(() => { onDirty(run.id, dirty) }, [run.id, dirty, onDirty])
  // Версия ушла из ready (утверждена, заменена): ошибка прошлой попытки
  // больше не относится к ней.
  useEffect(() => { setErr(null) }, [run.status])

  const edit = (key: string, patch: Partial<BacklogEpic>) => {
    setDraft(d => d.map(e => e.key === key ? { ...e, ...patch } : e))
    setDirty(true)
    setErr(null)
  }
  const reread = () => {
    setDraft((run.backlog ?? []).map(stripRow))
    setBaseRev(run.backlog_rev)
    setDirty(false)
    setErr(null)
    onChanged()
  }
  const localErrs = draft.map(validateRow)
  const hasLocal = localErrs.some(e => Object.keys(e).length > 0)

  const fail = (e: unknown, list: BacklogEpic[]) => {
    if(e instanceof ApiError && e.code==='discovery_outcome_not_actionable') onChanged()
    const bf = backlogField(apiField(e))
    const rev = e instanceof ApiError && e.code === 'backlog_conflict' ? apiExtra<number>(e, 'backlog_rev') : undefined
    setErr({ msg: errText(e), rowKey: bf ? list[bf.index]?.key : undefined, field: bf?.field ?? apiField(e), conflict: rev })
  }
  // Ответ сохранения накладывается на черновик: правки, сделанные во
  // время запроса, невозможны (поля заблокированы на время запроса).
  const applySaved = (saved: Run) => {
    setDraft((saved.backlog ?? []).map(stripRow))
    setBaseRev(saved.backlog_rev)
    setDirty(false)
  }
  const save = () => actSave(async () => {
    setErr(null)
    try {
      const saved = await api.putBacklog(projectId, run.id, baseRev, draft)
      applySaved(saved)
      onRun(saved)
      onChanged()
    } catch (e) { fail(e, draft) }
  })
  const approve = () => actApprove(async () => {
    setErr(null)
    let rev = baseRev
    try {
      if (dirty) {
        const saved = await api.putBacklog(projectId, run.id, rev, draft)
        applySaved(saved)
        onRun(saved)
        rev = saved.backlog_rev
      }
      const res = await api.approveBacklog(projectId, run.id, rev, decompose)
      // Утверждённая версия сразу в состоянии: кнопка «Создать Epic’и»
      // исчезает до перечитывания, второго утверждения не будет.
      onRun(res.run)
      onChanged()
    } catch (e) {
      fail(e, draft)
      // Сохранение могло пройти до отказа утверждения: версия
      // перечитывается, черновик не откатывается к прошлой ревизии.
      onChanged()
    }
  })
  const fieldErr = (i: number, key: string, f: string) =>
    (err?.rowKey === key && err.field === f ? err.msg : undefined) ?? localErrs[i]?.[f as 'title' | 'goal']

  const list = editable ? draft : rows
  const locked = busy
  return (
    <div className="dw-sec">
      <h3>Бэклог · {list.length}{run.status === 'approved' ? ' · утверждён' : ''}</h3>
      {!editable && dirty && (
        <div className="budget-pause" role="status">
          {run.outdated
            ? 'Версия устарела после удаления интервью или отзыва: несохранённые правки бэклога не сохранены. Запустите анализ заново.'
            : run.status === 'approved'
              ? 'Версия утверждена: ваши несохранённые правки не вошли в бэклог.'
              : 'Версия заменена новым анализом: ваши несохранённые правки не сохранены.'}
        </div>
      )}
      {editable && staleRev != null && dirty && !busy && (
        <div className="budget-pause" role="alert">
          Бэклог изменён другим владельцем (ревизия {staleRev}). Ваши несохранённые правки основаны на ревизии {baseRev}.{' '}
          <Button size="sm" onClick={reread}>Перечитать</Button>
        </div>
      )}
      <table className="tbl backlog">
        <thead><tr><th>Epic</th><th>Цель</th><th>Приоритет</th><th>Размер</th><th>Зависит от</th><th>Потребности</th><th /></tr></thead>
        <tbody>
          {list.map((e, i) => {
            const row = rows.find(r => r.key === e.key)
            const rowNote = err && err.rowKey === e.key && !ROW_FIELDS.has(err.field ?? '') ? err : null
            const deps = withMissing(depOptions(draft, e.key, epics), e.depends_on, epics)
            return (
              <Fragment key={e.key}>
                <tr>
                  <td style={{ minWidth: 200 }}>
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {e.key} · {linkLabel(e, epics)}
                      {editable && e.existing_epic && (
                        <Button size="sm" variant="quiet" disabled={locked} title="строка с тем же названием, что у Epic'а проекта, при сохранении снова свяжется с ним"
                          onClick={() => edit(e.key, { existing_epic: null })}>снять связь</Button>
                      )}
                    </div>
                    {editable
                      ? <Field error={fieldErr(i, e.key, 'title')}>{ids => <TextInput ids={ids} aria-label="название" disabled={locked} value={e.title} onChange={ev => edit(e.key, { title: ev.target.value })} />}</Field>
                      : <b>{e.title}</b>}
                    {row?.epic_id && (
                      <div style={{ fontSize: 11.5, marginTop: 4 }}>
                        <a className="tlink" href={epicHref(row.epic_id!)}>открыть Epic →</a>
                        {row.decompose && <span className={'muted dec-' + row.decompose.status}> · {decomposeText(row.decompose)}</span>}
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {editable
                      ? <Field error={fieldErr(i, e.key, 'goal')}>{ids => <TextArea ids={ids} aria-label="цель" rows={3} disabled={locked} value={e.goal} onChange={ev => edit(e.key, { goal: ev.target.value })} />}</Field>
                      : <span className="muted" style={{ fontSize: 12 }}>{e.goal}</span>}
                    {e.rationale && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{e.rationale}</div>}
                  </td>
                  <td className="bl-narrow">
                    {editable
                      ? <Select size="sm" aria-label="приоритет" disabled={locked} value={e.priority} onChange={ev => edit(e.key, { priority: ev.target.value as BacklogEpic['priority'] })}>
                          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      : <span className={'chip prio-' + e.priority}><span className="n">{e.priority}</span></span>}
                  </td>
                  <td className="bl-narrow">
                    {editable
                      ? <Select size="sm" aria-label="размер" disabled={locked} value={e.size} onChange={ev => edit(e.key, { size: ev.target.value as BacklogEpic['size'] })}>
                          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      : <span className="chip"><span className="n">{e.size}</span></span>}
                  </td>
                  <td style={{ minWidth: 150 }}>
                    {editable
                      ? <Field error={fieldErr(i, e.key, 'depends_on')}>{ids => (
                          <Select ids={ids} multiple rows={3} aria-label="зависимости" disabled={locked} value={e.depends_on ?? []}
                            onChange={ev => edit(e.key, { depends_on: [...ev.target.selectedOptions].map(o => o.value) })}>
                            {deps.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </Select>
                        )}</Field>
                      : <span className="mono muted" style={{ fontSize: 11.5 }}>{depLabels(e.depends_on, list, epics) || '—'}</span>}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    {editable
                      ? <Field error={fieldErr(i, e.key, 'needs')}>{ids => (
                          <Select ids={ids} multiple rows={3} aria-label="потребности" disabled={locked} value={e.needs ?? []}
                            onChange={ev => edit(e.key, { needs: [...ev.target.selectedOptions].map(o => o.value) })}>
                            {needs.map(n => <option key={n.id} value={n.id} title={n.title}>{n.id} · {n.title}</option>)}
                          </Select>
                        )}</Field>
                      : <span className="mono muted" style={{ fontSize: 11.5 }} title={(e.needs ?? []).map(id => needs.find(n => n.id === id)?.title ?? id).join('\n')}>
                          {(e.needs ?? []).join(', ') || '—'}
                        </span>}
                  </td>
                  <td>
                    {editable && <Button size="sm" variant="quiet" disabled={locked} aria-label={`убрать ${e.key}`}
                      onClick={() => { setDraft(d => removeEpic(d, e.key)); setDirty(true); setErr(null) }}>✕</Button>}
                  </td>
                </tr>
                {rowNote && (
                  <tr><td colSpan={7}><FormNote err={`${e.key}: ${rowNote.field ? rowNote.field + ': ' : ''}${rowNote.msg}`} /></td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {editable && (
        <FormActions note={<FormNote err={err && !err.rowKey ? err.msg : undefined}>{dirty ? 'есть несохранённые правки' : undefined}</FormNote>}>
          {err?.conflict != null && <Button variant="quiet" onClick={reread}>Перечитать бэклог</Button>}
          <Button variant="quiet" disabled={locked} onClick={() => { setDraft(d => [...d, emptyEpic(nextHumanKey(d))]); setDirty(true); setErr(null) }}>Добавить Epic</Button>
          <Button busy={saving} disabled={!dirty || hasLocal || approving} onClick={save}>Сохранить</Button>
          <Checkbox checked={decompose} onChange={setDecompose} label="сразу декомпозировать" />
          <Button variant="primary" busy={approving} busyLabel="создание…" disabled={hasLocal || draft.length === 0 || saving} onClick={approve}>Создать Epic’и</Button>
        </FormActions>
      )}
      {!editable && err && <FormNote err={err.msg} />}
      {!editable && isOwner && run.status === 'ready' && run.outdated && (
        <div className="muted" style={{ fontSize: 12 }}>Версия устарела: интервью или отзыв удалены. Запустите анализ заново.</div>
      )}
    </div>
  )
}


function stripRow(r: BacklogRow): BacklogEpic {
  return {
    key: r.key, title: r.title, goal: r.goal, rationale: r.rationale, needs: r.needs ?? [], priority: r.priority,
    size: r.size, depends_on: r.depends_on ?? [], existing_epic: r.existing_epic,
  }
}

function depLabels(deps: string[] | null, backlog: BacklogEpic[], epics: Epic[]): string {
  return (deps ?? []).map(d => backlog.find(e => e.key === d)?.key ?? epics.find(e => e.ID === d)?.Title ?? d).join(', ')
}

// ─── история версий ─────────────────────────────────────────────────────

function VersionsSection({ versions, currentId, onOpen }: {
  versions: RunSummary[]; currentId?: string; onOpen: (id: string) => void
}) {
  if (!versions.length) return null
  return (
    <div className="dw-sec">
      <h3>История версий</h3>
      <table className="tbl">
        <thead><tr><th>Версия</th><th>Статус</th><th>Начата</th><th>Завершена</th><th>Аналитик</th><th>Модель</th></tr></thead>
        <tbody>
          {versions.map(v => (
            <tr key={v.id} className={'rowlink' + (v.id === currentId ? ' sel' : '')} onClick={() => onOpen(v.id)}>
              <td className="id"><button type="button" className="row-link" onClick={e => { e.stopPropagation(); onOpen(v.id) }}>v{v.version}{v.outdated ? ' · устарела' : ''}</button></td>
              <td><StBadgeRun s={v.status} />{v.outcome && <div>{OUTCOME_LABEL[v.outcome as keyof typeof OUTCOME_LABEL]??'Неизвестный исход'}</div>}</td>
              <td className="mono muted">{fmtDate(v.created_at)}</td>
              <td className="mono muted">{fmtDate(v.finished_at)}</td>
              <td>{analystName({ role: { id: 'analyst', title: 'Аналитик' }, agent: v.agent_name ? { id: '', name: v.agent_name } : null })}</td>
              <td className="mono muted">{v.model || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StBadgeRun({ s }: { s: string }) {
  return <span className={'st st-' + statusClass(s)}>{RUN_STATUS_LABEL[s as keyof typeof RUN_STATUS_LABEL] ?? s}</span>
}

