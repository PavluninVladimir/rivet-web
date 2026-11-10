import { test } from 'node:test'
import assert from 'node:assert/strict'
import { edgeLabel, stepState, taskProcessView } from './taskProcess.ts'
import { COMPACT_SIZE, FULL_SIZE, layoutProcess } from './processLayout.ts'
import type { ResolvedProcess, StepTransition } from '../api/client'

// Граф процесса задачи в деталке (спека web «Процесс задачи в деталке»):
// текущий шаг, пройденные в текущем проходе, рёбра по истории.

const PROC: ResolvedProcess = { steps: [
  { id: 'code', kind: 'code', title: 'Реализация', on: { ok: 'test', changes: 'code', fail: 'escalate' } },
  { id: 'test', kind: 'test', title: 'Проверки', on: { ok: 'review', changes: 'code', fail: 'escalate' } },
  { id: 'review', kind: 'review', title: 'Review', on: { ok: 'merge', changes: 'code', fail: 'escalate' } },
  { id: 'merge', kind: 'merge', title: 'Merge', on: { ok: 'done' } },
] }

const tr = (step: string, outcome: string, next: string): StepTransition => ({ step, outcome, next, ts: '2026-11-07T10:00:00Z' })
const states = (v: NonNullable<ReturnType<typeof taskProcessView>>) => PROC.steps.map(s => `${s.id}:${stepState(v, s.id)}`).join(' ')

test('задача на review: code и test пройдены, review текущий', () => {
  const v = taskProcessView(PROC, [tr('code', 'ok', 'test'), tr('test', 'ok', 'review')], 'review', 'review')!
  assert.equal(states(v), 'code:passed test:passed review:current merge:ahead')
  assert.equal(v.summary, 'Текущий шаг: Review · пройдено 2 из 4')
  assert.equal(v.done, false)
  // Рёбра: ok всегда, возвратов и эскалаций не было, их на графе нет.
  const lay = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  assert.deepEqual(lay.edges.map(e => e.id), ['code:ok', 'test:ok', 'review:ok', 'merge:ok'])
  assert.ok(!lay.nodes.some(n => n.kind === 'escalate'), 'узла эскалации нет без эскалаций')
})

test('возврат с review снимает отметки начиная с цели и показывает ребро changes', () => {
  const h = [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'changes', 'code'),
    tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'changes', 'code')]
  const v = taskProcessView(PROC, h, 'code', 'fixing')!
  assert.equal(states(v), 'code:current test:ahead review:ahead merge:ahead')
  assert.equal(v.taken.get('review:changes'), 2)
  assert.equal(v.taken.get('code:ok'), 2)
  const lay = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  assert.ok(lay.edges.some(e => e.id === 'review:changes' && e.to === 'code'))
  assert.ok(!lay.edges.some(e => e.id === 'test:changes'), 'непройденный возврат не рисуется')
})

test('после возврата шаги до цели остаются пройденными', () => {
  const proc: ResolvedProcess = { steps: [
    { id: 'code', kind: 'code', title: '', on: { ok: 'test', changes: 'code', fail: 'escalate' } },
    { id: 'test', kind: 'test', title: '', on: { ok: 'review', changes: 'code', fail: 'escalate' } },
    { id: 'review', kind: 'review', title: '', on: { ok: 'done', changes: 'test', fail: 'escalate' } },
  ] }
  const v = taskProcessView(proc, [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'changes', 'test')], 'test', 'testing')!
  assert.deepEqual([...v.passed], ['code'])
  assert.equal(v.current, 'test')
  // Пустое название: подпись типа по умолчанию.
  assert.equal(v.summary, 'Текущий шаг: Проверки · пройдено 1 из 3')
})

