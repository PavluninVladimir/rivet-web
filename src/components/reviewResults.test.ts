import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criterionState, timelineDetail } from './reviewResults.ts'

test('review status controls all three criterion states, ignoring legacy ok', () => {
  assert.deepEqual(criterionState({ text: 'legacy', ok: true }), { className: 'pend', mark: '○', label: 'не проверен' })
  assert.equal(criterionState({ text: 'passed', ok: false, status: 'ok' }).mark, '✓')
  assert.equal(criterionState({ text: 'failed', ok: true, status: 'fail' }).mark, '✗')
})

test('timeline details accept only nonempty text and exclude session steps', () => {
  for (const detail of [undefined, null, 42, {}, [], '', ' \n ']) {
    assert.equal(timelineDetail({ Type: 'task.status', Payload: { detail } }), '')
  }
  assert.equal(timelineDetail({ Type: 'task.status', Payload: undefined }), '')
  assert.equal(timelineDetail({ Type: 'session.step', Payload: { detail: 'tool argument' } }), '')
  const detail = '  <script>alert(1)</script>\nreview notes\n'
  assert.equal(timelineDetail({ Type: 'task.status', Payload: { detail } }), detail)
})
