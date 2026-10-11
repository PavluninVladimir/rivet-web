import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutProcess, resolveTransitions } from './processLayout.ts'
import type { ProcessDoc } from '../api/client'

// Раскладка графа процесса: переходы по умолчанию повторяют policy.Resolve,
// узлы стоят по хребту в порядке документа, терминалы на месте.

const DEFAULT: ProcessDoc = { steps: [
  { id: 'code', kind: 'code', participants: [{ agent: {} }] },
  { id: 'test', kind: 'test', participants: [{ agent: {} }] },
  { id: 'review', kind: 'review', participants: [{ agent: {} }] },
  { id: 'merge', kind: 'merge' },
  { id: 'deploy', kind: 'deploy' },
] }

test('процесс по умолчанию: ok по хребту, changes к code, fail к эскалации', () => {
  const t = resolveTransitions(DEFAULT)
  assert.deepEqual(t.get('code'), { ok: { to: 'test', explicit: false }, changes: { to: 'code', explicit: false }, fail: { to: 'escalate', explicit: false } })
  assert.deepEqual(t.get('review')!.ok, { to: 'merge', explicit: false })
  assert.deepEqual(t.get('review')!.changes, { to: 'code', explicit: false })
  assert.deepEqual(t.get('merge'), { ok: { to: 'deploy', explicit: false }, changes: null, fail: null })
  assert.deepEqual(t.get('deploy')!.ok, { to: 'done', explicit: false })

  const lay = layoutProcess(DEFAULT)
  const steps = lay.nodes.filter(n => n.kind === 'step')
  assert.equal(steps.length, 5)
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].x > steps[i - 1].x, 'узлы идут слева направо')
  assert.ok(lay.nodes.some(n => n.kind === 'done'))
  assert.ok(lay.nodes.some(n => n.kind === 'escalate'))
  assert.equal(lay.edges.length, 3 + 3 + 3 + 1 + 1)
  assert.equal(lay.gaps.length, 5)
  assert.ok(lay.edges.every(e => e.d.startsWith('M')))
})

test('два review и явные переходы: выключенный шаг пропускается, явное ребро помечено', () => {
  const doc: ProcessDoc = { steps: [
    { id: 'code', kind: 'code', participants: [{ agent: {} }] },
    { id: 'test', kind: 'test', enabled: false, participants: [{ agent: {} }] },
    { id: 'review', kind: 'review', participants: [{ agent: {} }, { user: { role: 'owner' } }], on: { changes: 'code' } },
    { id: 'review2', kind: 'review', participants: [{ agent: { kind: 'codex' } }], on: { fail: 'review' } },
    { id: 'merge', kind: 'merge' },
  ] }
  const t = resolveTransitions(doc)
  assert.equal(t.has('test'), false, 'у выключенного шага нет переходов')
  assert.deepEqual(t.get('code')!.ok, { to: 'review', explicit: false })
  assert.deepEqual(t.get('review')!.changes, { to: 'code', explicit: true })
  assert.deepEqual(t.get('review2')!.fail, { to: 'review', explicit: true })
  assert.deepEqual(t.get('review2')!.changes, { to: 'code', explicit: false })

  const lay = layoutProcess(doc)
  const failBack = lay.edges.find(e => e.id === 'review2:fail')!
  assert.equal(failBack.to, 'review')
  assert.ok(failBack.explicit)
  const ids = lay.edges.map(e => e.id)
  assert.deepEqual(ids.slice(0, 3), ['code:ok', 'code:changes', 'code:fail'], 'порядок фокуса по хребту')
  assert.ok(lay.w > 0 && lay.h > 0)
})

test('явный ok → escalate у merge даёт узел эскалации, ok → done не с конца оставляет место под дугу', () => {
  const doc: ProcessDoc = { steps: [
    { id: 'merge', kind: 'merge', on: { ok: 'escalate' } },
    { id: 'deploy', kind: 'deploy' },
  ] }
  const lay = layoutProcess(doc)
  assert.ok(lay.nodes.some(n => n.kind === 'escalate'), 'узел эскалации есть')
  assert.ok(lay.edges.some(e => e.id === 'merge:ok' && e.to === 'escalate'))

  const doc2: ProcessDoc = { steps: [
    { id: 'code', kind: 'code', participants: [{ agent: {} }], on: { ok: 'done' } },
    { id: 'merge', kind: 'merge' },
  ] }
  const lay2 = layoutProcess(doc2)
  const toDone = lay2.edges.find(e => e.id === 'code:ok')!
  assert.equal(toDone.to, 'done')
  assert.ok(toDone.ly > 0, 'подпись дуги к «готово» не уходит за верхний край')

  const doc3: ProcessDoc = { steps: [
    { id: 'code', kind: 'code', participants: [{ agent: {} }], on: { fail: 'done' } },
    { id: 'merge', kind: 'merge' },
  ] }
  const failDone = layoutProcess(doc3).edges.find(e => e.id === 'code:fail')!
  assert.ok(failDone.ly > 0, 'fail → done рисуется поверху и не клипается')
})
