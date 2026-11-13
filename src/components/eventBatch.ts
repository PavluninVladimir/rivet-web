import type { Event } from '../api/client'
import type { Clock } from './overviewLogic'

// Склейка перечитываний по потоку событий (fix-console-rivetd-tails, спека
// web «Перечитывания по потоку событий»): события копятся и применяются
// пачкой, а пачка перечитывает каждый источник один раз. Чистые функции без
// React, чтобы проверяться юнит-тестом.

// Окно пачки: первое событие после затишья применяется сразу, следующие в
// окне — одной пачкой в его конце.
export const EVENT_BATCH_MS = 250
// Источник перечитывается по событиям не чаще раза в это окно, с
// завершающим перечитыванием после пачки.
export const EVENT_REFRESH_MS = 1000

const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
}

// batcher копит элементы и отдаёт их пачкой: первый после затишья сразу,
// остальные в окне ms одной пачкой в конце окна. flushNow отдаёт
// накопленное сразу, не дожидаясь конца окна. cancel выбрасывает
// накопленное (поток закрыт, проект сменился).
export function batcher<T>(flush: (items: T[]) => void, ms: number, clock: Clock = realClock): { push: (item: T) => void; flushNow: () => void; cancel: () => void } {
  let queue: T[] = []
  let last = -Infinity
  let timer: unknown = null
  const fire = () => {
    timer = null
    last = clock.now()
    const items = queue
    queue = []
    if (items.length) flush(items)
  }
  return {
    push: (item) => {
      queue.push(item)
      if (timer !== null) return
      const wait = last + ms - clock.now()
      if (wait <= 0) fire()
      else timer = clock.set(fire, wait)
    },
    flushNow: () => {
      if (!queue.length) return
      if (timer !== null) clock.clear(timer)
      fire()
    },
    cancel: () => {
      if (timer !== null) clock.clear(timer)
      timer = null
      queue = []
    },
  }
}

// eventPipeline — путь событий потока в сторе: пачки (batcher) и сигнал
// перечитывания текущего экрана (tick) не чаще раза в EVENT_REFRESH_MS.
// onBatch применяет пачку и говорит, есть ли в ней события проекта: только
// они двигают tick. Первый сигнал после затишья сразу, сигналы внутри окна
// сводятся к одному завершающему в его конце, поэтому экран после пачки
// всегда перечитывается. Перед сигналом накопленная пачка применяется
// сразу: событие, пришедшее за миг до сигнала, попадает в него, и экран
// отстаёт от события не больше чем на EVENT_REFRESH_MS. Спека web
// «Перечитывания по потоку событий»: текущий экран — такой же источник, как
// эскалации и команда.
export function eventPipeline(onBatch: (evs: Event[]) => boolean, onTick: () => void, clock: Clock = realClock): { push: (e: Event) => void; cancel: () => void } {
  // Пачка, применённая прямо перед сигналом, им и покрыта: второй сигнал
  // на неё не нужен.
  let ticking = false
  const tick = batcher<true>(() => {
    ticking = true
    try { events.flushNow() } finally { ticking = false }
    onTick()
  }, EVENT_REFRESH_MS, clock)
  const events = batcher<Event>(evs => { if (onBatch(evs) && !ticking) tick.push(true) }, EVENT_BATCH_MS, clock)
  return {
    push: events.push,
    cancel: () => { events.cancel(); tick.cancel() },
  }
}

// Что перечитать по пачке событий. agentWork — занятость агентов установки:
// она перечитывает только команду и runner'ов и не двигает tick. project —
// остальные события по порядку: их получают экраны и лента цикла.
export interface RefreshPlan {
  agentWork: boolean
  project: Event[]
  attention: boolean
  mySteps: boolean
  projects: boolean
  roles: boolean
  team: boolean
  runners: boolean
  // discovery — экран исследования перечитывается сразу; progress — ход
  // анализа, его перечитывание реже (PROGRESS_RELOAD_MS стора).
  discovery: boolean
  progress: boolean
}

const DISCOVERY_RELOAD = /^(discovery\.|feedback\.|epic\.(decomposing|decomposed|plan_failed|deps_changed))/

// planRefresh сводит пачку к набору перечитываний: правила те же, что были
// на каждое событие, но каждый источник встречается один раз.
export function planRefresh(events: Event[], isAgentWork: (type: string) => boolean): RefreshPlan {
  const p: RefreshPlan = {
    agentWork: false, project: [], attention: false, mySteps: false, projects: false,
    roles: false, team: false, runners: false, discovery: false, progress: false,
  }
  for (const e of events) {
    const t = e.Type
    if (isAgentWork(t)) { p.agentWork = true; continue }
    p.project.push(e)
    if (t === 'discovery.analysis_progress') p.progress = true
    else if (DISCOVERY_RELOAD.test(t)) p.discovery = true
    // policy.decision пишется, когда движок не дал решения: вместе с ним
    // появляется эскалация уровня проекта, своего события у неё нет. Лимит
    // сопровождения создаёт эскалацию OPS_LIMIT вместе с инцидентом.
    if (t.startsWith('attention') || t === 'task.status' || t === 'deploy.status'
      || t === 'policy.decision' || t.startsWith('incident.') || t === 'environment.host' || t === 'project.credentials' || t === 'project.repository') p.attention = true
    if (t === 'task.status' || t === 'task.step' || t === 'task.verdict' || t === 'task.assign') p.mySteps = true
    // Бюджет и политика живут в DTO проекта.
    if (t === 'policy.budget_exceeded' || t === 'policy.activated') p.projects = true
    // Название и цвет шаблона приходят и в DTO агентов, смена модели
    // планировщика меняет модель агента-Тимлида.
    if (t.startsWith('role.') || t === 'planner.model_changed') { p.roles = true; p.team = true }
    if (t.startsWith('team.agent_')) p.team = true
    if (t.startsWith('load_test.')) p.runners = true
    // Текущая работа агентов и runner'ов меняется вместе со статусами задач.
    if (t === 'task.status' || t === 'task.assign' || t === 'task.step' || t === 'runner.renamed') { p.team = true; p.runners = true }
    // Декомпозиция: Тимлид занят, пока не придёт итог плана. Релиз-инженер
    // и Инженер сопровождения заняты заданием control plane.
    if (t === 'epic.decomposing' || t === 'epic.decomposed' || t === 'epic.plan_failed' || t === 'ops.job') p.team = true
  }
  return p
}

// mergeRecent добавляет пачку к ленте последних событий: новые первыми, без
// повторов по ID, не длиннее max.
export function mergeRecent(cur: Event[], add: Event[], max: number): Event[] {
  const seen = new Set(cur.map(e => e.ID))
  const fresh: Event[] = []
  for (let i = add.length - 1; i >= 0; i--) {
    const e = add[i]
    if (seen.has(e.ID)) continue
    seen.add(e.ID)
    fresh.push(e)
  }
  if (!fresh.length) return cur
  return [...fresh, ...cur].slice(0, max)
}
