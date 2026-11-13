import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseOpenLabel } from './cycleAccessibility.ts'

const phase = {
  title: 'Исследование',
  no_data: false,
  hint: '',
  feedback_unaccounted: 0,
  counters: { active: 0, waiting: 0, needs_human: 0, done_period: 2 }
}

test('empty phase opener announces missing data and the actionable hint', () => {
  assert.equal(
    phaseOpenLabel({ ...phase, no_data: true, hint: 'Загрузите интервью' }),
    'Открыть фазу Исследование: нет данных, Загрузите интервью'
  )
})

test('phase opener exposes active, waiting and human counts, including explicit zero', () => {
  assert.equal(
    phaseOpenLabel({ ...phase, counters: { ...phase.counters, active: 2, waiting: 1, needs_human: 3 } }),
    'Открыть фазу Исследование: в работе 2, ждут 1, нужен человек 3'
  )
  assert.equal(phaseOpenLabel(phase), 'Открыть фазу Исследование: в работе 0, ждут 0, нужен человек 0')
  assert.ok(
    !phaseOpenLabel(phase).includes('нет данных'),
    'valid data with zero current work is not a missing-data phase'
  )
})

test('unaccounted feedback is announced and disappears after the next accepted analysis', () => {
  const before = { ...phase, feedback_unaccounted: 2, counters: { ...phase.counters, waiting: 2 } }
  assert.match(phaseOpenLabel(before), /ждут 2, нужен человек 0, 2 отзыва не учтены$/)
  assert.match(phaseOpenLabel({ ...phase, feedback_unaccounted: 1 }), /1 отзыв не учтён$/)
  const after = { ...phase, counters: { ...phase.counters, needs_human: 1 } }
  assert.match(phaseOpenLabel(after), /в работе 0, ждут 0, нужен человек 1$/)
  assert.ok(!phaseOpenLabel(after).includes('отзыв'))
})
