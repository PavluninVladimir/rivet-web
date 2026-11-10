import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ApiError, api, type CycleAgent, type CycleArtifact, type CycleItem, type CyclePeriod, type CyclePhase, type CyclePhaseId, type CycleView as View, type Environment, type Event, type Incident, type ModelChoice, type Release, type TeamAgent } from '../api/client'
import { BugRef } from '../components/BugRef'
import { useStore, type NavTarget, type Route } from '../store'
import { useMedia } from '../components/useMedia'
import { ARTIFACT_KIND, BACK_ARCS, CENTER, PHASES, PHASE_COLOR, PHASE_TITLE, RADIUS, VIEW, artifactTarget, workTarget, type ArtifactTarget, backLabelPoint, backPath, eventPhase, forwardArc, isCycleEvent, liveTransitions, nodePercent, travelPath } from '../components/cycleGeometry'
import { modelOptions, saveAgentModel } from '../components/TeamPanel'
import { roleColorVar, tripleKey } from '../components/roleLabels'
import { Button, Select, errText } from '../components/form'
import { fmtAgo, fmtCost, fmtTokens, timeShort } from '../components/ui'
import { FeedbackForm } from '../components/FeedbackForm'
import { unaccountedText } from '../components/discovery'

// Экран «Цикл разработки» (add-sdlc-cycle, спека web «Представление «Цикл
// разработки»»): кольцо восьми фаз с агентами и счётчиками, движение
// задач по событиям phase_from/phase_to, панель выбранной фазы и лента
// событий цикла. Фазы считает бэкенд, клиент только рисует.

const PERIODS: { id: CyclePeriod; label: string }[] = [
  { id: 'today', label: 'сегодня' }, { id: '7d', label: '7 дней' }, { id: '30d', label: '30 дней' },
]
const REFETCH_MS = 3000
const MOVE_MS = 600

const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?'

const STATE_LABEL: Record<CycleAgent['state'], string> = {
  working: 'работает', idle: 'свободен', disabled: 'выключен', no_runner: 'нет runner’а',
}
const ITEM_STATE: Record<string, string> = { active: 'в работе', waiting: 'ждёт', needs_human: 'нужен человек' }
const BADGE: Record<string, string> = { bug: 'баг', awaiting_release: 'ожидает релиза', rollback: 'откат' }

// Метка, бегущая по пути перехода.
interface Marker { key: number; path: string; color: string }

// Метка скрыта, пока анимация не запущена, и запускается до первой
// отрисовки (layout effect): кадра в (0,0) нет. Без SMIL метка просто не
// появляется.
function MovingDot({ m }: { m: Marker }) {
  const ref = useRef<SVGAnimateMotionElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  useLayoutEffect(() => {
    const anim = ref.current
    if (!anim || typeof anim.beginElement !== 'function') return
    anim.beginElement()
    if (dot.current) dot.current.style.opacity = '1'
  }, [])
  return (
    <circle ref={dot} r={9} className="cycle-dot" style={{ fill: m.color, opacity: 0 }}>
      <animateMotion ref={ref} dur={`${MOVE_MS}ms`} begin="indefinite" fill="freeze" path={m.path} />
    </circle>
  )
}

