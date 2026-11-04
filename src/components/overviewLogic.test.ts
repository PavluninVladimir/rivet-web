import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispositionFilename, type Decision } from '../api/client.ts'
import { amountTokens, copyText, decisionAction, decisionTarget, fmtShare, fmtWait, fromLocalInput, overviewEventRelevant, parsePeriod, reportRange, riskInfo, startOfWeek, throttle, throttleWithRecheck, toLocalInput, type Clock } from './overviewLogic.ts'

function fakeClock() {
  let t = 0
  let next: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => t,
    set: (fn, ms) => { next = { at: t + ms, fn }; return next },
    clear: () => { next = null },
  }
  const advance = (ms: number) => {
    t += ms
    const n = next
    if (n && n.at <= t) { next = null; n.fn() }
  }
  return { clock, advance }
}

test('перечитывание не чаще раза в 5 секунд с завершающим вызовом', () => {
  const { clock, advance } = fakeClock()
  let calls = 0
  const th = throttle(() => { calls++ }, 5000, clock)
  th.call()
  assert.equal(calls, 1, 'первое событие перечитывает сразу')
  th.call(); th.call(); th.call()
  assert.equal(calls, 1, 'пачка внутри окна ждёт')
  advance(4999)
  assert.equal(calls, 1)
  advance(1)
  assert.equal(calls, 2, 'одно завершающее перечитывание после пачки')
  advance(10000)
  assert.equal(calls, 2, 'без событий перечитываний нет')
  th.call()
  assert.equal(calls, 3, 'после тишины снова сразу')
  th.call(); th.cancel(); advance(6000)
  assert.equal(calls, 3, 'отмена снимает завершающий вызов')
})

// Часы с несколькими таймерами: повтор throttleWithRecheck держит их по
// одному на вызов.
function multiClock() {
  let t = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock = {
    now: () => t,
    set: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id },
    clear: h => { timers.delete(h as number) },
  }
  const advance = (ms: number) => {
    const end = t + ms
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
    }
    t = end
  }
  return { clock, advance }
}

test('занятость агентов: перечитывание сразу и повтор через окно', () => {
  const { clock, advance } = multiClock()
  let calls = 0
  const th = throttleWithRecheck(() => { calls++ }, 2000, clock)
  th.call()
  assert.equal(calls, 1, 'первое событие перечитывает сразу')
  advance(1999)
  assert.equal(calls, 1)
  advance(1)
  assert.equal(calls, 2, 'повтор через окно застаёт позднюю транзакцию')
  advance(10000)
  assert.equal(calls, 2, 'без событий перечитываний нет')
  // Пачка: не чаще раза в окно, последнее чтение позже последнего события.
  th.call(); th.call(); th.call()
  assert.equal(calls, 3)
  advance(2000)
  assert.equal(calls, 4)
  advance(2000)
  assert.equal(calls, 5)
  advance(10000)
  assert.equal(calls, 5)
  th.call()
  assert.equal(calls, 6)
  th.cancel()
  advance(10000)
  assert.equal(calls, 6, 'отмена снимает и повтор')
})

test('события, по которым обзор перечитывается', () => {
  for (const t of ['task.status', 'epic.progress', 'epic.due_changed', 'attention.new', 'deploy.status', 'role.updated',
    'policy.decision', 'policy.activated']) {
    assert.ok(overviewEventRelevant(t), t)
  }
  for (const t of ['session.overlap', 'project.settings', 'runner.renamed', 'team.agent_updated']) {
    assert.ok(!overviewEventRelevant(t), t)
  }
})

test('период из адреса: неизвестный даёт 7 суток', () => {
  assert.equal(parsePeriod('30d'), '30d')
  assert.equal(parsePeriod('month'), 'month')
  assert.equal(parsePeriod(undefined), '7d')
  assert.equal(parsePeriod('year'), '7d')
})

const dec = (d: Partial<Decision>): Decision => ({
  kind: 'escalation', title: 't', since: '2026-11-01T10:00:00Z', waiting_seconds: 0,
  epic_id: null, task_id: null, task_num: null, run_id: null, attention_id: null, reason: null, claimed_by: null, ...d,
})

test('решение одним кликом ведёт к месту действия', () => {
  assert.deepEqual(decisionTarget(dec({ kind: 'plan_approval', epic_id: 'e1' })), { view: 'epic', id: 'e1' })
  assert.deepEqual(decisionTarget(dec({ kind: 'escalation', epic_id: 'e1', task_id: 't1' })), { view: 'epic', id: 'e1', taskId: 't1' })
  assert.deepEqual(decisionTarget(dec({ kind: 'merge_confirmation', epic_id: 'e1', task_id: 't1' })), { view: 'epic', id: 'e1', taskId: 't1' })
  assert.deepEqual(decisionTarget(dec({ kind: 'my_step', epic_id: 'e1', task_id: 't1', run_id: '7' })), { view: 'mysteps' })
  // Эскалация без задачи: публикация — к окружениям, уровень проекта — к политикам.
  assert.deepEqual(decisionTarget(dec({ kind: 'escalation', attention_id: 'a1', reason: 'DEPLOY_FAILED' })), { view: 'environments' })
  for (const reason of ['POLICY_ENGINE', 'POLICY_SOURCE', 'POLICY_CHANGE', null]) {
    assert.deepEqual(decisionTarget(dec({ kind: 'escalation', attention_id: 'a1', reason })), { view: 'policies' }, String(reason))
  }
  assert.equal(decisionTarget(dec({ kind: 'plan_approval' })), null)
  assert.equal(decisionAction(dec({ kind: 'escalation', attention_id: 'a1', reason: 'POLICY_ENGINE' })), 'К политикам →')
  assert.equal(decisionAction(dec({ kind: 'escalation', attention_id: 'a1', reason: 'DEPLOY_FAILED' })), 'К окружениям →')
  assert.equal(decisionAction(dec({ kind: 'plan_approval', epic_id: 'e1' })), 'К плану →')
  assert.equal(decisionAction(dec({ kind: 'escalation', epic_id: 'e1', task_id: 't1' })), 'Открыть →')
})

