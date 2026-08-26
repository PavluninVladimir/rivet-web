import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, budgetPaused, errCode, stColor, type EpicView, type Runner, type Task, type UsageRow } from '../api/client'
import { Dag, type DagFilter } from '../components/Dag'
import { TaskDrawer } from '../components/TaskDrawer'
import { ClaimControl, CtxBar, fmtCost, fmtDate, fmtDuration, fmtTokens, StBadge } from '../components/ui'
import { Button, Field, FormActions, FormNote, NumberInput, Select, TextArea, TextInput, errText, useBusy } from '../components/form'
import { useStore } from '../store'

const SEG_ORDER = ['done', 'running', 'testing', 'fixing', 'review', 'ready', 'queued', 'blocked', 'failed', 'cancelled']

export function EpicDashboard({ epicId, taskId }: { epicId: string; taskId?: string }) {
  const { nav, tick, attention, projects, refreshAttention } = useStore()
  const [epic, setEpic] = useState<EpicView | null>(null)
  const [runners, setRunners] = useState<Runner[]>([])
  const [mode, setMode] = useState<'graph' | 'list'>('graph')
  const [filter, setFilter] = useState<DagFilter>('all')
  const [hideDone, setHideDone] = useState(false)
  const [showCP, setShowCP] = useState(false)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  // Бюджет Epic (add-cost-transparency): черновик поля, null — не редактируется.
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.epic(epicId).then(setEpic).catch(e => setErr(String(e)))
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [epicId])
  useEffect(refresh, [refresh, tick])

  const tasks: Task[] = useMemo(() => epic?.tasks ?? [], [epic])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tasks) c[t.Status] = (c[t.Status] ?? 0) + 1
    return c
  }, [tasks])

  const openTask = (id: string) => nav({ view: 'epic', id: epicId, taskId: id })
  const closeTask = () => nav({ view: 'epic', id: epicId })

  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const act = (fn: () => Promise<unknown>) => async () => {
    if (busyRef.current) return
    busyRef.current = true; setErr(''); setBusy(true)
    try { await fn(); refresh() } catch (e) {
      // Модель не настроена или ключ отклонён: подсказываем, где это чинится
      // (api-contract add-operations-management).
      const code = errCode(e)
      const hint = code === 'no_planner' || code === 'planner_invalid'
        ? ' Администратор задаёт ключ модели в разделе «Управление приложением» → «Модели».' : ''
      setErr(String(e) + hint)
    } finally { busyRef.current = false; setBusy(false) }
  }

  if (!epic) return <div className="page">{err || 'Загрузка…'}</div>

  const total = tasks.reduce((s, t) => s + t.Estimate, 0) || 1
  const epicAtt = attention.filter(a => tasks.some(t => t.ID === a.TaskID))
  const online = runners.filter(r => r.Status !== 'offline')
  const usageByTask = new Map<string, UsageRow>((epic.usage ?? []).map(u => [u.key, u]))
  const usageTotal = epic.usage_total
  // Пауза планирования по дневному бюджету токенов — из DTO проекта
  // (спека web «Бюджет исчерпан»).
  const budget = projects.find(p => p.ID === epic.ProjectID)?.budget
  const est = epic.estimate
  const estStr = est?.available
    ? `${fmtTokens(est.tokens_min ?? 0)}–${fmtTokens(est.tokens_max ?? 0)} tok`
      + (est.cost_min != null && est.cost_max != null ? ` (~${fmtCost(est.cost_min)}–${fmtCost(est.cost_max)})` : '')
      + ` · по ${est.sample_tasks} задачам ${est.based_on === 'project' ? 'проекта' : 'установки'}`
    : est?.reason ?? ''
  const saveBudget = act(async () => {
    const v = (budgetEdit ?? '').trim()
    if (v !== '') {
      const n = Number(v)
      // NaN/Infinity в JSON превратились бы в null и сняли бы бюджет.
      if (!Number.isSafeInteger(n) || n < 1) throw new Error('бюджет — целое число токенов не меньше 1')
      await api.patchEpic(epic.ID, { token_budget: n })
    } else {
      await api.patchEpic(epic.ID, { token_budget: null })
    }
    setBudgetEdit(null)
  })

  return (
    <div className="view-epic">
      <div className="epic-head">
        <div className="epic-title-row">
          <span className="epic-id">EPIC</span>
          <h1>{epic.Title}</h1>
          <StBadge s={epic.Status} />
          <div className="epic-actions">
            {epic.Status === 'planned' && tasks.length === 0 &&
              <Button busy={busy} busyLabel="декомпозиция…" onClick={act(() => api.decompose(epic.ID))}>Декомпозировать</Button>}
            {epic.Status === 'planned' && <Button variant="primary" busy={busy} onClick={act(() => api.epicAction(epic.ID, 'start'))}>Запустить</Button>}
            {epic.Status === 'running' && <Button busy={busy} onClick={act(() => api.epicAction(epic.ID, 'pause'))}>Пауза</Button>}
            {epic.Status === 'paused' && <Button variant="primary" busy={busy} onClick={act(() => api.epicAction(epic.ID, 'resume'))}>Возобновить</Button>}
            {['planned', 'paused', 'done'].includes(epic.Status) &&
              <Button busy={busy} onClick={act(() => api.epicAction(epic.ID, 'archive'))}>Архивировать</Button>}
            {!['done', 'archived'].includes(epic.Status) &&
              <Button onClick={() => setAdding(true)}>Добавить задачу</Button>}
          </div>
        </div>
        <div className="epic-meta-row">
          <span className="pct">{epic.progress.pct}%</span>
          <div className="progress">
            {SEG_ORDER.filter(s => counts[s]).map(s => {
              const est = tasks.filter(t => t.Status === s).reduce((sum, t) => sum + t.Estimate, 0)
              return <i key={s} style={{ width: `${(est / total) * 100}%`, background: `var(${stColor[s] ?? '--c-queue'})` }} />
            })}
          </div>
          <span className="sub">{counts['done'] ?? 0} / {tasks.length} задач · взвешено по оценке</span>
          {tasks.length > 0 && (
            <span className="sub" title="Оценка стоимости плана по истории usage">
              оценка: {estStr}
            </span>
          )}
          <span className="sub row" style={{ gap: 6 }} title="Бюджет Epic в токенах; пусто — без бюджета">
            бюджет:{' '}
            {budgetEdit === null
              ? <>
                  <b>{epic.TokenBudget != null ? fmtTokens(epic.TokenBudget) : 'нет'}</b>
                  {epic.budget && epic.TokenBudget != null && <> · израсходовано {fmtTokens(epic.budget.used)}</>}
                  <Button variant="quiet" size="sm" aria-label="изменить бюджет" onClick={() => setBudgetEdit(epic.TokenBudget != null ? String(epic.TokenBudget) : '')}>✎</Button>
                </>
              : <>
                  <NumberInput className="f-sm" aria-label="бюджет в токенах" min={1} width={120} placeholder="без бюджета"
                    value={budgetEdit} onChange={e => setBudgetEdit(e.target.value)} />
                  <Button variant="primary" size="sm" busy={busy} onClick={saveBudget}>OK</Button>
                  <Button variant="quiet" size="sm" aria-label="отмена" onClick={() => setBudgetEdit(null)}>✕</Button>
                </>}
          </span>
          {usageTotal && (
            <span className="sub mono" title="Суммарный usage Epic: токены вход/выход · стоимость · время">
              {fmtTokens(usageTotal.tokens_in)} / {fmtTokens(usageTotal.tokens_out)} tok
              {' · '}{fmtCost(usageTotal.cost_usd)}
              {' · '}{fmtDuration(usageTotal.duration_s)}
            </span>
          )}
          <div className="epic-chips">
            {SEG_ORDER.filter(s => s !== 'done' && counts[s]).map(s => (
              <span key={s} className="chip">
                <span className="dot" style={{ background: `var(${stColor[s] ?? '--c-queue'})` }} />
                {s} <span className="n">{counts[s]}</span>
              </span>
            ))}
          </div>
        </div>
        {epic.budget?.exhausted && (
          <div className="budget-pause">
            Бюджет Epic исчерпан ({fmtTokens(epic.budget.used)} из {fmtTokens(epic.TokenBudget)}):
            новые стадии не назначаются, выполняющиеся дорабатываются. Поднимите или снимите бюджет, чтобы продолжить.
          </div>
        )}
        {budget && budgetPaused(budget) && (
          <div className="budget-pause">
            Планирование на паузе: {budget.paused_scope === 'installation'
              ? 'дневной бюджет токенов установки исчерпан'
              : <>дневной бюджет токенов проекта исчерпан ({fmtTokens(budget.used_today)} из {fmtTokens(budget.daily_tokens)})</>}.
            {' '}Выполняющиеся стадии дорабатываются, новые назначения возобновятся {fmtDate(budget.paused_until)}.
          </div>
        )}
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginTop: 6 }}>{err}</div>}
      </div>

      {epicAtt.length > 0 && (
        <div className="attention">
          <div className="attention-head"><h2>Требует внимания</h2><span className="n">{epicAtt.length}</span></div>
          <div className="attention-row">
            {epicAtt.slice(0, 3).map(a => {
              const t = tasks.find(x => x.ID === a.TaskID)
              return (
                <button key={a.ID} className="att-card" onClick={() => openTask(a.TaskID)}>
                  <div className="att-top"><span className="tid mono">task-{t?.Num ?? '?'}</span><span className="att-reason">{a.Reason}</span></div>
                  <div className="att-msg">{a.Message}</div>
                  <div className="att-act">
                    <ClaimControl id={a.ID} claimedBy={a.ClaimedBy} onClaimed={refreshAttention} />
                    {' '}Открыть →
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="epic-body">
        <div className="dag-panel">
          <div className="dag-toolbar">
            <div className="seg">
              <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Граф</button>
              <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>Список</button>
            </div>
            <div className="seg">
              {(['all', 'active', 'review', 'blocked', 'done'] as DagFilter[]).map(f => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {{ all: 'Все', active: 'Активные', review: 'Review', blocked: 'Блок', done: 'Готово' }[f]}
                </button>
              ))}
            </div>
            <button className={'tglbtn' + (hideDone ? ' on' : '')} onClick={() => setHideDone(h => !h)}>Скрыть завершённые</button>
            <button className={'tglbtn' + (showCP ? ' on' : '')} onClick={() => setShowCP(c => !c)}>Критический путь</button>
          </div>
          {mode === 'graph'
            ? <Dag tasks={tasks} filter={filter} hideDone={hideDone} showCP={showCP} selected={taskId} onSelect={openTask} />
            : (
              <div className="epic-list">
                <table className="tbl">
                  <thead><tr><th>Задача</th><th>Название</th><th>Статус</th><th>Runner</th><th className="num">Попытки</th><th className="num">Токены</th><th className="num">Стоимость</th></tr></thead>
                  <tbody>
                    {tasks.map(t => {
                      const u = usageByTask.get(t.ID)
                      return (
                        <tr key={t.ID} className="rowlink" onClick={() => openTask(t.ID)}>
                          <td className="id">task-{t.Num}</td>
                          <td>{t.Title}</td>
                          <td><StBadge s={t.Status} /></td>
                          <td className="mono muted">{t.RunnerID || '—'}</td>
                          <td className="num">{t.AttemptUsed}/{t.AttemptLimit}</td>
                          <td className="num mono muted">{u ? `${fmtTokens(u.tokens_in)} / ${fmtTokens(u.tokens_out)}` : '—'}</td>
                          <td className="num mono muted">{u ? fmtCost(u.cost_usd) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <aside className="rail">
          <div className="rail-head"><h2>Runner’ы</h2><span className="n">{online.length} online</span></div>
          <div className="rail-body">
            {online.map(r => (
              <div key={r.ID} className="runner-card">
                <div className="rc-top">
                  <span className="name">{r.ID}</span>
                  <span className="muted" style={{ fontSize: 10.5 }}>{r.Model || r.Agent}</span>
                  <StBadge s={r.Status} />
                </div>
                {r.TaskID && <div className="rc-action mono">{tasks.find(t => t.ID === r.TaskID) ? `task-${tasks.find(t => t.ID === r.TaskID)!.Num}` : 'занят'}</div>}
                {r.TaskID && <CtxBar pct={r.CtxPct} />}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {taskId && <TaskDrawer taskId={taskId} onClose={closeTask} onChanged={refresh}
        epicStatus={epic.Status} epicTasks={tasks} />}
      {adding && <AddTaskModal epicId={epic.ID} tasks={tasks} onClose={() => setAdding(false)} onAdded={refresh} />}
    </div>
  )
}

function AddTaskModal({ epicId, tasks, onClose, onAdded }: {
  epicId: string; tasks: Task[]; onClose: () => void; onAdded: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [criteria, setCriteria] = useState('')
  const [deps, setDeps] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, run] = useBusy()

  const create = () => run(async () => {
    setErr('')
    try {
      await api.addTask(epicId, {
        title, description,
        criteria: criteria.split('\n').map(s => s.trim()).filter(Boolean),
        deps,
      })
      onAdded(); onClose()
    } catch (e) { setErr(errText(e)) }
  })
  const titleErr = touched && !title.trim() ? 'Укажите название задачи' : undefined

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal f-form" onClick={e => e.stopPropagation()}>
        <h2>Новая задача</h2>
        <Field label="Название" error={titleErr}>
          {ids => <TextInput ids={ids} autoFocus placeholder="Название" value={title}
            onChange={e => setTitle(e.target.value)} onBlur={() => setTouched(true)} />}
        </Field>
        <Field label="Описание" hint="самодостаточное: агент не видит остальной план">
          {ids => <TextArea ids={ids} placeholder="Описание (самодостаточное — агент не видит остальной план)" rows={4}
            value={description} onChange={e => setDescription(e.target.value)} />}
        </Field>
        <Field label="Acceptance criteria" hint="по одному на строку" optional>
          {ids => <TextArea ids={ids} placeholder="Acceptance criteria — по одному на строку" rows={3}
            value={criteria} onChange={e => setCriteria(e.target.value)} />}
        </Field>
        {tasks.length > 0 && (
          <Field label="Зависимости" optional hint="Cmd/Ctrl для выбора нескольких">
            {ids => <Select ids={ids} multiple rows={Math.min(4, tasks.length)}
              value={deps} onChange={e => setDeps([...e.target.selectedOptions].map(o => o.value))}>
              {tasks.map(t => <option key={t.ID} value={t.ID}>task-{t.Num} · {t.Title}</option>)}
            </Select>}
          </Field>
        )}
        <FormActions note={<FormNote err={err || undefined} />}>
          <Button variant="quiet" onClick={onClose}>Отмена</Button>
          <Button variant="primary" busy={busy} busyLabel="создание…" disabled={!title.trim()} onClick={create}>Создать</Button>
        </FormActions>
      </div>
    </div>
  )
}