export function CycleView({ projectId, phase, period = '7d', admin }: {
  projectId: string; phase?: CyclePhaseId; period?: CyclePeriod; admin: boolean
}) {
  const { nav, eventTick, connects, recent } = useStore()
  // События этого проекта: после «Назад» поток стора мог остаться на другом.
  const mine = useMemo(() => recent.filter(e => e.ProjectID === projectId), [recent, projectId])
  const [view, setView] = useState<View | null>(null)
  const [err, setErr] = useState('')
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const narrow = useMedia('(max-width: 900px)')
  const go = useCallback((patch: Partial<Extract<Route, { view: 'cycle' }>>, replace = false) =>
    nav({ view: 'cycle', pid: projectId, phase, period, ...patch }, { replace }), [nav, projectId, phase, period])

  // Перечитывание агрегата не чаще раза в 3 секунды после событий проекта
  // и сразу после любого подключения потока (первого, повторного, к этому
  // проекту): поток историю не проигрывает. Смена периода снимает
  // отложенное перечитывание прежнего, ответ на другой период отбрасывается.
  const seq = useRef(0)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadRef = useRef<() => void>(() => {})
  // skew — поправка часов клиента к серверу по generated_at агрегата:
  // «живое» событие считается по времени сервера, а не клиента.
  const skew = useRef(0)
  const load = useCallback(() => {
    const n = ++seq.current
    last.current = Date.now()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    api.cycle(projectId, period, tz)
      .then(v => {
        if (n !== seq.current || v.period !== period) return
        const server = Date.parse(v.generated_at)
        if (Number.isFinite(server)) skew.current = server - Date.now()
        setView(v); setErr('')
      })
      .catch(e => {
        if (n !== seq.current) return
        setErr(e instanceof ApiError && e.status === 404 && e.code !== 'not_found'
          ? 'Бэкенд не поддерживает цикл разработки: обновите rivetd.' : errText(e))
      })
  }, [projectId, period])
  loadRef.current = load
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    load()
  }, [load, connects])
  // Перечитывание по событиям проекта (не по чанкам логов); первое
  // срабатывание при монтировании пропускается — агрегат уже грузится.
  const armed = useRef(false)
  useEffect(() => {
    if (!armed.current) { armed.current = true; return }
    if (timer.current) return
    const wait = Math.max(0, REFETCH_MS - (Date.now() - last.current))
    timer.current = setTimeout(() => { timer.current = null; loadRef.current() }, wait)
  }, [eventTick])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Лента: последние события цикла из истории и потока.
  const [history, setHistory] = useState<Event[]>([])
  // seen — последнее событие, которое уже было на экране: история и реплей
  // потока при подключении не анимируются.
  const seen = useRef<number>(Number.MAX_SAFE_INTEGER)
  useEffect(() => {
    seen.current = Number.MAX_SAFE_INTEGER
    api.events({ project: projectId, latest: true, limit: 200 })
      .then(r => {
        const list = r ?? []
        setHistory(list)
        seen.current = Math.max(0, ...list.map(e => e.ID), ...recentRef.current.map(e => e.ID))
      })
      // Без истории граница неизвестна: анимации нет до следующей удачной
      // загрузки (следующее подключение потока).
      .catch(() => setHistory([]))
  }, [projectId, connects])
  const recentRef = useRef(mine)
  recentRef.current = mine

  // Движение по событиям с phase_from и phase_to: метки живут MOVE_MS и
  // снимаются своими таймерами, а не при каждом новом событии.
  const [markers, setMarkers] = useState<Marker[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const fresh = liveTransitions(mine, seen.current, Date.now() + skew.current)
    if (fresh.length) seen.current = Math.max(seen.current, ...fresh.map(t => t.id))
    else if (mine[0] && mine[0].ID > seen.current && seen.current !== Number.MAX_SAFE_INTEGER) seen.current = mine[0].ID
    if (!fresh.length || reduced || narrow || !view) return
    const add: Marker[] = []
    for (const t of fresh) {
      const path = travelPath(t.from, t.to)
      if (path) add.push({ key: t.id, path, color: PHASE_COLOR[t.to ?? t.from!] })
    }
    if (!add.length) return
    setMarkers(ms => [...ms, ...add].slice(-12))
    for (const m of add) {
      timers.current.set(m.key, setTimeout(() => {
        timers.current.delete(m.key)
        setMarkers(ms => ms.filter(x => x.key !== m.key))
      }, MOVE_MS + 150))
    }
  }, [mine, reduced, narrow, view])
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])
  // Лента копит события цикла из потока сама: в recent стора их вытесняют
  // шаги сессий, и середина ленты пропадала бы.
  const [live, setLive] = useState<Event[]>([])
  useEffect(() => {
    const add = mine.filter(e => isCycleEvent(e.Type, e.Payload))
    if (!add.length) return
    setLive(cur => {
      const byId = new Map(cur.map(e => [e.ID, e]))
      for (const e of add) byId.set(e.ID, e)
      return [...byId.values()].sort((a, b) => b.ID - a.ID).slice(0, 20)
    })
  }, [mine])
  const feed = useMemo(() => {
    const byId = new Map<number, Event>()
    for (const e of [...live, ...history]) if (!byId.has(e.ID) && isCycleEvent(e.Type, e.Payload)) byId.set(e.ID, e)
    return [...byId.values()].sort((a, b) => b.ID - a.ID).slice(0, 20)
  }, [live, history])

  const phases = view?.phases ?? []
  const sel = phases.find(p => p.id === phase)
  const select = (id: CyclePhaseId | undefined, replace = false) => go({ phase: id }, replace)
  // Закрытие панели возвращает фокус на узел фазы.
  const close = () => {
    const was = phase
    select(undefined)
    if (was) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-phase-node="${was}"]`)?.focus())
  }
  const onNodeKey = (e: ReactKeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      e.preventDefault()
      const next = PHASES[(i + step + PHASES.length) % PHASES.length]
      // Перебор стрелками не пишет историю браузера.
      select(next, true)
      document.querySelector<HTMLButtonElement>(`[data-phase-node="${next}"]`)?.focus()
    }
    if (e.key === 'Escape') close()
  }
  // Данные панелей релиза и сопровождения: релизы с release notes,
  // активные инциденты и наблюдение окружений. Перечитываются вместе с
  // агрегатом.
  const extra = usePhaseExtra(projectId, phase, view?.generated_at)

  return (
    <div className={'page cycle-page' + (narrow ? ' narrow' : '')}>
      <div className="page-head">
        <h1>Цикл разработки</h1>
        <div className="right cycle-periods" role="group" aria-label="период">
          {PERIODS.map(p => (
            <button key={p.id} className={'chip' + (p.id === period ? ' on' : '')} aria-pressed={p.id === period}
              onClick={() => go({ period: p.id })}>{p.label}</button>
          ))}
        </div>
      </div>
      {err && <div className="f-error" role="alert">{err}</div>}
      {!view && !err && <div className="muted">Загрузка…</div>}
      {view && (
        <div className={'cycle-layout' + (sel ? ' with-panel' : '')}>
          <div className="cycle-main">
            {narrow
              ? <CycleList phases={phases} selected={phase} onSelect={select} />
              : (
                <div className="cycle-ring">
                  <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="cycle-svg" aria-hidden="true">
                    <defs>
                      <marker id="cyc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" className="cyc-arrowhead" />
                      </marker>
                    </defs>
                    <circle cx={CENTER} cy={CENTER} r={RADIUS} className="cycle-track" />
                    {PHASES.map((_, i) => <path key={i} d={forwardArc(i)} className="cycle-fwd" markerEnd="url(#cyc-arrow)" />)}
                    {BACK_ARCS.map(a => {
                      const lp = backLabelPoint(a.from, a.to)
                      return (
                        <g key={a.from + a.to} className={'cycle-back b-' + a.from}>
                          <path d={backPath(a.from, a.to)} markerEnd="url(#cyc-arrow)" />
                          {a.label && <text x={lp.x} y={lp.y} textAnchor="middle">{a.label}</text>}
                        </g>
                      )
                    })}
                    {!reduced && markers.map(m => <MovingDot key={m.key} m={m} />)}
                  </svg>
                  {phases.map((p, i) => (
                    <PhaseNode key={p.id} p={p} selected={p.id === phase} pos={nodePercent(i)}
                      incident={p.id === 'operations' && view.summary.incidents_open > 0}
                      onClick={() => select(p.id === phase ? undefined : p.id)} onKey={e => onNodeKey(e, i)} />
                  ))}
                  <CycleCenter view={view} />
                </div>
              )}
            {narrow && <CycleCenter view={view} flat />}
            <CycleFeed events={feed} />
          </div>
          {sel && <PhasePanel p={sel} projectId={projectId} admin={admin} extra={extra} onClose={close} onChanged={load} />}
        </div>
      )}
    </div>
  )
}

function AgentDots({ agents }: { agents: CycleAgent[] }) {
  const { roleOf } = useStore()
  if (!agents.length) return null
  return (
    <span className="cyc-agents">
      {agents.slice(0, 5).map(a => (
        <span key={a.agent_id} className={'cyc-agent s-' + a.state} title={`${a.name} · ${STATE_LABEL[a.state]}`}
          aria-label={`${a.name}: ${STATE_LABEL[a.state]}`}
          style={{ ['--rc' as string]: roleColorVar(roleOf(a.role_id)?.color) }}>
          {initials(a.name)}{a.state === 'no_runner' && <span className="cyc-warn" aria-hidden="true">!</span>}
        </span>
      ))}
      {agents.length > 5 && <span className="cyc-more">+{agents.length - 5}</span>}
    </span>
  )
}

function PhaseNode({ p, selected, pos, incident, onClick, onKey }: {
  p: CyclePhase; selected: boolean; pos: { left: string; top: string }; incident: boolean
  onClick: () => void; onKey: (e: ReactKeyboardEvent) => void
}) {
  const c = p.counters
  const total = c.active + c.waiting + c.needs_human
  return (
    <button className={'cycle-node' + (selected ? ' on' : '') + (p.no_data ? ' nodata' : '') + (incident ? ' incident' : '')}
      data-phase-node={p.id} style={{ ...pos, ['--ph' as string]: incident ? 'var(--c-fail)' : PHASE_COLOR[p.id] }}
      aria-pressed={selected}
      aria-label={p.no_data ? `${p.title}: нет данных, ${p.hint ?? ''}`
        : `${p.title}: в работе ${c.active}, ждут ${c.waiting}, нужен человек ${c.needs_human}${incident ? ', есть открытые инциденты' : ''}${(p.feedback_unaccounted ?? 0) > 0 ? ', ' + unaccountedText(p.feedback_unaccounted!) : ''}`}
      onClick={onClick} onKeyDown={onKey}>
      <span className="cn-title">{p.title}{incident && <span className="cn-alert" aria-hidden="true"> ⚠</span>}</span>
      {p.no_data
        ? <><span className="cn-nodata">нет данных</span>{p.hint && <span className="cn-hint">{p.hint}</span>}</>
        : <span className="cn-count mono">{total}<small> · {c.done_period} за период</small></span>}
      {(p.feedback_unaccounted ?? 0) > 0 && <span className="cn-feedback">{unaccountedText(p.feedback_unaccounted!)}</span>}
      {c.needs_human > 0 && <span className="cn-human" title="нужен человек">{c.needs_human}</span>}
      <AgentDots agents={p.agents} />
      {p.template_only && p.agents.length === 0 && <span className="cn-template">по шаблону</span>}
    </button>
  )
}

function CycleCenter({ view, flat }: { view: View; flat?: boolean }) {
  const s = view.summary
  return (
    <div className={'cycle-center' + (flat ? ' flat' : '')}>
      <div className="cc-stat"><b className="mono">{s.agents_working}</b><span>из {s.agents_total} агентов в работе</span></div>
      <div className={'cc-stat' + (s.incidents_open ? ' bad' : '')}><b className="mono">{s.incidents_open}</b><span>инцидентов</span></div>
      <div className="cc-stat">
        <b className="mono">{s.last_release ? s.last_release.version.slice(0, 8) : '—'}</b>
        <span>{s.last_release ? `релиз ${s.last_release.env_name} · ${fmtAgo(s.last_release.created_at)}` : 'релизов не было'}</span>
      </div>
      <div className="cc-stat"><b className="mono">{fmtCost(s.spend_usd)}</b><span>{fmtTokens(s.tokens)} токенов</span></div>
    </div>
  )
}

// Узкий экран: фазы списком сверху вниз и стрелка возврата от
// сопровождения к исследованию.
function CycleList({ phases, selected, onSelect }: { phases: CyclePhase[]; selected?: CyclePhaseId; onSelect: (id?: CyclePhaseId) => void }) {
  return (
    <ol className="cycle-list">
      {phases.map(p => {
        const c = p.counters
        return (
          <li key={p.id} style={{ ['--ph' as string]: PHASE_COLOR[p.id] }}>
            <button className={'cl-row' + (p.id === selected ? ' on' : '')} aria-pressed={p.id === selected} data-phase-node={p.id}
              onClick={() => onSelect(p.id === selected ? undefined : p.id)}>
              <span className="cl-dot" />
              <span className="cl-title">{p.title}</span>
              {p.no_data ? <span className="muted">нет данных</span>
                : <span className="mono">{c.active + c.waiting + c.needs_human}</span>}
              {(p.feedback_unaccounted ?? 0) > 0 && <span className="cn-feedback">{unaccountedText(p.feedback_unaccounted!)}</span>}
              {c.needs_human > 0 && <span className="cn-human">{c.needs_human}</span>}
              <AgentDots agents={p.agents} />
            </button>
          </li>
        )
      })}
      <li className="cl-back" aria-label="возврат к исследованию">↺ отзывы и инциденты возвращаются в исследование и разработку</li>
    </ol>
  )
}

function CycleFeed({ events }: { events: Event[] }) {
  return (
    <section className="panel cycle-feed">
      <div className="panel-head"><h2>События цикла</h2></div>
      {events.length === 0 && <div className="muted" style={{ padding: 10 }}>Событий пока нет.</div>}
      <ul>
        {events.map(e => {
          const ph = eventPhase(e.Type, e.Payload)
          return (
            <li key={e.ID} style={{ ['--ph' as string]: ph ? PHASE_COLOR[ph] : 'var(--muted)' }}>
              <span className="cf-dot" />
              <span className="mono muted">{timeShort(e.TS)}</span>
              {ph && <span className="cf-phase">{PHASE_TITLE[ph]}</span>}
              <span className="cf-text">{e.Text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── панель фазы ─────────────────────────────────────────────────────────

// useOpenTarget — переход по ссылке артефакта или текущей работы агента.
// Решение ADR открывается в реестре со всеми статусами: заменённое или
// отклонённое решение иначе было бы скрыто фильтром по умолчанию.
function useOpenTarget(): (t: ArtifactTarget | null) => void {
  const { nav } = useStore()
  return (t) => {
    switch (t?.kind) {
      case 'external': window.open(t.url, '_blank', 'noopener,noreferrer'); break
      case 'epic': nav({ view: 'epic', id: t.id }); break
      case 'task': api.task(t.id).then(r => nav({ view: 'epic', id: r.task.EpicID, taskId: t.id })).catch(() => nav({ view: 'tasks' })); break
      case 'release': nav({ view: 'releases', id: t.id }); break
      case 'incident': nav({ view: 'incidents', id: t.id }); break
      case 'discovery': nav(t.runId ? { view: 'discovery', runId: t.runId } : { view: 'discovery' }); break
      case 'architecture': nav({ view: 'architecture', tab: 'hld' }); break
      case 'adr': nav({ view: 'architecture', tab: 'decisions', sub: t.number, status: 'all' }); break
    }
  }
}

function PhasePanel({ p, projectId, admin, extra, onClose, onChanged }: {
  p: CyclePhase; projectId: string; admin: boolean; extra: PhaseExtra; onClose: () => void; onChanged: () => void
}) {
  const { nav, href, overviewAvailable } = useStore()
  const openTask = (taskId: string) => {
    api.task(taskId).then(r => nav({ view: 'epic', id: r.task.EpicID, taskId })).catch(() => nav({ view: 'tasks' }))
  }
  const open = (it: CycleItem) => {
    if (it.kind === 'task') { if (it.epic_id) nav({ view: 'epic', id: it.epic_id, taskId: it.id }); else openTask(it.id) }
    else if (it.kind === 'epic') nav({ view: 'epic', id: it.id })
    else if (it.kind === 'incident') nav({ view: 'incidents', id: it.id })
    // Версия анализа и материал исследования ведут в «Исследование»
    // (add-product-discovery).
    else if (it.kind === 'analysis') nav({ view: 'discovery', runId: it.id })
    else if (it.kind === 'material') nav({ view: 'discovery' })
    else if (it.kind === 'deployment' || it.kind === 'environment') nav({ view: 'project-settings', pid: projectId, tab: 'environments' })
  }
  const openTarget = useOpenTarget()
  const openArt = (a: CycleArtifact) => openTarget(artifactTarget(a.ref))
  const links: { label: string; to: NavTarget }[] = []
  if (p.id === 'discovery') links.push({ label: 'Исследование', to: { view: 'discovery' } })
  if (p.id === 'architecture') links.push({ label: 'Архитектура', to: { view: 'architecture', tab: 'hld' } })
  if (p.id === 'planning' || p.id === 'development' || p.id === 'testing' || p.id === 'review') {
    links.push({ label: 'Epic’и проекта', to: { view: 'epics' } })
    if (overviewAvailable) links.push({ label: 'Обзор', to: { view: 'overview', period: '7d' } })
  }
  if (p.id === 'release') links.push({ label: 'Релизы', to: { view: 'releases' } }, { label: 'Окружения', to: { view: 'project-settings', pid: projectId, tab: 'environments' } })
  if (p.id === 'operations') links.push({ label: 'Инциденты', to: { view: 'incidents' } }, { label: 'Наблюдение окружений', to: { view: 'project-settings', pid: projectId, tab: 'environments' } })
  const c = p.counters
  return (
    <aside className="cycle-panel" style={{ ['--ph' as string]: PHASE_COLOR[p.id] }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }} aria-label={`Фаза ${p.title}`}>
      <div className="cp-head">
        <span className="cl-dot" />
        <h2>{p.title}</h2>
        <Button variant="quiet" size="sm" aria-label="закрыть панель фазы" onClick={onClose}>✕</Button>
      </div>
      {p.no_data
        ? <div className="muted cp-hint">Нет данных: {p.hint}</div>
        : <div className="cp-counters">
            <span><b className="mono">{c.active}</b> в работе</span>
            <span><b className="mono">{c.waiting}</b> ждут</span>
            <span className={c.needs_human ? 'bad' : ''}><b className="mono">{c.needs_human}</b> нужен человек</span>
            <span><b className="mono">{c.done_period}</b> за период</span>
            {(p.feedback_unaccounted ?? 0) > 0 && <span className="cp-feedback">{unaccountedText(p.feedback_unaccounted!)}</span>}
          </div>}

      <section className="dw-sec">
        <h3>Агенты</h3>
        {p.agents.length === 0 && <div className="muted">{p.template_only ? 'В команде нет агентов роли: фаза работает по шаблону.' : 'Агентов нет.'}</div>}
        {p.agents.map(a => <CycleAgentCard key={a.agent_id} a={a} admin={admin} />)}
      </section>

      <section className="dw-sec">
        <h3>Сейчас</h3>
        {p.items.length === 0 && <div className="muted">Активных элементов нет.</div>}
        <ul className="cp-items">
          {p.items.map(it => {
            const body = <>
              <span className={'cp-state s-' + it.state}>{ITEM_STATE[it.state] ?? it.state}</span>
              {it.num ? <span className="mono">task-{it.num}</span> : null}
              <span className="cp-title">{it.title}</span>
              {it.badge && <span className={'chip sm badge-' + it.badge}>{BADGE[it.badge] ?? it.badge}</span>}
              <span className="muted mono">{fmtAgo(it.since)}</span>
            </>
            return (
              <li key={it.kind + it.id}>
                <button className={'cp-item st-' + it.state} onClick={() => open(it)}>{body}</button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Отзыв пользователя (add-user-feedback): возвращается в бэклог
          исследования, счётчик неучтённых растёт сразу после сохранения. */}
      {p.id === 'discovery' && (
        <section className="dw-sec">
          <h3>Отзыв пользователя</h3>
          <FeedbackForm projectId={projectId} compact onAdded={onChanged} />
        </section>
      )}

      {p.id === 'release' && <ReleasesBlock releases={extra.releases} err={extra.errors.releases} />}
      {p.id === 'operations' && <OperationsBlock extra={extra} />}

      <section className="dw-sec">
        <h3>Материалы</h3>
        {p.artifacts.length === 0 && <div className="muted">Пока пусто.</div>}
        <ul className="cp-items">
          {p.artifacts.map(a => {
            const body = <>
              <span className="chip sm">{ARTIFACT_KIND[a.kind] ?? a.kind}</span>
              <span className="cp-title">{a.title}</span>
              <span className="muted mono">{fmtAgo(a.at)}</span>
            </>
            const can = artifactTarget(a.ref) !== null
            return (
              <li key={a.kind + a.id}>
                {can ? <button className="cp-item" onClick={() => openArt(a)}>{body}</button> : <div className="cp-item">{body}</div>}
              </li>
            )
          })}
        </ul>
        {links.length > 0 && (
          <div className="cp-links">
            {links.map(l => <a key={l.label} className="tlink" href={href(l.to)}>{l.label} →</a>)}
          </div>
        )}
      </section>
    </aside>
  )
}

// Карточка агента фазы: модель меняет администратор механизмом команды
// агентов (add-agent-roles), с предупреждением о вариантах без runner'а.
function CycleAgentCard({ a, admin }: { a: CycleAgent; admin: boolean }) {
  const { team, roleOf, refreshTeam } = useStore()
  const role = roleOf(a.role_id)
  const member: TeamAgent | undefined = team.find(t => t.id === a.agent_id)
  const [choices, setChoices] = useState<ModelChoice[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const cp = role?.control_plane ?? !role?.capability
  const opts = choices ? modelOptions(choices, cp) : []
  const cur = member ? (cp ? tripleKey({ agent: '', connection_id: member.connection_id, model: member.model }) : tripleKey(member)) : ''
  const pendingOpt = opts.find(o => o.key === pending)
  const openEditor = () => {
    setEditing(true); setErr(''); setPending(cur)
    api.modelChoices().then(r => setChoices(r?.choices ?? [])).catch(e => setErr(errText(e)))
  }
  const save = async () => {
    if (!member) return
    setBusy(true); setErr('')
    try { await saveAgentModel(member, pending); refreshTeam(); setEditing(false) }
    catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }
  const w = a.current
  const wt = workTarget(w)
  const openTarget = useOpenTarget()
  return (
    <div className={'cyc-card s-' + a.state} style={{ ['--rc' as string]: roleColorVar(role?.color) }} data-agent={a.agent_id}>
      <div className="cc-top">
        <span className={`cyc-agent s-${a.state}`}>{initials(a.name)}</span>
        <b>{a.name}</b>
        <span className="muted">{a.role_title}</span>
        <span className={'cc-state s-' + a.state}>{STATE_LABEL[a.state]}</span>
      </div>
      <div className="cc-work">
        {w ? <>{w.action}{w.num ? <span className="mono"> task-{w.num}</span> : null} · {wt
          ? <button type="button" className="cc-link" onClick={() => openTarget(wt)}>{w.title}</button>
          : w.title}</> : <span className="muted">задачи нет</span>}
      </div>
      <div className="cc-model">
        {editing && admin && member ? (
          <>
            <Select size="sm" aria-label={`модель агента ${a.name}`} value={pending} disabled={!choices || busy}
              onChange={e => setPending(e.target.value)}>
              <option value="">{role?.model ? `как в шаблоне (${role.model})` : 'как в шаблоне'}</option>
              {cur && !opts.some(o => o.key === cur) && <option value={cur}>{a.connection_id ? `${a.connection_id}/` : ''}{a.model}</option>}
              {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
            <Button size="sm" variant="primary" busy={busy} disabled={pending === cur} onClick={save}>Сохранить</Button>
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Отмена</Button>
          </>
        ) : (
          <>
            <span className="mono">{a.model ? `${a.connection_id ? a.connection_id + '/' : ''}${a.model}` : 'модель шаблона'}</span>
            {admin && member && a.state !== 'disabled' && (
              <Button size="sm" variant="quiet" aria-label={`сменить модель агента ${a.name}`} onClick={openEditor}>✎</Button>
            )}
          </>
        )}
      </div>
      {editing && pendingOpt?.offline && (
        <div className="model-warn" role="status">Для этой модели нет online runner’а: задачи агента будут ждать, а на экране цикла он будет «нет runner’а».</div>
      )}
      {err && <div className="f-error" role="alert">{err}</div>}
    </div>
  )
}

// ─── данные панелей релиза и сопровождения ────────────────────────────────

interface PhaseExtra {
  // envs — наблюдаемые окружения: состояние, причина и время последней
  // проверки приходят в DTO окружения, история проверок не читается.
  releases: Release[]; incidents: Incident[]; envs: Environment[]
  // errors — блоки, которые не удалось перечитать: показываются прежние
  // данные с пометкой, а не пустой список.
  errors: { releases?: string; incidents?: string; envs?: string }
}

// usePhaseExtra — релизы (для панели «Релиз») и инциденты с наблюдением
// окружений (для «Сопровождения»): только для открытой панели, вместе с
// перечитыванием агрегата (generation — момент его чтения).
function usePhaseExtra(projectId: string, phase: CyclePhaseId | undefined, generation: string | undefined): PhaseExtra {
  const [extra, setExtra] = useState<PhaseExtra>({ releases: [], incidents: [], envs: [], errors: {} })
  const seq = useRef(0)
  useEffect(() => {
    if (phase !== 'release' && phase !== 'operations') return
    const n = ++seq.current
    const done = (patch: Partial<PhaseExtra>, block: keyof PhaseExtra['errors'], err?: string) => {
      if (n === seq.current) setExtra(x => ({ ...x, ...patch, errors: { ...x.errors, [block]: err } }))
    }
    if (phase === 'release') {
      api.releases(projectId, { limit: 5 }).then(r => done({ releases: r.releases ?? [] }, 'releases'))
        .catch(e => done({}, 'releases', errText(e)))
    } else {
      api.incidents(projectId, { status: 'active', limit: 10 }).then(r => done({ incidents: r.incidents ?? [] }, 'incidents'))
        .catch(e => done({}, 'incidents', errText(e)))
      api.environments(projectId).then(list => done({ envs: (list ?? []).filter(x => x.config.monitor?.enabled) }, 'envs'))
        .catch(e => done({}, 'envs', errText(e)))
    }
  }, [projectId, phase, generation])
  return extra
}

const NOTES_STATUS: Record<string, string> = { pending: 'пишутся', ready: 'готовы', template: 'по шаблону' }
const MONITOR_STATE: Record<string, string> = { ok: 'проверка проходит', fail: 'проверка падает', unknown: 'неизвестно', disabled: 'выключено' }

function ReleasesBlock({ releases, err }: { releases: Release[]; err?: string }) {
  const { href } = useStore()
  return (
    <section className="dw-sec">
      <h3>Релизы</h3>
      {err && <div className="f-error" role="alert">Не удалось обновить: {err}</div>}
      {releases.length === 0 && !err && <div className="muted">Релизов пока нет.</div>}
      <ul className="cp-items">
        {releases.map(r => (
          <li key={r.id}>
            <a className="cp-item" href={href({ view: 'releases', id: r.id })}>
              <b>{r.env_name}</b>
              <span className="mono">{r.version.slice(0, 8)}</span>
              <span className="cp-title">{r.composition.length} задач</span>
              <span className={'chip sm notes-' + r.notes_status}>release notes {NOTES_STATUS[r.notes_status] ?? r.notes_status}</span>
              <span className="muted mono">{fmtAgo(r.created_at)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OperationsBlock({ extra }: { extra: PhaseExtra }) {
  const { href } = useStore()
  const { incidents, envs, errors } = extra
  return (
    <>
      <section className="dw-sec">
        <h3>Инциденты</h3>
        {errors.incidents && <div className="f-error" role="alert">Не удалось обновить: {errors.incidents}</div>}
        {incidents.length === 0 && !errors.incidents && <div className="muted">Открытых инцидентов нет.</div>}
        <ul className="cp-items">
          {incidents.map(i => (
            <li key={i.id}>
              <a className="cp-item" href={href({ view: 'incidents', id: i.id })}>
                <span className={'inc-sev s-' + i.severity}>{i.severity}</span>
                <span className="cp-title">{i.title}</span>
                <span className="mono">×{i.occurrences}</span>
                <BugRef bug={i.bug_task} />
                {i.needs_human && <span className="cn-human" title="нужен человек" aria-label="нужен человек">!</span>}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="dw-sec">
        <h3>Наблюдение</h3>
        {errors.envs && <div className="f-error" role="alert">Не удалось обновить: {errors.envs}</div>}
        {envs.length === 0 && !errors.envs && <div className="muted">Наблюдение не настроено.</div>}
        <ul className="cp-items">
          {envs.map(e => {
            const state = e.monitor_state ?? 'unknown'
            return (
              <li key={e.id} className={'env-monitor s-' + state}>
                <div className="cp-item"><span className="dot" /><b>{e.name}</b>
                  <span className="cp-title">{MONITOR_STATE[state] ?? state}{e.monitor_reason ? ` · ${e.monitor_reason}` : ''}</span>
                  <span className="muted mono">{e.monitor_last_at ? fmtAgo(e.monitor_last_at) : 'проверок не было'}</span></div>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
