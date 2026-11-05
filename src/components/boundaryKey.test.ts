import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundaryKey } from './boundaryKey.ts'

test('ключ границы ошибок меняется со сменой экрана, а не на каждом адресе', () => {
  assert.equal(boundaryKey({ view: 'runners' }), 'runners')
  assert.equal(boundaryKey({ view: 'epic', pid: 'p1', id: 'e1' }), boundaryKey({ view: 'epic', pid: 'p1', id: 'e1', taskId: 't7' }),
    'открытая задача не сбрасывает дашборд')
  assert.equal(boundaryKey({ view: 'epic', pid: 'p1', id: 'e1' }), boundaryKey({ view: 'epic', pid: 'p2', id: 'e1' }),
    'исправление проекта в адресе Epic’а не перемонтирует дашборд')
  assert.notEqual(boundaryKey({ view: 'epic', pid: 'p1', id: 'e1' }), boundaryKey({ view: 'epic', pid: 'p1', id: 'e2' }))
  assert.equal(boundaryKey({ view: 'project-settings', pid: 'p1', tab: 'general' }), boundaryKey({ view: 'project-settings', pid: 'p1', tab: 'policies' }))
  assert.notEqual(boundaryKey({ view: 'project-settings', pid: 'p1', tab: 'general' }), boundaryKey({ view: 'project-settings', pid: 'p2', tab: 'general' }))
  assert.equal(boundaryKey({ view: 'app-management', tab: 'users' }), boundaryKey({ view: 'app-management', tab: 'connections' }),
    'вкладки управления — своя граница внутри раздела')
  assert.notEqual(boundaryKey({ view: 'overview', pid: 'p1', period: '7d' }), boundaryKey({ view: 'overview', pid: 'p2', period: '7d' }))
  assert.equal(boundaryKey({ view: 'architecture', pid: 'p1', tab: 'hld' }), boundaryKey({ view: 'architecture', pid: 'p1', tab: 'erd' }),
    'вкладка архитектуры не перемонтирует экран')
  assert.notEqual(boundaryKey({ view: 'architecture', pid: 'p1', tab: 'hld' }), boundaryKey({ view: 'architecture', pid: 'p2', tab: 'hld' }))
  assert.equal(boundaryKey({ view: 'cycle', pid: 'p1' }), boundaryKey({ view: 'cycle', pid: 'p1', phase: 'review' }))
  assert.notEqual(boundaryKey({ view: 'cycle', pid: 'p1' }), boundaryKey({ view: 'cycle', pid: 'p2' }))
})

test('экраны проекта сбрасываются сменой проекта, релиз и инцидент — ещё и сменой id', () => {
  for (const view of ['epics', 'tasks', 'team', 'activity'] as const) {
    assert.notEqual(boundaryKey({ view, pid: 'p1' }), boundaryKey({ view, pid: 'p2' }), view)
    assert.equal(boundaryKey({ view, pid: 'p1' }), boundaryKey({ view, pid: 'p1' }), view)
  }
  assert.notEqual(boundaryKey({ view: 'releases', pid: 'p1' }), boundaryKey({ view: 'releases', pid: 'p2' }))
  assert.notEqual(boundaryKey({ view: 'releases', pid: 'p1' }), boundaryKey({ view: 'releases', pid: 'p1', id: 'r1' }), 'список и релиз')
  assert.notEqual(boundaryKey({ view: 'incidents', pid: 'p1', id: 'i1' }), boundaryKey({ view: 'incidents', pid: 'p1', id: 'i2' }))
  assert.equal(boundaryKey({ view: 'runners' }), 'runners', 'экран установки от проекта не зависит')
})