test('эскалация: узел эскалации в графе, задача на ней', () => {
  const v = taskProcessView(PROC, [tr('code', 'ok', 'test'), tr('test', 'fail', 'escalate')], 'test', 'blocked')!
  assert.equal(v.escalated, true)
  assert.equal(v.current, 'test')
  assert.equal(v.summary, 'Эскалация на шаге «Проверки» · пройдено 1 из 4')
  const lay = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  assert.ok(lay.nodes.some(n => n.kind === 'escalate'))
  assert.ok(lay.edges.some(e => e.id === 'test:fail'))
})

test('завершённая задача: всё пройдено, текущего шага нет; у отменённой текущего шага нет', () => {
  const done = taskProcessView(PROC, [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'ok', 'merge')], 'merge', 'done')!
  assert.equal(states(done), 'code:passed test:passed review:passed merge:passed')
  assert.equal(done.current, null)
  assert.equal(done.summary, 'Задача завершена · пройдено 4 из 4')
  const cancelled = taskProcessView(PROC, [tr('code', 'ok', 'test')], 'test', 'cancelled')!
  assert.equal(cancelled.current, null)
  assert.equal(cancelled.summary, 'Задача отменена · пройдено 1 из 4')
})

test('без снимка графа нет, переходы чужих шагов пропускаются', () => {
  assert.equal(taskProcessView(null, [], 'code', 'running'), null)
  assert.equal(taskProcessView({ steps: [] }, [], 'code', 'running'), null)
  const v = taskProcessView(PROC, [tr('legacy', 'ok', 'code')], 'code', 'running')!
  assert.equal(v.taken.size, 0)
  assert.equal(v.passed.size, 0)
})

// Лимит отказов review исчерпан: последний возврат заявлен на code, но
// задача осталась на review и ушла в эскалацию (failed).
const EXHAUSTED = [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'changes', 'code'),
  tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'changes', 'code')]

test('исчерпан лимит возвратов: эскалация видна, пройденное не сброшено', () => {
  const v = taskProcessView(PROC, EXHAUSTED, 'review', 'failed')!
  assert.equal(states(v), 'code:passed test:passed review:current merge:ahead')
  assert.equal(v.escalated, true)
  assert.equal(v.taken.get('review:changes'), 1, 'возврат, которого не было, не считается')
  assert.equal(v.taken.get('review:fail'), 1)
  assert.equal(v.summary, 'Эскалация на шаге «Review» · пройдено 2 из 4')
  const lay = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  assert.ok(lay.nodes.some(n => n.kind === 'escalate'))
  assert.ok(lay.edges.some(e => e.id === 'review:fail' && e.to === 'escalate'))
})

test('повтор после исчерпания: задача снова на review, эскалация в истории', () => {
  const v = taskProcessView(PROC, EXHAUSTED, 'review', 'review')!
  assert.equal(states(v), 'code:passed test:passed review:current merge:ahead')
  assert.equal(v.escalated, false)
  assert.equal(v.taken.get('review:fail'), 1)
  assert.equal(v.summary, 'Текущий шаг: Review · пройдено 2 из 4')
})

test('эскалация с fail на другой шаг: ребро для графа ведёт в эскалацию', () => {
  const proc: ResolvedProcess = { steps: PROC.steps.map(s => s.id === 'review' ? { ...s, on: { ...s.on, fail: 'code' } } : s) }
  const v = taskProcessView(proc, EXHAUSTED, 'review', 'failed')!
  const lay = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  assert.ok(lay.edges.some(e => e.id === 'review:fail' && e.to === 'escalate'))
  assert.equal(proc.steps[2].on.fail, 'code', 'снимок задачи не меняется')
})

