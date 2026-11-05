import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, apiField, type Amount, type Decision, type EpicOverview, type Overview, type OverviewPeriod, type ShareRow, type User } from '../api/client'
import { ClaimControl, StBadge, fmtAgo, fmtCost, fmtDate, fmtDuration, fmtTokens } from '../components/ui'
import { Button, FormNote, errText } from '../components/form'
import { roleColorVar } from '../components/roleLabels'
import {
  DECISION_LABELS, OVERVIEW_PERIODS, amountTokens, browserTZ, decisionAction, decisionTarget, fmtNum, fmtShare, fmtWait,
  fromLocalInput, overviewEventRelevant, riskInfo, throttle, toLocalInput,
} from '../components/overviewLogic'
import { ReportModal } from './ReportModal'
import { useStore } from '../store'

// Обзор проекта для руководителя (спека web «Обзор проекта в консоли»,
// change add-project-lead-view). Экран собран из блоков прототипа:
// stat-strip, panel с заголовком капсом, two-col, attention-row и полоса
// прогресса дашборда Epic'а. Цифры считает сервер, экран их только
// раскладывает. Новых действий два: целевая дата Epic'а и ссылка на
// плановый бюджет, оба только владельцу.

const LIVE_MS = 5000

// Недоступное значение: «—» с подсказкой причины.
function NA({ why }: { why: string }) {
  return <span className="muted" title={why}>—</span>
}

// Ссылка-действие: кнопка в виде ссылки, доступна с клавиатуры.
function LinkButton({ onClick, title, className, children }: {
  onClick: () => void; title?: string; className?: string; children: ReactNode
}) {
  return <button type="button" className={'link' + (className ? ' ' + className : '')} title={title} onClick={onClick}>{children}</button>
}

// Сумма расхода: деньги, если есть стоимость, иначе токены.
function AmountValue({ a }: { a: Amount }) {
  if (a.cost_usd != null) {
    return (
      <span className="mono" title={a.partial_cost ? 'часть записей без стоимости: сумма неполная' : undefined}>
        {fmtCost(a.cost_usd)}{a.partial_cost && <span className="ov-warn">*</span>}
      </span>
    )
  }
  const tok = amountTokens(a)
  if (tok == null) return <NA why="нет записей расхода" />
  return <span className="mono" title="стоимость недоступна: у моделей нет цены">{fmtTokens(tok)} tok</span>
}

