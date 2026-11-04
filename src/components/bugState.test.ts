import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bugLabel, bugOpen } from './bugState.ts'

test('баг открыт, пока не отменён и не завершён', () => {
  assert.equal(bugOpen(null), false)
  assert.equal(bugOpen({ id: 'a', num: 1, status: 'cancelled' }), false)
  assert.equal(bugOpen({ id: 'a', num: 1, status: 'done' }), false)
  assert.equal(bugOpen({ id: 'a', num: 1, status: 'running' }), true)
  assert.equal(bugOpen({ id: 'a', num: 1, status: 'queued' }), true)
  assert.equal(bugLabel({ id: 'a', num: 7, status: 'cancelled' }), 'task-7 · отменён')
  assert.equal(bugLabel(undefined), 'без бага')
})

test('после отмены бага человеком кнопка «Создать баг заново» видна', () => {
  const inc = { needs_human: true, bug_cancelled_by: 'vova', bug_task: { id: 'f29d', num: 1, status: 'cancelled' } }
  assert.equal(!!(inc.bug_cancelled_by && !bugOpen(inc.bug_task)), true)
})