test('вход на шаг без события снимает отметки с него и шагов после', () => {
  // Сессия доработки после эскалации на review ставит задачу на code.
  const h = [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'fail', 'escalate')]
  const v = taskProcessView(PROC, h, 'code', 'fixing')!
  assert.equal(states(v), 'code:current test:ahead review:ahead merge:ahead')
  assert.equal(v.escalated, false)
  assert.equal(v.taken.get('review:fail'), 1)
  // Конфликт merge вернул задачу в разработку: review ok был, проход новый.
  const m = taskProcessView(PROC, [tr('code', 'ok', 'test'), tr('test', 'ok', 'review'), tr('review', 'ok', 'merge'), tr('code', 'ok', 'test')], 'test', 'testing')!
  assert.equal(states(m), 'code:passed test:current review:ahead merge:ahead')
  assert.equal(m.taken.get('review:ok'), 1)
})

test('вопрос агента без перехода: задача на шаге, не на эскалации', () => {
  const v = taskProcessView(PROC, [tr('code', 'ok', 'test')], 'test', 'blocked')!
  assert.equal(v.escalated, false)
  assert.equal(v.summary, 'Текущий шаг: Проверки · пройдено 1 из 4')
})

test('подписи рёбер эскалации: лимит changes и переход fail', () => {
  const v = taskProcessView(PROC, EXHAUSTED, 'review', 'failed')!
  assert.equal(edgeLabel(v, 'review:fail', 'fail'), 'лимит changes')
  assert.equal(edgeLabel(v, 'review:changes', 'changes'), 'changes')
  const f = taskProcessView(PROC, [tr('code', 'ok', 'test'), tr('test', 'fail', 'escalate')], 'test', 'blocked')!
  assert.equal(edgeLabel(f, 'test:fail', 'fail'), 'эскалация')
  // Повтор после эскалации и новая эскалация на том же шаге.
  const twice = taskProcessView(PROC, [...EXHAUSTED, tr('review', 'fail', 'escalate')], 'review', 'blocked')!
  assert.equal(edgeLabel(twice, 'review:fail', 'fail'), 'эскалация, лимит changes ×2')
})

test('исчерпан лимит возврата на тот же шаг: эскалация по статусу failed', () => {
  // Люди на code возвращают задачу на code (changes → code), лимит исчерпан.
  const h = [tr('code', 'changes', 'code'), tr('code', 'changes', 'code'), tr('code', 'changes', 'code')]
  const v = taskProcessView(PROC, h, 'code', 'failed')!
  assert.equal(v.escalated, true)
  assert.equal(v.taken.get('code:changes'), 2, 'последний возврат не случился')
  assert.equal(edgeLabel(v, 'code:fail', 'fail'), 'лимит changes')
  assert.equal(v.summary, 'Эскалация на шаге «Реализация» · пройдено 0 из 4')
  // Тот же путь у задачи в работе: обычные возвраты, эскалации нет.
  const w = taskProcessView(PROC, h, 'code', 'fixing')!
  assert.equal(w.escalated, false)
  assert.equal(w.taken.get('code:changes'), 3)
  assert.ok(!w.taken.has('code:fail'))
})

test('отменённая после исчерпания задача: эскалация видна, текущего шага нет', () => {
  const v = taskProcessView(PROC, EXHAUSTED, 'review', 'cancelled')!
  assert.equal(v.current, null)
  assert.equal(v.taken.get('review:fail'), 1)
  assert.equal(v.taken.get('review:changes'), 1)
  assert.equal(v.summary, 'Задача отменена · пройдено 2 из 4')
})

test('компактная раскладка уже полной, редактор не меняется', () => {
  const v = taskProcessView(PROC, [], 'code', 'running')!
  const compact = layoutProcess(v.doc, { size: COMPACT_SIZE, keep: v.keep })
  const full = layoutProcess(v.doc)
  assert.deepEqual(layoutProcess(v.doc, { size: FULL_SIZE }), full)
  assert.ok(compact.w < full.w / 2)
  // Четыре шага компактно влезают в деталку шириной 480px.
  assert.ok(compact.w <= 448, `ширина ${compact.w}`)
  const steps = compact.nodes.filter(n => n.kind === 'step')
  assert.equal(steps[0].w, COMPACT_SIZE.nw)
})
