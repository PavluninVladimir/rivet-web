import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stColor, type Event, type OverlapPayload, type Session, type StepPayload, type Task, type StepRun } from '../api/client'

// stepOf валидирует payload session.step: он runner-controlled, битые типы
// не должны ронять рендер деталки.
function stepOf(e: Event): StepPayload | undefined {
  if (e.Type !== 'session.step' || !e.Payload || typeof e.Payload !== 'object') return undefined
  const p = e.Payload as Record<string, unknown>
  const files = Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : undefined
  return {
    kind: typeof p.kind === 'string' ? p.kind : undefined,
    tool: typeof p.tool === 'string' ? p.tool : undefined,
    detail: typeof p.detail === 'string' ? p.detail : undefined,
    ok: typeof p.ok === 'boolean' ? p.ok : undefined,
    files,
  }
}
// overlapTail — хвост строки пересечения работ: доставлено ли
// предупреждение самому агенту (спека web «Доставка предупреждения агенту
// видна»). Payload старых событий полей доставки не несёт — хвоста нет.
function overlapTail(e: Event): string {
  if (e.Type !== 'session.overlap' || !e.Payload || typeof e.Payload !== 'object') return ''
  const p = e.Payload as OverlapPayload
  if (typeof p.delivered !== 'boolean') return ''
  if (p.delivered) return ' — агент предупреждён'
  const why: Record<string, string> = {
    no_channel: 'адаптер без обратного канала',
    runner_offline: 'runner недоступен',
    no_runner: 'стадия уже завершилась',
  }
  return ' — агент не предупреждён: ' + (why[p.delivery_reason ?? ''] ?? 'причина неизвестна')
}

import { useStore } from '../store'
import { shortHash } from './PolicyPanel'
import { StBadge, attemptStr, fmtDuration, fmtTokens, timeShort } from './ui'

// Merge отложен политикой: последнее task.merge_deferred после последнего
// task.review_passed (подсказка и кнопка подтверждения в деталке).
function mergeDeferred(timeline: Event[]): Event | null {
  let deferred: Event | null = null
  for (const e of timeline) {
    if (e.Type === 'task.review_passed') deferred = null
    if (e.Type === 'task.merge_deferred') deferred = e
    if (e.Type === 'task.status' && e.Payload?.status === 'done') deferred = null
  }
  return deferred
}

const DEFER_REASON: Record<string, string> = {
  human_review_path: 'PR меняет пути, требующие человека',
  policy_file: 'PR меняет файлы политики (.rivet/), нужен ревьюер-человек',
  files_unknown: 'список изменённых файлов PR получить не удалось',
}

// Длительность сессии из started_at/ended_at (поля duration в контракте
// нет); для идущей сессии — от старта до текущего момента.
function sessDuration(s: Session): string {
  const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(s.started_at).getTime()) / 1000))
  return fmtDuration(sec)
}

// Цвета стадий как у статусов задач; fix в истории = статус fixing.
function stageColor(stage: string): string {
  return `var(${stColor[stage === 'fix' ? 'fixing' : stage] ?? '--muted'})`
}

