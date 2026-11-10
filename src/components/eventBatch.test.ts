import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Event } from '../api/client.ts'
import type { Clock } from './overviewLogic.ts'
import { throttle } from './overviewLogic.ts'
import { batcher, EVENT_BATCH_MS, EVENT_REFRESH_MS, eventPipeline, mergeRecent, planRefresh } from './eventBatch.ts'

function fakeClock() {
  let t = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let seq = 0
  const clock: Clock = {
    now: () => t,
    set: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id },
    clear: h => { timers.delete(h as number) },
  }
  const advance = (ms: number) => {
    const end = t + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      t = due[1].at
      due[1].fn()
    }
    t = end
  }
  return { clock, advance }
}

let id = 0
function ev(type: string): Event {
  id++
  return { ID: id, TS: '', ActorKind: 'system', ActorID: '', Type: type, ProjectID: 'p', EpicID: '', TaskID: '', Text: '' }
}
const agentWork = (t: string) => t === 'team.agent_busy' || t === 'team.agent_free'

test('первое событие после затишья применяется сразу, остальные пачкой в конце окна', () => {
  const { clock, advance } = fakeClock()
  const flushed: number[][] = []
  const b = batcher<number>(items => flushed.push(items), EVENT_BATCH_MS, clock)
  b.push(1)
  assert.deepEqual(flushed, [[1]], 'одиночное событие без задержки')
  for (let i = 2; i <= 2000; i++) b.push(i)
  assert.equal(flushed.length, 1, 'пачка ждёт конца окна')
  advance(EVENT_BATCH_MS)
  assert.equal(flushed.length, 2)
  assert.equal(flushed[1].length, 1999, 'вся пачка одним вызовом, по порядку')
  assert.equal(flushed[1][0], 2)
  assert.equal(flushed[1][1998], 2000)
  // Затишье дольше окна: следующее событие снова сразу.
  advance(EVENT_BATCH_MS * 4)
  b.push(2001)
  assert.deepEqual(flushed[2], [2001])
})

test('cancel выбрасывает накопленную пачку', () => {
  const { clock, advance } = fakeClock()
  const flushed: number[][] = []
  const b = batcher<number>(items => flushed.push(items), EVENT_BATCH_MS, clock)
  b.push(1); b.push(2); b.push(3)
  b.cancel()
  advance(EVENT_BATCH_MS * 2)
  assert.deepEqual(flushed, [[1]])
})

test('пачка task.status перечитывает каждый общий источник один раз', () => {
  const evs = Array.from({ length: 2000 }, () => ev('task.status'))
  const p = planRefresh(evs, agentWork)
  assert.equal(p.project.length, 2000, 'экраны получают каждое событие')
  assert.deepEqual(
    { attention: p.attention, mySteps: p.mySteps, team: p.team, runners: p.runners, projects: p.projects, roles: p.roles, discovery: p.discovery },
    { attention: true, mySteps: true, team: true, runners: true, projects: false, roles: false, discovery: false })
})

test('правила перечитываний по типам событий', () => {
  const plan = (t: string) => planRefresh([ev(t)], agentWork)
  assert.equal(plan('team.agent_busy').agentWork, true)
  assert.equal(plan('team.agent_busy').project.length, 0, 'занятость агентов не двигает экран')
  assert.equal(plan('attention.new').attention, true)
  assert.equal(plan('incident.opened').attention, true)
  assert.equal(plan('policy.decision').attention, true)
  assert.equal(plan('deploy.status').attention, true)
  assert.equal(plan('task.verdict').mySteps, true)
  assert.equal(plan('task.verdict').team, false)
  assert.equal(plan('policy.activated').projects, true)
  assert.equal(plan('policy.budget_exceeded').projects, true)
  assert.deepEqual([plan('role.updated').roles, plan('role.updated').team], [true, true])
  assert.deepEqual([plan('planner.model_changed').roles, plan('planner.model_changed').team], [true, true])
  assert.deepEqual([plan('runner.renamed').runners, plan('runner.renamed').team], [true, true])
  assert.equal(plan('team.agent_created').team, true)
  assert.equal(plan('epic.decomposed').team, true)
  assert.equal(plan('epic.decomposed').discovery, true)
  assert.equal(plan('ops.job').team, true)
  assert.equal(plan('discovery.analysis_progress').progress, true)
  assert.equal(plan('discovery.analysis_progress').discovery, false, 'ход анализа перечитывается реже')
  assert.equal(plan('feedback.created').discovery, true)
  const quiet = plan('epic.due_changed')
  assert.equal(quiet.project.length, 1)
  assert.equal(quiet.attention || quiet.mySteps || quiet.team || quiet.runners || quiet.projects || quiet.roles, false)
})

test('реплей 2000 событий порциями перечитывает источник не чаще раза в секунду, а не 2000 раз', () => {
  // Сценарий реплея после разрыва: события приходят порциями по 200 раз в
  // секунду. Источник обёрнут в throttle на секунду, как в сторе.
  const { clock, advance } = fakeClock()
  let attention = 0
  const th = throttle(() => { attention++ }, EVENT_REFRESH_MS, clock)
  const b = batcher<Event>(items => { if (planRefresh(items, agentWork).attention) th.call() }, EVENT_BATCH_MS, clock)
  for (let s = 0; s < 10; s++) {
    for (let i = 0; i < 200; i++) b.push(ev('task.status'))
    advance(1000)
  }
  advance(EVENT_REFRESH_MS * 2)
  assert.ok(attention <= 12, `перечитываний ${attention}`)
  assert.ok(attention >= 2, 'завершающее перечитывание после пачки есть')
})