export function OverviewView({ period, user }: { period: OverviewPeriod; user: User }) {
  const { projectId, projects, nav, listen, connected, refreshAttention } = useStore()
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [tz, setTZ] = useState(browserTZ)
  const [isOwner, setIsOwner] = useState(false)
  const [report, setReport] = useState(false)
  const project = projects.find(p => p.ID === projectId)

  // Применяется ответ только последнего запроса: запоздавший ответ за
  // прежний период не возвращает старые цифры.
  const seq = useRef(0)
  const load = useCallback(() => {
    if (!projectId) return
    const n = ++seq.current
    api.overview(projectId, period, tz).then(o => {
      if (n !== seq.current) return
      setData(o); setErr(''); setMissing(false)
    }).catch(e => {
      if (n !== seq.current) return
      // Пояс браузера сервер не знает: обзор считается в UTC.
      if (apiField(e) === 'tz' && tz !== 'UTC') { setTZ('UTC'); return }
      if (e instanceof ApiError && e.status === 404) setMissing(true)
      setErr(errText(e))
    })
  }, [projectId, period, tz])
  useEffect(load, [load])

  // Живое обновление: события проекта склеиваются, обзор перечитывается не
  // чаще раза в 5 секунд и ещё раз после пачки.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => {
    const th = throttle(() => loadRef.current(), LIVE_MS)
    const off = listen(e => { if (overviewEventRelevant(e.Type)) th.call() })
    return () => { off(); th.cancel() }
  }, [listen])
  // После переподключения потока событий обзор перечитывается целиком.
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) load()
    wasConnected.current = connected
  }, [connected, load])

  useEffect(() => {
    if (!projectId) return
    api.members(projectId)
      .then(ms => setIsOwner((ms ?? []).some(m => m.login === user.login && m.role === 'owner')))
      .catch(() => setIsOwner(false))
  }, [projectId, user.login])

  // Задача без Epic'а в ответе (застрявшие, последняя попытка): Epic
  // берётся из деталки задачи.
  const openTask = useCallback((taskId: string, epicId?: string | null) => {
    if (epicId) { nav({ view: 'epic', id: epicId, taskId }); return }
    api.task(taskId).then(r => nav({ view: 'epic', id: r.task.EpicID, taskId })).catch(e => setErr(errText(e)))
  }, [nav])
  const openDecision = (d: Decision) => {
    const t = decisionTarget(d)
    if (!t) return
    if (t.view === 'environments' || t.view === 'policies') {
      if (projectId) nav({ view: 'project-settings', id: projectId, tab: t.view })
    } else nav(t)
  }

  if (!projectId) return <div className="page"><span className="muted">Нет проектов.</span></div>
  if (missing) return <div className="page"><span className="muted">Обзор проекта недоступен: {err}</span></div>

  // Ответ за прежний период под новым не показывается: до ответа за
  // выбранный период — загрузка (или ошибка).
  const shown = data && data.period.name === period ? data : null
  const s = shown?.summary
  // Колбэки берут актуальную загрузку: после смены периода они не
  // перечитывают прежний.
  const reload = () => loadRef.current()
  return (
    <div className="page ov">
      <div className="page-head">
        <h1>Обзор проекта</h1>
        <span className="sub">для руководителя проекта{project ? ` · ${project.Name}` : ''}</span>
        <div className="right">
          <div className="seg">
            {OVERVIEW_PERIODS.map(p => (
              <button key={p.id} className={p.id === period ? 'on' : ''} onClick={() => nav({ view: 'overview', period: p.id })}>{p.label}</button>
            ))}
          </div>
          <Button size="sm" onClick={() => setReport(true)}>Отчёт</Button>
        </div>
      </div>
      {err && <div style={{ marginBottom: 8 }}><FormNote err={err} /></div>}
      {!shown ? (err ? null : <span className="muted">Загрузка…</span>) : <>
        <div className="stat-strip">
          <div className="mini-stat"><div className="v">{s!.active_epics}</div><div className="l">Активные Epic’и</div></div>
          <div className="mini-stat"><div className="v">{s!.tasks_done}</div><div className="l">Задач завершено</div></div>
          <div className="mini-stat">
            <div className="v">{fmtNum(s!.throughput_per_day.tasks)}<em>/сут</em></div>
            <div className="l">Пропускная способность · {fmtNum(s!.throughput_per_day.units)} ед./сут</div>
          </div>
          <div className="mini-stat"><div className="v"><AmountValue a={s!.spend} /></div><div className="l">Расход за период</div></div>
          <div className="mini-stat"><div className="v">{s!.open_decisions}</div><div className="l">Открытых решений</div></div>
          <div className="mini-stat">
            <div className="v">{s!.first_pass_review_rate == null ? <NA why="в периоде не было review" /> : fmtShare(s!.first_pass_review_rate)}</div>
            <div className="l">Review с первого раза</div>
          </div>
        </div>

        <EpicCards epics={shown.epics ?? []} isOwner={isOwner} onChanged={reload}
          openEpic={id => nav({ view: 'epic', id })} openTask={openTask} />

        <DecisionsPanel data={shown} open={openDecision} onClaimed={() => { refreshAttention(); reload() }} />

        <div className="two-col">
          <TeamLoadPanel data={shown} />
          <MoneyPanel data={shown} isOwner={isOwner}
            openPolicy={() => nav({ view: 'project-settings', id: projectId, tab: 'policies' })} />
        </div>

        <DeliveryPanel data={shown} openTask={openTask} openEpic={id => nav({ view: 'epic', id })} />
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Расчёт на {fmtDate(shown.computed_at)} · пояс {shown.period.tz} · период {fmtDate(shown.period.from)} – {fmtDate(shown.period.to)}
        </div>
      </>}
      {report && <ReportModal projectId={projectId} tz={tz} onClose={() => setReport(false)} />}
    </div>
  )
}

// ─── карточки Epic'ов ────────────────────────────────────────────────────

