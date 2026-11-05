import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundaryKey } from './boundaryKey.ts'

test('ключ границы ошибок меняется со сменой экрана, а не на каждом адресе', () => {
  assert.equal(boundaryKey({ view: 'runners' }, 'p1'), 'runners')
  assert.equal(boundaryKey({ view: 'epic', id: 'e1' }, 'p1'), boundaryKey({ view: 'epic', id: 'e1', taskId: 't7' }, 'p1'),
    'открытая задача не сбрасывает дашборд')
  assert.notEqual(boundaryKey({ view: 'epic', id: 'e1' }, null), boundaryKey({ view: 'epic', id: 'e2' }, null))
  assert.equal(boundaryKey({ view: 'project-settings', id: 'p1', tab: 'general' }, null), boundaryKey({ view: 'project-settings', id: 'p1', tab: 'policies' }, null))
  assert.equal(boundaryKey({ view: 'app-management', tab: 'users' }, null), boundaryKey({ view: 'app-management', tab: 'connections' }, null),
    'вкладки управления — своя граница внутри раздела')
  assert.notEqual(boundaryKey({ view: 'overview', period: '7d' }, 'p1'), boundaryKey({ view: 'overview', period: '7d' }, 'p2'))
  assert.equal(boundaryKey({ view: 'architecture', tab: 'hld' }, 'p1'), boundaryKey({ view: 'architecture', tab: 'erd' }, 'p1'),
    'вкладка архитектуры не перемонтирует экран')
  assert.notEqual(boundaryKey({ view: 'architecture', tab: 'hld' }, 'p1'), boundaryKey({ view: 'architecture', tab: 'hld' }, 'p2'))
})

test('экраны проекта сбрасываются сменой проекта, релиз и инцидент — ещё и сменой id', () => {
  for (const view of ['epics', 'tasks', 'team', 'activity'] as const) {
    assert.notEqual(boundaryKey({ view }, 'p1'), boundaryKey({ view }, 'p2'), view)
    assert.equal(boundaryKey({ view }, 'p1'), boundaryKey({ view }, 'p1'), view)
  }
  assert.notEqual(boundaryKey({ view: 'releases' }, 'p1'), boundaryKey({ view: 'releases' }, 'p2'))
  assert.notEqual(boundaryKey({ view: 'releases' }, 'p1'), boundaryKey({ view: 'releases', id: 'r1' }, 'p1'), 'список и релиз')
  assert.notEqual(boundaryKey({ view: 'incidents', id: 'i1' }, 'p1'), boundaryKey({ view: 'incidents', id: 'i2' }, 'p1'))
  assert.equal(boundaryKey({ view: 'runners' }, 'p1'), boundaryKey({ view: 'runners' }, 'p2'), 'экран установки от проекта не зависит')
})
