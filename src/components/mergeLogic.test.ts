import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Event } from '../api/client.ts'
import { awaitingMerge } from './mergeLogic.ts'

const ev = (id: number, type: string, payload?: Record<string, unknown>): Event => ({
  ID: id, TS: '', ActorKind: 'scheduler', ActorID: '', Type: type, ProjectID: 'p', EpicID: 'e', TaskID: 't', Text: '', Payload: payload,
})

test('ожидание merge: после входа в merge и до ухода с шага', () => {
  assert.equal(awaitingMerge([]), false)
  assert.equal(awaitingMerge([ev(1, 'task.status', { status: 'review' })]), false)
  assert.equal(awaitingMerge([ev(1, 'task.step'), ev(2, 'task.review_passed')]), true)
  // Хостинг не создал PR: ожидание merge продолжается.
  assert.equal(awaitingMerge([ev(1, 'task.review_passed'), ev(2, 'task.merge_failed', { reason: 'pr_not_created' })]), true)
  // Конфликт вернул задачу на code, merge завершил задачу.
  assert.equal(awaitingMerge([ev(1, 'task.review_passed'), ev(2, 'task.merge_conflict'), ev(3, 'task.status', { status: 'fixing' })]), false)
  assert.equal(awaitingMerge([ev(1, 'task.review_passed'), ev(2, 'task.status', { status: 'done' })]), false)
})
