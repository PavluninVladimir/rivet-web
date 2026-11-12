import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { agentDestination, phaseDestination, summaryDestinations } from './cycleNavigation.ts'
import { parseHash, routeHash, switchProject, type Route } from '../routes.ts'
import { reportRange } from './overviewLogic.ts'

function roundtrip(route: Route) {
  assert.deepEqual(parseHash(routeHash(route)), { kind: 'route', route })
}

test('мигающий аватар адресует точного агента, фазу и период, deep link переживает перезагрузку', () => {
  const to = agentDestination('project-a', 'development', '30d', 'max')
  assert.equal(routeHash(to), '#/p/project-a/cycle?phase=development&period=30d&agent=max&focus=agents')
  roundtrip(to)
  const other = switchProject(to, 'project-b')
  assert.equal('agentId' in other, false, 'агент прежнего проекта не переносится')
  assert.equal(routeHash(other), '#/p/project-b/cycle?phase=development&period=30d&focus=agents')
})

test('счётчики ведут в свои элементы и материалы, фильтр применяется только к текущим элементам', () => {
  roundtrip(phaseDestination('p', 'testing', 'today', 'items', 'needs_human'))
  roundtrip(phaseDestination('p', 'review', '7d', 'artifacts'))
  assert.equal(phaseDestination('p', 'review', '7d', 'artifacts', 'active').state, undefined)
  assert.deepEqual(parseHash('#/p/p/cycle?phase=review&focus=artifacts&state=active&agent=invalid%2Fid'), {
    kind: 'route', route: { view: 'cycle', pid: 'p', phase: 'review', focus: 'artifacts' },
  })
  assert.deepEqual(parseHash('#/p/p/cycle?phase=bad&agent=max&focus=items&state=active'), {
    kind: 'route', route: { view: 'cycle', pid: 'p' },
  })
})

test('центральные метрики сохраняют проект и точный релиз, деньги сохраняют период и финансовую секцию', () => {
  const to = summaryDestinations('project-a', '30d', { last_release: { id: 'release-1' } as never })
  assert.equal(routeHash(to.agents), '#/p/project-a/team')
  assert.equal(routeHash(to.incidents), '#/p/project-a/incidents')
  assert.equal(routeHash(to.release), '#/p/project-a/releases/release-1')
  assert.equal(routeHash(to.money), '#/p/project-a/overview/30d?focus=money')
  roundtrip(to.money)
  assert.equal(routeHash(summaryDestinations('p', 'today', { last_release: null }).release), '#/p/p/releases')
  assert.deepEqual(switchProject(to.money, 'b'), { view: 'overview', pid: 'b', period: '30d', focus: 'money' })
})

test('отчёт цикла today и 30d использует существующий API диапазонов без сброса на 7 дней', () => {
  const now = new Date(2026, 10, 12, 15, 30)
  const today = reportRange('today', now, { from: '', to: '' })
  const month = reportRange('30d', now, { from: '', to: '' })
  assert.deepEqual(today, { from: new Date(2026, 10, 12).toISOString(), to: now.toISOString() })
  assert.deepEqual(month, { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() })
  assert.deepEqual(reportRange('7d', now, { from: '', to: '' }), {}, 'прежний серверный период по умолчанию сохраняется')
  assert.equal(now.getHours(), 15, 'входная дата не мутирует')
})

test('30 дней совпадают с elapsed окном backend при переходе DST, без лишнего часа', () => {
  const source = new URL('./overviewLogic.ts', import.meta.url).href
  const script = `import { reportRange } from ${JSON.stringify(source)};
    const now = new Date(2026, 10, 12, 15, 30);
    const range = reportRange('30d', now, {from:'',to:''});
    console.log(JSON.stringify({range,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}));`
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  }))
  assert.equal(result.timezone, 'America/New_York')
  assert.equal(Date.parse(result.range.to) - Date.parse(result.range.from), 30 * 24 * 60 * 60 * 1000)
  assert.equal(result.range.from, '2026-10-13T20:30:00.000Z')
})