test('копирование: Clipboard API, без него запасной путь, отказ виден', async () => {
  let copied = ''
  assert.equal(await copyText('отчёт', undefined, { writeText: async (t: string) => { copied = t } }), true)
  assert.equal(copied, 'отчёт')
  // Нет Clipboard API (http не localhost): выделение во временном поле.
  let removed = false
  const ta = { value: '', style: {} as Record<string, string>, setAttribute() {}, select() {}, remove() { removed = true } }
  const doc = {
    body: { appendChild() {} },
    createElement: () => ta,
    execCommand: (cmd: string) => cmd === 'copy',
  } as unknown as Document
  assert.equal(await copyText('отчёт', doc, undefined), true)
  assert.equal(ta.value, 'отчёт')
  assert.ok(removed, 'временное поле убирается')
  const denied = { ...doc, execCommand: () => false } as unknown as Document
  assert.equal(await copyText('отчёт', denied, { writeText: async () => { throw new Error('denied') } }), false)
  assert.equal(await copyText('отчёт', undefined, undefined), false)
})

test('статус риска цветом статусной системы', () => {
  assert.deepEqual(riskInfo('on_track'), { label: 'в графике', color: 'var(--c-done)' })
  assert.deepEqual(riskInfo('at_risk'), { label: 'под риском', color: 'var(--c-review)' })
  assert.deepEqual(riskInfo('needs_human'), { label: 'нужен человек', color: 'var(--c-block)' })
  assert.equal(riskInfo('done').label, 'завершён')
})

test('подписи ожидания, доли и токенов', () => {
  assert.equal(fmtWait(30), 'меньше минуты')
  assert.equal(fmtWait(17 * 60), '17 мин')
  assert.equal(fmtWait(2 * 3600), '2 ч')
  assert.equal(fmtWait(3 * 3600 + 5 * 60), '3 ч 5 мин')
  assert.equal(fmtWait(50 * 3600), '2 сут 2 ч')
  assert.equal(fmtShare(null), '—')
  assert.equal(fmtShare(0.456), '46%')
  const a = { tokens_in: null, tokens_out: null, cost_usd: null, duration_s: 0, partial_cost: false }
  assert.equal(amountTokens(a), null, 'нет данных — не ноль')
  assert.equal(amountTokens({ ...a, tokens_in: 100, tokens_out: null }), 100)
})

test('целевая дата: поле datetime-local туда и обратно', () => {
  const iso = '2026-12-01T09:30:00.000Z'
  assert.equal(fromLocalInput(toLocalInput(iso)), iso)
  assert.equal(fromLocalInput(''), null)
  assert.equal(fromLocalInput('завтра'), null)
  assert.equal(toLocalInput(null), '')
})

test('имя файла отчёта из Content-Disposition', () => {
  assert.equal(dispositionFilename('attachment; filename="rivet-byudzhet-crm-2026-10-26-2026-11-01.md"', 'x.md'),
    'rivet-byudzhet-crm-2026-10-26-2026-11-01.md')
  assert.equal(dispositionFilename('attachment; filename=r.md', 'x.md'), 'r.md')
  assert.equal(dispositionFilename(null, 'x.md'), 'x.md')
  assert.equal(dispositionFilename('inline', 'x.md'), 'x.md')
})

test('период отчёта: прошлая неделя с понедельника, свои даты включительно', () => {
  // Среда 4 ноября 2026: прошлая неделя — с 26 октября по 2 ноября.
  const now = new Date(2026, 10, 4, 15, 0)
  assert.equal(startOfWeek(now).getDate(), 2)
  const lw = reportRange('last_week', now, { from: '', to: '' }) as { from: string; to: string }
  assert.equal(new Date(lw.from).getTime(), new Date(2026, 9, 26).getTime())
  assert.equal(new Date(lw.to).getTime(), new Date(2026, 10, 2).getTime())
  // Воскресенье относится к прошедшей неделе.
  assert.equal(startOfWeek(new Date(2026, 10, 8, 23, 0)).getDate(), 2)
  assert.deepEqual(reportRange('7d', now, { from: '', to: '' }), {})
  const c = reportRange('custom', now, { from: '2026-10-01', to: '2026-10-07' }) as { from: string; to: string }
  assert.equal(new Date(c.to).getTime(), new Date(2026, 9, 8).getTime())
  assert.ok('error' in reportRange('custom', now, { from: '2026-10-07', to: '2026-10-01' }))
  assert.ok('error' in reportRange('custom', now, { from: '', to: '2026-10-01' }))
})
