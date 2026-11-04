import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BACK_ARCS, CENTER, PHASES, RADIUS, backLabelPoint, eventPhase, forwardArc, isCycleEvent, liveTransitions, nodePercent, nodePoint, safeExternal, travelPath } from './cycleGeometry.ts'

// Кольцо: первая фаза сверху, по часовой стрелке, узлы на окружности.

test('восемь фаз, исследование сверху, сопровождение слева сверху', () => {
  assert.equal(PHASES.length, 8)
  assert.deepEqual(nodePoint(0), { x: CENTER, y: CENTER - RADIUS })
  const dev = nodePoint(PHASES.indexOf('development'))
  assert.ok(dev.x > CENTER && dev.y > CENTER, 'разработка справа снизу')
  const ops = nodePoint(PHASES.indexOf('operations'))
  assert.ok(ops.x < CENTER && ops.y < CENTER, 'сопровождение слева сверху')
  assert.deepEqual(nodePercent(0), { left: '50%', top: '11.8%' })
})

test('внешние стрелки — дуги по часовой стрелке', () => {
  for (let i = 0; i < PHASES.length; i++) {
    assert.match(forwardArc(i), /^M [\d.]+ [\d.]+ A 290 290 0 0 1 [\d.]+ [\d.]+$/)
  }
})

test('обратные дуги с подписями внутри кольца', () => {
  assert.deepEqual(BACK_ARCS.filter(a => a.label).map(a => a.label), ['исправление', 'инциденты', 'отзывы'])
  assert.ok(BACK_ARCS.some(a => a.from === 'testing' && a.to === 'development'), 'исправление после тестирования')
  for (const a of BACK_ARCS) {
    const p = backLabelPoint(a.from, a.to)
    assert.ok(Math.hypot(p.x - CENTER, p.y - CENTER) < RADIUS, `${a.label} внутри кольца`)
  }
})

test('путь метки: вперёд по кольцу, назад по дуге, вход и выход через центр', () => {
  assert.match(travelPath('testing', 'review'), / A 290 290 0 0 1 /)
  assert.match(travelPath('discovery', 'operations'), / A 290 290 0 1 1 /)
  assert.match(travelPath('review', 'development'), / Q /)
  assert.match(travelPath(null, 'development'), new RegExp(`^M ${CENTER} ${CENTER} L`))
  assert.match(travelPath('release', null), new RegExp(`L ${CENTER} ${CENTER}$`))
  assert.equal(travelPath('review', 'review'), '')
  assert.equal(travelPath(null, null), '')
})

test('фаза и отбор событий ленты', () => {
  assert.equal(eventPhase('task.step', { phase_from: 'testing', phase_to: 'review' }), 'review')
  assert.equal(eventPhase('task.status', { phase_from: 'release', phase_to: null }), 'release')
  assert.equal(eventPhase('incident.opened', {}), 'operations')
  assert.equal(eventPhase('release.created', {}), 'release')
  assert.equal(eventPhase('ops.job', { kind: 'incident_description' }), 'operations')
  assert.equal(eventPhase('session.step', {}), null)
  assert.ok(isCycleEvent('task.status', { phase_to: 'review' }))
  assert.ok(isCycleEvent('monitor.state', {}))
  assert.ok(!isCycleEvent('task.status', { status: 'running' }))
})

test('анимируются только живые события после последнего виденного', () => {
  const now = Date.parse('2026-11-04T12:00:20Z')
  const ev = (ID: number, TS: string, Payload?: Record<string, unknown>) => ({ ID, TS, Payload })
  const got = liveTransitions([
    ev(5, '2026-11-04T12:00:19Z', { phase_from: 'testing', phase_to: 'review' }),
    ev(3, '2026-11-04T12:00:19Z', { phase_from: 'review', phase_to: 'development' }), // уже виден
    ev(6, '2026-11-04T11:50:00Z', { phase_from: 'review', phase_to: 'development' }), // реплей журнала
    ev(7, '2026-11-04T12:00:18Z', { status: 'running' }), // без фазы
    ev(8, '2026-11-04T12:00:18Z', { phase_from: 'release', phase_to: null }),
  ], 4, now)
  assert.deepEqual(got, [{ id: 5, from: 'testing', to: 'review' }, { id: 8, from: 'release', to: null }])
})

test('внешние ссылки артефактов только http(s)', () => {
  assert.equal(safeExternal('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1')
  assert.equal(safeExternal('javascript:alert(1)'), null)
  assert.equal(safeExternal(undefined), null)
})

test('часы клиента спешат: поправка по generated_at сервера возвращает анимацию', () => {
  const serverNow = Date.parse('2026-11-04T12:00:00Z')
  const clientNow = serverNow + 20_000 // часы клиента спешат на 20 с
  const skew = serverNow - clientNow // из generated_at агрегата
  const ev = { ID: 101, TS: new Date(serverNow - 800).toISOString(), Payload: { phase_from: 'testing', phase_to: 'review' } }
  assert.equal(liveTransitions([ev], 100, clientNow).length, 0, 'без поправки метка пропала бы')
  assert.equal(liveTransitions([ev], 100, clientNow + skew).length, 1, 'с поправкой анимируется')
})