function EpicCards({ epics, isOwner, onChanged, openEpic, openTask }: {
  epics: EpicOverview[]; isOwner: boolean; onChanged: () => void
  openEpic: (id: string) => void; openTask: (taskId: string, epicId?: string | null) => void
}) {
  if (!epics.length) {
    return <div className="panel" style={{ marginBottom: 12 }}><h3>Epic’и</h3><span className="muted">Активных Epic’ов и завершённых за период нет.</span></div>
  }
  return (
    <div className="ov-epics">
      {epics.map(e => <EpicCard key={e.id} e={e} isOwner={isOwner} onChanged={onChanged} openEpic={openEpic} openTask={openTask} />)}
    </div>
  )
}

function EpicCard({ e, isOwner, onChanged, openEpic, openTask }: {
  e: EpicOverview; isOwner: boolean; onChanged: () => void
  openEpic: (id: string) => void; openTask: (taskId: string, epicId?: string | null) => void
}) {
  const [edit, setEdit] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const risk = riskInfo(e.risk.status)
  const p = e.progress
  const pct = p.total_units > 0 ? Math.round(p.done_units / p.total_units * 100) : 0
  const f = e.forecast
  const save = async (due: string | null) => {
    setBusy(true); setErr('')
    try { await api.patchEpic(e.id, { due_at: due }); setEdit(null); onChanged() } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  const tokens = amountTokens(e.spend)
  return (
    <div className="ov-epic" data-epic={e.id} data-risk={e.risk.status} style={{ ['--risk' as string]: risk.color }}>
      <div className="top">
        <LinkButton className="title" onClick={() => openEpic(e.id)} title="дашборд Epic’а">{e.title}</LinkButton>
        <StBadge s={e.status} />
        {/* Системный Epic живёт вне плана: в графике он не бывает, риск
            виден, только когда есть причина. */}
        {e.system && <span className="chip sm" title="системный Epic: не входит в число активных и в прогноз">системный</span>}
        {(!e.system || (e.risk.reasons ?? []).length > 0) && <span className="ov-risk">{risk.label}</span>}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="mono" style={{ fontWeight: 600 }}>{pct}%</span>
        <div className="progress" title="взвешено по оценке задач"><i style={{ width: `${pct}%`, background: 'var(--c-done)' }} /></div>
      </div>
      <div className="meta">
        <span>{p.done_tasks} / {p.total_tasks} задач</span>
        <span>{fmtNum(p.done_units)} / {fmtNum(p.total_units)} ед.</span>
        <span><AmountValue a={e.spend} /></span>
        {e.token_budget != null && (
          <span title="бюджет Epic’а в токенах и прогноз расхода к завершению">
            бюджет {fmtTokens(tokens)} из {fmtTokens(e.token_budget)} tok
            {e.budget_forecast_tokens != null && <> · прогноз {fmtTokens(e.budget_forecast_tokens)}</>}
          </span>
        )}
      </div>
      <div className="meta">
        {e.status === 'done' ? <span>завершён</span>
          : e.system ? <span>прогноз не считается: системный Epic</span>
          : f.available && f.at
            ? <span title={`осталось ${fmtNum(f.remaining_units)} ед.`}>
                прогноз: <b>{fmtDate(f.at)}</b>
                {f.velocity_units_per_hour != null && <> · темп {fmtNum(f.velocity_units_per_hour, 2)} ед./ч по {f.velocity_source === 'epic' ? 'Epic’у' : 'проекту'}</>}
              </span>
            : <span>прогноз недоступен{f.reason ? `: ${f.reason}` : ''}</span>}
      </div>
      <div className="meta">
        {edit === null
          ? <>
              <span>срок: <b>{e.due_at ? fmtDate(e.due_at) : 'не задан'}</b></span>
              {isOwner && e.status !== 'done' && !e.system && (
                <Button variant="quiet" size="sm" aria-label="изменить целевую дату" onClick={() => setEdit(toLocalInput(e.due_at))}>✎</Button>
              )}
            </>
          : <>
              <input type="datetime-local" aria-label="целевая дата" value={edit} onChange={x => setEdit(x.target.value)} />
              <Button variant="primary" size="sm" busy={busy} disabled={!fromLocalInput(edit)} onClick={() => save(fromLocalInput(edit))}>OK</Button>
              {e.due_at && <Button size="sm" busy={busy} onClick={() => save(null)}>Снять</Button>}
              <Button variant="quiet" size="sm" aria-label="отмена" onClick={() => { setEdit(null); setErr('') }}>✕</Button>
            </>}
      </div>
      {(e.risk.reasons ?? []).length > 0 && (
        <ul className="ov-reasons">
          {(e.risk.reasons ?? []).map((r, i) => (
            <li key={i} data-reason={r.code}>
              <LinkButton onClick={() => r.task_id ? openTask(r.task_id, r.epic_id) : openEpic(r.epic_id)}>{r.text}</LinkButton>
            </li>
          ))}
        </ul>
      )}
      {err && <FormNote err={err} />}
    </div>
  )
}

// ─── нужны решения ───────────────────────────────────────────────────────

const DECISION_ORDER = ['plan_approval', 'escalation', 'merge_confirmation', 'my_step'] as const
const MAX_DECISIONS = 9

function DecisionsPanel({ data, open, onClaimed }: { data: Overview; open: (d: Decision) => void; onClaimed: () => void }) {
  const items = data.decisions.items ?? []
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, MAX_DECISIONS)
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Нужны решения</h3>
        {DECISION_ORDER.map(k => (
          <span key={k} className="chip" data-kind={k}>{DECISION_LABELS[k]} <span className="n">{data.decisions.counts[k] ?? 0}</span></span>
        ))}
      </div>
      {items.length === 0 ? <span className="muted">Решений не ждёт ничего.</span> : (
        <div className="attention-row">
          {shown.map((d, i) => (
            <div key={`${d.kind}-${d.attention_id ?? d.run_id ?? d.task_id ?? d.epic_id ?? i}`} className="att-card" role="button" tabIndex={0}
              data-kind={d.kind} onClick={() => open(d)}
              onKeyDown={x => { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); open(d) } }}>
              <div className="att-top">
                {d.task_num != null && <span className="tid mono">task-{d.task_num}</span>}
                <span className="att-reason">{d.reason ?? DECISION_LABELS[d.kind] ?? d.kind}</span>
              </div>
              <div className="att-msg">{d.title}</div>
              <div className="att-act">
                <span className="muted">ждёт {fmtWait(d.waiting_seconds)}</span>{' · '}
                {d.kind === 'escalation' && d.attention_id
                  ? <ClaimControl id={d.attention_id} claimedBy={d.claimed_by ?? ''} onClaimed={onClaimed} />
                  : null}
                {' '}{decisionAction(d)}
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > MAX_DECISIONS && (
        <Button size="sm" variant="quiet" style={{ marginTop: 8 }} onClick={() => setAll(a => !a)}>
          {all ? 'Свернуть' : `Ещё ${items.length - MAX_DECISIONS}`}
        </Button>
      )}
    </div>
  )
}

// ─── команда ─────────────────────────────────────────────────────────────

function TeamLoadPanel({ data }: { data: Overview }) {
  const { roles, throughput, quality } = data.team
  const conflicts = quality.merge_conflicts
  return (
    <div className="panel">
      <h3>Команда</h3>
      <table className="tbl">
        <thead><tr><th>Роль</th><th className="num">Сейчас</th><th className="num">Средняя занятость</th><th className="num">Сессии</th><th className="num">Время</th></tr></thead>
        <tbody>
          {(roles ?? []).map(r => (
            <tr key={r.role || '-'} data-role={r.role}>
              <td>
                <span className="chip role-chip sm" style={{ ['--rc' as string]: roleColorVar(r.color) }}>
                  <span className="dot" /><span className="n">{r.title || (r.role ? r.role : 'без роли')}</span>
                </span>
              </td>
              <td className="num">{r.busy_now}</td>
              <td className="num" title="среднее число занятых агентов роли за период">{fmtNum(r.avg_busy, 2)}</td>
              <td className="num">{r.sessions}</td>
              <td className="num">{fmtDuration(r.busy_seconds)}</td>
            </tr>
          ))}
          {(roles ?? []).length === 0 && <tr><td colSpan={5} className="muted">Ролей нет.</td></tr>}
        </tbody>
      </table>
      <div className="ov-sub">Пропускная способность</div>
      <div className="ov-kv">
        <span className="k">за период</span><span>{throughput.tasks_done} задач · {fmtNum(throughput.units_done)} ед.</span>
        <span className="k">в сутки</span><span>{fmtNum(throughput.per_day.tasks)} задач · {fmtNum(throughput.per_day.units)} ед.</span>
      </div>
      <div className="ov-sub">Качество</div>
      <div className="ov-kv">
        <span className="k">review с первого раза</span>
        <span>{quality.first_pass_review_rate == null ? <NA why="в периоде не было review" /> : fmtShare(quality.first_pass_review_rate)}</span>
        <span className="k">возвраты тестировщика</span><span>{quality.tester_returns}</span>
        <span className="k">возвраты ревьюера</span><span>{quality.reviewer_returns}</span>
        <span className="k">конфликты merge</span><span>{conflicts.returned} возвращено · {conflicts.done} разрешено</span>
        <span className="k">эскалации</span>
        <span className="rc-roles">
          {(quality.escalations ?? []).length === 0 ? <span className="muted">нет</span>
            : (quality.escalations ?? []).map(x => <span key={x.reason} className="chip"><span className="mono">{x.reason}</span> <span className="n">{x.count}</span></span>)}
        </span>
      </div>
    </div>
  )
}

// ─── деньги ──────────────────────────────────────────────────────────────

function ShareTable({ title, rows }: { title: string; rows: ShareRow[] }) {
  return (
    <>
      <div className="ov-sub">{title}</div>
      {rows.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>За период записей нет.</span> : (
        <table className="tbl">
          <tbody>
            {rows.map(r => (
              <tr key={r.key || '-'}>
                <td style={{ width: 150 }} className={title === 'По моделям' ? 'mono' : ''} title={r.key}>{r.title || (r.key ? r.key : 'без роли')}</td>
                <td>
                  <div className="bar-cell">
                    <div className="bar"><i style={{ width: `${Math.round((r.share ?? 0) * 100)}%` }} /></div>
                    <span className="mono muted" style={{ fontSize: 11 }} title={r.share == null ? 'у группы нет записей со стоимостью' : undefined}>{fmtShare(r.share)}</span>
                  </div>
                </td>
                <td className="num" style={{ width: 110 }}><AmountValue a={r.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

// Значение, посчитанное из суммы расхода: при неполной стоимости
// помечается так же, как сама сумма.
function Derived({ v, partial }: { v: number; partial: boolean }) {
  return (
    <span className="mono" title={partial ? 'посчитано из неполной суммы: часть записей без стоимости' : undefined}>
      {fmtCost(v)}{partial && <span className="ov-warn">*</span>}
    </span>
  )
}

function MoneyPanel({ data, isOwner, openPolicy }: { data: Overview; isOwner: boolean; openPolicy: () => void }) {
  const m = data.money
  const daily = m.daily_token_budget
  const planLink: ReactNode = isOwner
    ? <LinkButton className="accent" onClick={openPolicy}>{m.monthly_budget_usd != null ? 'изменить' : 'задать'} в политиках проекта</LinkButton>
    : null
  const partial = [m.today, m.last_7d, m.month_to_date, m.period].some(a => a.partial_cost)
  return (
    <div className="panel">
      <h3>Деньги</h3>
      <div className="ov-kv">
        <span className="k">сегодня</span><span><AmountValue a={m.today} /></span>
        <span className="k">7 суток</span><span><AmountValue a={m.last_7d} /></span>
        <span className="k">с начала месяца</span>
        <span>
          <AmountValue a={m.month_to_date} />
          {m.monthly_budget_usd != null && m.month_to_date.cost_usd != null && <span className="muted"> из {fmtCost(m.monthly_budget_usd)}</span>}
        </span>
        <span className="k">за период</span><span><AmountValue a={m.period} /></span>
        <span className="k">прогноз месяца</span>
        <span>
          {m.month_forecast_usd == null ? <NA why="нет стоимости за месяц" /> : <Derived v={m.month_forecast_usd} partial={m.month_to_date.partial_cost} />}
          {m.month_over_budget_usd != null && m.month_over_budget_usd > 0 && (
            <span className="ov-warn"> · выше плана на {fmtCost(m.month_over_budget_usd)}{m.month_to_date.partial_cost && '*'}</span>
          )}
        </span>
        <span className="k">плановый бюджет месяца</span>
        <span title="только для прогноза: работа по нему не останавливается">
          {m.monthly_budget_usd != null ? <span className="mono">{fmtCost(m.monthly_budget_usd)}</span> : <span className="muted">не задан</span>}
          {planLink && <> · {planLink}</>}
        </span>
        <span className="k">дневной бюджет токенов</span>
        <span>
          {daily
            ? <span className="mono">{fmtTokens(daily.used_today)} из {fmtTokens(daily.budget)}</span>
            : <span className="muted">без ограничения</span>}
        </span>
        <span className="k">в среднем на задачу</span>
        <span>{m.avg_cost_per_task == null ? <NA why="нет завершённых задач со стоимостью" /> : <Derived v={m.avg_cost_per_task} partial={m.period.partial_cost} />}</span>
      </div>
      {partial && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}><span className="ov-warn">*</span> часть записей без стоимости: сумма неполная.</div>}
      <ShareTable title="По ролям" rows={m.by_role ?? []} />
      <ShareTable title="По моделям" rows={m.by_model ?? []} />
    </div>
  )
}

// ─── поставки и риски ────────────────────────────────────────────────────

function DeliveryPanel({ data, openTask, openEpic }: {
  data: Overview; openTask: (taskId: string, epicId?: string | null) => void; openEpic: (id: string) => void
}) {
  const d = data.delivery
  const envs = d.environments ?? []
  const envName = (id: string) => envs.find(e => e.id === id)?.name ?? id
  const deps = d.deployments ?? []
  const stuck = d.stuck ?? []
  const last = d.last_attempt ?? []
  const risks = d.budget_risks ?? []
  return (
    <div className="panel">
      <h3>Поставки и риски</h3>
      <div className="two-col" style={{ marginBottom: 0 }}>
        <div>
          <div className="ov-sub" style={{ marginTop: 0 }}>Окружения</div>
          <div className="ov-list">
            {envs.length === 0 && <span className="muted">Окружений нет.</span>}
            {envs.map(e => (
              <div className="it" key={e.id}>
                <b>{e.name}</b>
                {e.last
                  ? <><span className="mono t">{e.last.version}</span><StBadge s={e.last.status} />
                      {e.last.rollback && <span className="ov-warn">откат</span>}
                      <span className="muted">{fmtAgo(e.last.ended_at ?? e.last.created_at)}</span></>
                  : <span className="muted">выкаток не было</span>}
              </div>
            ))}
          </div>
          <div className="ov-sub">Выкатки за период</div>
          <div className="ov-list">
            {deps.length === 0 && <span className="muted">Выкаток не было.</span>}
            {deps.map(x => (
              <div className="it" key={x.id}>
                <span className="muted mono">{fmtDate(x.created_at)}</span>
                <span>{envName(x.env_id)}</span>
                <span className="mono t">{x.version}</span>
                <StBadge s={x.status} />
                {x.rollback && <span className="ov-warn">откат</span>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="ov-sub" style={{ marginTop: 0 }}>Застрявшие задачи</div>
          <div className="ov-list">
            {stuck.length === 0 && <span className="muted">Нет.</span>}
            {stuck.map(t => (
              <div className="it" key={t.task_id}>
                <LinkButton className="mono" onClick={() => openTask(t.task_id)}>task-{t.task_num}</LinkButton>
                <span className="t">{t.title}</span>
                <StBadge s={t.status} />
                <span className="muted">{t.waiting_runner ? 'ждёт runner' : `событие ${fmtAgo(t.last_event_at)}`}</span>
              </div>
            ))}
          </div>
          <div className="ov-sub">Последняя попытка</div>
          <div className="ov-list">
            {last.length === 0 && <span className="muted">Нет.</span>}
            {last.map(t => (
              <div className="it" key={t.task_id}>
                <LinkButton className="mono" onClick={() => openTask(t.task_id)}>task-{t.task_num}</LinkButton>
                <span className="t">{t.title}</span>
                <span className="mono ov-warn">{t.attempt_used} / {t.attempt_limit}</span>
              </div>
            ))}
          </div>
          <div className="ov-sub">Риски бюджета</div>
          <div className="ov-list">
            {risks.length === 0 && <span className="muted">Нет.</span>}
            {risks.map(r => (
              <div className="it" key={r.epic_id}>
                <LinkButton className="t" onClick={() => openEpic(r.epic_id)}>{r.title}</LinkButton>
                <span className="mono ov-warn">прогноз {fmtTokens(r.budget_forecast_tokens)} из {fmtTokens(r.token_budget)} tok</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