export function TaskDrawer({ taskId, onClose, onChanged, epicStatus, epicTasks }: {
  taskId: string
  onClose: () => void
  onChanged: () => void
  // Статус Epic и его задачи — для правки плана (add-plan-editing):
  // удаление доступно в planned, зависимости выбираются из задач Epic.
  epicStatus?: string
  epicTasks?: Task[]
}) {
  const { tick, logs } = useStore()
  const [task, setTask] = useState<Task | null>(null)
  const [timeline, setTimeline] = useState<Event[]>([])
  const [stepRuns, setStepRuns] = useState<StepRun[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [openSess, setOpenSess] = useState<string | null>(null)
  // null = загрузка; '' = транскрипт недоступен (нет сохранённого или 404)
  const [transcript, setTranscript] = useState<string | null>(null)
  // Актуальная раскрытая сессия для поздних ответов: быстрый клик A → B не
  // должен отрисовать ответ A под строкой B.
  const openSessRef = useRef<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [err, setErr] = useState('')
  // Редактирование лимита попыток участником (спека web «Политики в консоли»).
  const [limitEdit, setLimitEdit] = useState<number | null>(null)
  // Правка плана не начатой задачи (спека web «Правка задачи плана»).
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCriteria, setEditCriteria] = useState<string[]>([])
  const [editDeps, setEditDeps] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Сессия доработки (спека web «Запуск сессии доработки»).
  const [sessPrompt, setSessPrompt] = useState('')
  const [sessPrivate, setSessPrivate] = useState(false)
  const [sessBusy, setSessBusy] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)

  // История сессий перезапрашивается вместе с задачей на каждом SSE-событии
  // (tick растёт в т.ч. на task.status — конец стадии обновляет список).
  const refresh = useCallback(() => {
    api.task(taskId).then(({ task, timeline, step_runs }) => {
      setTask(task)
      setTimeline(timeline ?? [])
      setStepRuns(step_runs ?? [])
    }).catch(e => setErr(String(e)))
    api.taskSessions(taskId).then(s => setSessions(s ?? [])).catch(() => {})
  }, [taskId])
  useEffect(refresh, [refresh, tick])
  useEffect(() => {
    setOpenSess(null); openSessRef.current = null; setTranscript(null)
    setLimitEdit(null); setSessPrompt(''); setSessPrivate(false)
    setEditing(false); setConfirmDelete(false)
  }, [taskId])

  const showTranscript = (s: Session) => {
    if (openSess === s.id) { setOpenSess(null); openSessRef.current = null; return }
    setOpenSess(s.id)
    openSessRef.current = s.id
    setTranscript(null)
    if (!s.has_transcript) { setTranscript(''); return }
    api.sessionTranscript(s.id)
      .then(text => { if (openSessRef.current === s.id) setTranscript(text) })
      .catch(() => { if (openSessRef.current === s.id) setTranscript('') }) // 404 — «недоступен»
  }

  const log = logs.get(taskId) ?? ''
  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight })
  }, [log])

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr('')
    try { await fn(); onChanged(); refresh() } catch (e) { setErr(String(e)) }
  }

  if (!task) return null
  const live = ['running', 'testing', 'fixing', 'review'].includes(task.Status)
  const planEditable = ['queued', 'ready'].includes(task.Status)
    && !['done', 'archived'].includes(epicStatus ?? '')
  const startEdit = () => {
    setEditTitle(task.Title)
    setEditDesc(task.Description)
    setEditCriteria((task.Criteria ?? []).map(c => c.text))
    setEditDeps(task.Deps ?? [])
    setEditing(true)
  }
  const deferred = task.Status === 'review' ? mergeDeferred(timeline) : null

  return (
    <aside id="drawer">
      <div className="dw-head">
        <div className="dw-top">
          <span className="tid">task-{task.Num}</span>
          <StBadge s={task.Status} />
          <button className="close" onClick={onClose}>✕</button>
        </div>
        <h2>{task.Title}</h2>
        <div className="dw-actions">
          {task.Status === 'review' && task.PRURL && !deferred &&
            <button className="btn primary sm" onClick={act(() => api.merge(task.ID))}>Merge</button>}
          {task.PRURL &&
            <a className="btn sm" href={task.PRURL} target="_blank" rel="noreferrer">Открыть PR</a>}
          {task.Status === 'failed' &&
            <button className="btn sm" onClick={act(() => api.retry(task.ID))}>Повторить</button>}
          {planEditable && !editing &&
            <button className="btn sm" onClick={startEdit}>Редактировать</button>}
          {planEditable && epicStatus === 'planned' && (
            confirmDelete
              ? <button className="btn sm danger"
                  onClick={act(async () => { await api.deleteTask(task.ID); onClose() })}>Удалить?</button>
              : <button className="btn sm" onClick={() => setConfirmDelete(true)}>Удалить</button>
          )}
          {!['done', 'cancelled'].includes(task.Status) &&
            <button className="btn sm danger" onClick={act(() => api.cancel(task.ID))}>Отменить</button>}
        </div>
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>

      <div className="dw-body">
        {editing && (
          <div className="dw-sec">
            <h3>Правка плана</h3>
            <input placeholder="Название" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            <textarea className="answer" placeholder="Описание" style={{ marginTop: 6 }}
              value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            <div className="muted" style={{ fontSize: 11.5, margin: '6px 0 2px' }}>Acceptance criteria (отметки сбросятся)</div>
            {editCriteria.map((c, i) => (
              <div className="row" key={i} style={{ gap: 6, marginTop: 4 }}>
                <input value={c} onChange={e => setEditCriteria(editCriteria.map((x, j) => j === i ? e.target.value : x))} />
                <button className="btn sm" onClick={() => setEditCriteria(editCriteria.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn sm" style={{ marginTop: 6 }}
              onClick={() => setEditCriteria([...editCriteria, ''])}>Добавить критерий</button>
            <div className="muted" style={{ fontSize: 11.5, margin: '8px 0 2px' }}>Зависимости</div>
            {(epicTasks ?? []).filter(t2 => t2.ID !== task.ID && t2.Status !== 'cancelled').map(t2 => (
              <label className="row" key={t2.ID} style={{ gap: 6, fontSize: 12, marginTop: 2 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={editDeps.includes(t2.ID)}
                  onChange={e => setEditDeps(e.target.checked
                    ? [...editDeps, t2.ID] : editDeps.filter(d => d !== t2.ID))} />
                <span className="mono muted">task-{t2.Num}</span> {t2.Title}
              </label>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn primary sm" disabled={!editTitle.trim()}
                onClick={act(async () => {
                  await api.patchTask(task.ID, {
                    title: editTitle.trim(), description: editDesc,
                    criteria: editCriteria.map(c => c.trim()).filter(Boolean),
                    deps: editDeps,
                  })
                  setEditing(false)
                })}>
                Сохранить
              </button>
              <button className="btn sm" onClick={() => setEditing(false)}>Отмена</button>
            </div>
          </div>
        )}

        {deferred && (
          <div className="dw-sec">
            <h3>Merge отложен политикой</h3>
            <p style={{ fontSize: 12.5, margin: '0 0 8px' }}>
              {DEFER_REASON[String(deferred.Payload?.reason)] ?? deferred.Text}
              {Array.isArray(deferred.Payload?.paths) && (deferred.Payload!.paths as string[]).length > 0 && (
                <> · <span className="mono">{(deferred.Payload!.paths as string[]).join(', ')}</span></>
              )}
              {' · политика '}<span className="mono">{shortHash(String(deferred.Payload?.policy_version ?? ''))}</span>
            </p>
            {task.PRURL && <button className="btn primary sm" onClick={act(() => api.merge(task.ID))}>Подтвердить merge</button>}
          </div>
        )}
        {['blocked', 'failed', 'review'].includes(task.Status) && (
          <div className="dw-sec">
            <h3>Сессия доработки</h3>
            <textarea className="answer" placeholder="Промпт агенту: что доработать в ветке задачи…"
              value={sessPrompt} onChange={e => setSessPrompt(e.target.value)} />
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <button className="btn primary sm" disabled={!sessPrompt.trim() || sessBusy}
                onClick={act(async () => {
                  if (sessBusy) return
                  setSessBusy(true)
                  try {
                    await api.startTaskSession(task.ID, sessPrompt.trim(), sessPrivate)
                    setSessPrompt('')
                  } finally { setSessBusy(false) }
                })}>
                {sessBusy ? 'Запуск…' : 'Запустить сессию'}
              </button>
              <label className="row muted" style={{ gap: 6, fontSize: 12 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={sessPrivate}
                  onChange={e => setSessPrivate(e.target.checked)} />
                приватная — команда видит только факт
              </label>
            </div>
          </div>
        )}

        {task.Status === 'blocked' && (
          <div className="dw-sec">
            <h3>Вопрос агента</h3>
            <p style={{ fontSize: 12.5, margin: '0 0 8px' }}>{task.BlockReason}</p>
            <textarea className="answer" placeholder="Ответ / уточнение критериев…"
              value={answer} onChange={e => setAnswer(e.target.value)} />
            <div style={{ marginTop: 8 }}>
              <button className="btn primary sm" disabled={!answer.trim()}
                onClick={act(async () => { await api.answer(task.ID, answer); setAnswer('') })}>
                Ответить и вернуть в работу
              </button>
            </div>
          </div>
        )}

        <div className="dw-sec">
          <h3>Метаданные</h3>
          <div className="meta-grid">
            <div className="kv"><span>runner</span><b>{task.RunnerID || '—'}</b></div>
            <div className="kv"><span>попытки</span>
              <b className="row" style={{ gap: 6 }}>
                {limitEdit === null
                  ? <>{attemptStr(task.AttemptUsed, task.AttemptLimit)}
                    {!['done', 'cancelled'].includes(task.Status) &&
                      <button className="btn sm" title="изменить лимит попыток" onClick={() => setLimitEdit(task.AttemptLimit)}>✎</button>}</>
                  : <>
                    <span>{task.AttemptUsed} /</span>
                    <input type="number" min={Math.max(1, task.AttemptUsed)} style={{ width: 56 }} value={limitEdit}
                      onChange={e => setLimitEdit(Number(e.target.value))} />
                    <button className="btn sm primary" disabled={!Number.isInteger(limitEdit) || limitEdit < Math.max(1, task.AttemptUsed)}
                      onClick={act(async () => { await api.patchTask(task.ID, { attempt_limit: limitEdit }); setLimitEdit(null) })}>OK</button>
                    <button className="btn sm" onClick={() => setLimitEdit(null)}>✕</button>
                  </>}
              </b></div>
            <div className="kv"><span>отказы review</span><b>{task.ReviewRejections ?? 0}</b></div>
            <div className="kv"><span>ветка</span><b>{task.Branch || '—'}</b></div>
            <div className="kv"><span>оценка</span><b>{task.Estimate}</b></div>
          </div>
        </div>

        {task.Description && (
          <div className="dw-sec">
            <h3>Описание</h3>
            <p style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', margin: 0 }}>{task.Description}</p>
          </div>
        )}

        {(task.Criteria?.length ?? 0) > 0 && (
          <div className="dw-sec">
            <h3>Acceptance criteria</h3>
            {task.Criteria!.map((c, i) => (
              <div key={i} className={'crit ' + (c.ok ? 'ok' : 'pend')}>
                <span className="m">{c.ok ? '✓' : '○'}</span>{c.text}
              </div>
            ))}
          </div>
        )}

        {live && (
          <div className="dw-sec">
            <h3>Live</h3>
            <div className="term" ref={termRef}>{log || 'ожидание вывода…'}</div>
          </div>
        )}

        {stepRuns.length > 0 && (
          <div className="dw-sec">
            <h3>Участники шага{task?.Step ? ` · ${task.Step}` : ''}</h3>
            <div className="step-runs">
              {stepRuns.map(r => (
                <div key={r.id} className="step-run">
                  <span className="mono muted">{r.participant}</span>
                  <span>{r.kind === 'user' ? `человек ${r.user}` : `агент ${r.agent || 'любой'}${r.runner ? ` @ ${r.runner}` : ''}`}</span>
                  <span className={'chip' + (r.verdict ? ' v-' + r.verdict : '')}><span className="n">{r.verdict || 'ждёт'}</span></span>
                  {r.by && <span className="muted">{r.by}</span>}
                  {r.finished_at && <span className="mono muted">{timeShort(r.finished_at)}</span>}
                  {r.detail && <div className="step-run-detail">{r.detail}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="dw-sec">
            <h3>Сессии</h3>
            <div className="sess-list">
              {sessions.map(s => (
                <div key={s.id}>
                  <button className={'sess-row' + (openSess === s.id ? ' open' : '')}
                    onClick={() => showTranscript(s)}>
                    <span className="mono muted">#{s.attempt}</span>
                    <span className="sess-stage" style={{ color: stageColor(s.stage) }}>
                      {s.stage.toUpperCase()}
                    </span>
                    <span className="sess-agent">{s.agent}{s.model ? ` · ${s.model}` : ''}
                      {s.driver_kind === 'user' && <span className="muted"> · водитель: {s.driver_id}</span>}</span>
                    {s.private && <span className="chip" title="содержимое видно только автору"><span className="n">приватная</span></span>}
                    {s.depth === 'full' && <span className="chip" title="глубина данных подключения"><span className="n">full</span></span>}
                    <span className="mono">{sessDuration(s)}</span>
                    <span className="mono" title="токены">{fmtTokens(s.tokens)}</span>
                  </button>
                  {openSess === s.id && (
                    <div className="sess-files muted">
                      файлы: {s.private && s.files === null
                        ? 'содержимое скрыто приватностью сессии'
                        : s.files === null
                          ? 'недоступно для этого подключения'
                          : s.files.length === 0 ? 'нет' : <span className="mono">{s.files.join(', ')}</span>}
                    </div>
                  )}
                  {openSess === s.id && (
                    transcript === null
                      ? <div className="term sess-term">загрузка…</div>
                      : transcript === ''
                        ? <div className="term sess-term muted">
                            {s.private && s.files === null
                              ? 'содержимое скрыто приватностью сессии'
                              : 'транскрипт недоступен'}
                          </div>
                        : <div className="term sess-term">{transcript}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="dw-sec">
          <h3>Timeline</h3>
          <div className="tl">
            {timeline.map(e => {
              const step = stepOf(e)
              const bad = e.Type.includes('denied') || e.Type === 'task.merge_failed'
                || step?.ok === false || e.Text.includes('заблокирована')
              return (
                <div key={e.ID} className={'tl-row' + (bad ? ' bad' : '')
                    + (e.Type === 'task.review_passed' ? ' warn' : '')}>
                  <span className="t">{timeShort(e.TS)}</span>
                  {step?.tool ? (
                    <span>
                      <span className="chip"><span className="n">{step.tool}</span></span>
                      {' '}{step.detail || ''}
                      {(step.files?.length ?? 0) > 0 && (
                        <span className="mono muted">
                          {' '}{step.files!.slice(0, 3).join(', ')}{step.files!.length > 3 ? ` +${step.files!.length - 3}` : ''}
                        </span>
                      )}
                      {step.ok === false && ' — ошибка'}
                    </span>
                  ) : <span>{e.Text}<span className="muted">{overlapTail(e)}</span></span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