test('лента последних событий: новые первыми, без повторов, с ограничением', () => {
  const a = ev('task.status'), b = ev('task.step'), c = ev('task.status')
  assert.deepEqual(mergeRecent([], [a, b], 60).map(e => e.ID), [b.ID, a.ID])
  const cur = [b, a]
  assert.equal(mergeRecent(cur, [a, b], 60), cur, 'повтор не меняет ленту')
  assert.deepEqual(mergeRecent(cur, [b, c], 60).map(e => e.ID), [c.ID, b.ID, a.ID])
  assert.deepEqual(mergeRecent(cur, [c], 2).map(e => e.ID), [c.ID, b.ID])
})

test('экран перечитывается по потоку не чаще раза в секунду, с завершающим перечитыванием', () => {
  // Живой поток: 10 событий в секунду 10 секунд (Epic с десятком задач).
  const { clock, advance } = fakeClock()
  const ticks: number[] = []
  let batches = 0
  const pipe = eventPipeline(() => { batches++; return true }, () => ticks.push(clock.now()), clock)
  for (let i = 0; i < 100; i++) {
    pipe.push(ev('task.step'))
    advance(100)
  }
  advance(EVENT_REFRESH_MS * 2)
  assert.ok(batches > ticks.length, `пачек ${batches}, перечитываний ${ticks.length}`)
  assert.ok(ticks.length <= 12, `перечитываний ${ticks.length} за 10 секунд потока и завершающее`)
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] - ticks[i - 1] >= EVENT_REFRESH_MS, `интервал ${ticks[i] - ticks[i - 1]} мс`)
  assert.ok(ticks[ticks.length - 1] >= 9900, 'после последнего события экран перечитан')

  // Одиночное событие после затишья — сразу.
  const before = ticks.length
  pipe.push(ev('task.status'))
  assert.equal(ticks.length, before + 1)
  pipe.cancel()
})

test('доигрывание порциями по 200 в секунду перечитывает экран не чаще раза в секунду', () => {
  const { clock, advance } = fakeClock()
  let ticks = 0
  const pipe = eventPipeline(() => true, () => { ticks++ }, clock)
  for (let s = 0; s < 10; s++) {
    for (let i = 0; i < 200; i++) pipe.push(ev('task.status'))
    advance(1000)
  }
  advance(EVENT_REFRESH_MS * 2)
  assert.ok(ticks <= 11 && ticks >= 2, `перечитываний ${ticks}`)
})

test('пачка только из занятости агентов экран не двигает', () => {
  const { clock, advance } = fakeClock()
  let ticks = 0
  const pipe = eventPipeline(evs => planRefresh(evs, agentWork).project.length > 0, () => { ticks++ }, clock)
  pipe.push(ev('team.agent_busy')); pipe.push(ev('team.agent_free'))
  advance(EVENT_REFRESH_MS * 3)
  assert.equal(ticks, 0)
})

test('событие перед сигналом попадает в него: экран отстаёт не больше чем на секунду', () => {
  // Пример ревью: события в 0, 800 и 900 мс. Без сброса пачки перед
  // сигналом событие 900 попадало на экран только через 1100 мс.
  const { clock, advance } = fakeClock()
  const applied: Array<{ id: number; at: number }> = []
  const ticks: number[] = []
  const pipe = eventPipeline(evs => { for (const e of evs) applied.push({ id: e.ID, at: clock.now() }); return true }, () => ticks.push(clock.now()), clock)
  const sent = new Map<number, number>()
  const send = () => { const e = ev('task.status'); sent.set(e.ID, clock.now()); pipe.push(e) }
  send(); advance(800); send(); advance(100); send()
  advance(EVENT_REFRESH_MS * 3)
  // Каждое событие: первый сигнал не раньше применения и не позже секунды.
  for (const [id, at] of sent) {
    const appliedAt = applied.find(a => a.id === id)!.at
    const tick = ticks.find(t => t >= appliedAt)
    assert.ok(tick !== undefined, `событие ${id} без перечитывания`)
    assert.ok(tick! - at <= EVENT_REFRESH_MS, `событие ${id}: задержка ${tick! - at} мс`)
  }
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] - ticks[i - 1] >= EVENT_REFRESH_MS)
})

test('случайные последовательности: задержка до перечитывания экрана не больше секунды', () => {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let run = 0; run < 300; run++) {
    const { clock, advance } = fakeClock()
    const applied = new Map<number, number>()
    const ticks: number[] = []
    const pipe = eventPipeline(evs => { for (const e of evs) applied.set(e.ID, clock.now()); return true }, () => ticks.push(clock.now()), clock)
    const sent: Array<[number, number]> = []
    for (let i = 0; i < 30; i++) {
      advance(Math.floor(rnd() * 700))
      const e = ev('task.status'); sent.push([e.ID, clock.now()]); pipe.push(e)
    }
    advance(EVENT_REFRESH_MS * 3)
    for (const [id, at] of sent) {
      const tick = ticks.find(t => t >= applied.get(id)!)
      assert.ok(tick !== undefined && tick - at <= EVENT_REFRESH_MS, `прогон ${run}: событие ${id}, задержка ${tick === undefined ? 'нет' : tick - at}`)
    }
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] - ticks[i - 1] >= EVENT_REFRESH_MS, `прогон ${run}: интервал ${ticks[i] - ticks[i - 1]}`)
  }
})
