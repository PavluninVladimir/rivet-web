import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Presets, ProcessDoc } from '../api/client'
import { cleanLocks, processHandlers, withDefaultProcess, withLocks, withProcess } from './installationProcess.ts'

const base: Presets = {
  auto_merge: true, human_review_paths: [], attempt_limit: 3, review_limit: 2,
  daily_token_budget: null, auto_publish: false,
}
const explicit: ProcessDoc = { steps: [{ id: 'code', kind: 'code', participants: [{ agent: {} }] }] }

test('ограничение без явного процесса оставляет процесс по умолчанию', () => {
  // tester_agent выключен: сервер снимает тестировщика только в процессе
  // по умолчанию, поэтому process должен остаться null.
  const p = withLocks({ ...base, process: null, tester_agent: false }, { required_kinds: ['review'] })
  assert.equal(p.process, null)
  assert.equal(p.tester_agent, false)
  assert.deepEqual(p.process_locks, { required_kinds: ['review'] })
  assert.equal(JSON.parse(JSON.stringify(p)).process, null)
})

test('ограничение без ключа process не добавляет его', () => {
  const p = withLocks(base, { human_review: true })
  assert.equal('process' in p, false)
  assert.deepEqual(p.process_locks, { human_review: true })
})

test('ограничение сохраняет явный процесс как был', () => {
  const p = withLocks({ ...base, process: explicit }, { min_participants: { review: 2 } })
  assert.equal(p.process, explicit)
  assert.deepEqual(p.process, { steps: [{ id: 'code', kind: 'code', participants: [{ agent: {} }] }] })
  assert.deepEqual(p.process_locks, { min_participants: { review: 2 } })
})

test('снятие всех ограничений даёт null и не трогает процесс', () => {
  const p = withLocks({ ...base, process: null, process_locks: { human_review: true } },
    { required_kinds: [], min_participants: {}, human_review: false })
  assert.equal(p.process_locks, null)
  assert.equal(p.process, null)
})

test('правка графа делает процесс явным', () => {
  const p = withProcess({ ...base, process: null, process_locks: { human_review: true } }, explicit)
  assert.equal(p.process, explicit)
  assert.deepEqual(p.process_locks, { human_review: true })
})

test('проводка панели: ограничения процесс не трогают, граф делает явным, сброс возвращает встроенный', () => {
  let state: Presets = { ...base, process: null, tester_agent: false }
  let edits = 0
  const h = processHandlers(edit => { state = edit(state); edits++ })
  h.onLocksChange({ required_kinds: ['review'] })
  assert.equal(state.process, null)
  assert.deepEqual(state.process_locks, { required_kinds: ['review'] })
  h.onProcessChange(explicit)
  assert.equal(state.process, explicit)
  h.onLocksChange({ required_kinds: ['review'], human_review: true })
  assert.equal(state.process, explicit)
  h.onResetProcess()
  assert.equal(state.process, null)
  assert.deepEqual(state.process_locks, { required_kinds: ['review'], human_review: true })
  assert.equal(edits, 4)
})

test('сброс к встроенному процессу оставляет ограничения', () => {
  const p = withDefaultProcess({ ...base, process: explicit, process_locks: { human_review: true } })
  assert.equal(p.process, null)
  assert.deepEqual(p.process_locks, { human_review: true })
})

test('ограничения без пустых ключей', () => {
  assert.equal(cleanLocks({}), null)
  assert.deepEqual(cleanLocks({ required_kinds: ['code'], min_participants: {}, human_review: false }), { required_kinds: ['code'] })
  assert.deepEqual(cleanLocks({ min_participants: { review: 1 }, human_review: true }), { min_participants: { review: 1 }, human_review: true })
})
