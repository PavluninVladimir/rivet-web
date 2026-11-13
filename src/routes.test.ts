import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECT_SECTIONS, activeItem, crumbs, isSubPage, parseHash, projectHome, resolveLegacy, routeHash, sectionRoute, switchProject, withProject,
  type Parsed, type Route,
} from './routes.ts'

const P = 'p-1'

function route(hash: string): Route {
  const p = parseHash(hash)
  assert.equal(p.kind, 'route', `${hash}: ${JSON.stringify(p)}`)
  return (p as Extract<Parsed, { kind: 'route' }>).route
}

function legacy(hash: string, last: string | null): string {
  const p = parseHash(hash)
  assert.notEqual(p.kind, 'route', `${hash} разобран как новый адрес`)
  return routeHash(resolveLegacy(p as Exclude<Parsed, { kind: 'route' }>, last))
}

test('экраны проекта: адрес с проектом собирается и разбирается обратно', () => {
  const cases: [Route, string][] = [
    [{ view: 'overview', pid: P, period: '7d' }, `#/p/${P}/overview`],
    [{ view: 'overview', pid: P, period: '30d' }, `#/p/${P}/overview/30d`],
    [{ view: 'assistant', pid: P }, `#/p/${P}/assistant`],
    [{ view: 'design', pid: P }, `#/p/${P}/design`],
    [{ view: 'discovery', pid: P }, `#/p/${P}/discovery`],
    [{ view: 'discovery', pid: P, runId: 'r9' }, `#/p/${P}/discovery/r9`],
    [{ view: 'architecture', pid: P, tab: 'hld' }, `#/p/${P}/architecture/hld`],
    [{ view: 'architecture', pid: P, tab: 'c4', sub: 'components', id: 'app.api', el: 'app.api.db' }, `#/p/${P}/architecture/c4/components/app.api?el=app.api.db`],
    [{ view: 'architecture', pid: P, tab: 'decisions', sub: '3', status: 'all' }, `#/p/${P}/architecture/decisions/3?status=all`],
    [{ view: 'epics', pid: P }, `#/p/${P}/epics`],
    [{ view: 'epic', pid: P, id: 'e1' }, `#/p/${P}/epic/e1`],
    [{ view: 'epic', pid: P, id: 'e1', taskId: 't7' }, `#/p/${P}/epic/e1/task/t7`],
    [{ view: 'tasks', pid: P }, `#/p/${P}/tasks`],
    [{ view: 'cycle', pid: P }, `#/p/${P}/cycle`],
    [{ view: 'cycle', pid: P, phase: 'review', period: '30d' }, `#/p/${P}/cycle?phase=review&period=30d`],
    [{ view: 'releases', pid: P }, `#/p/${P}/releases`],
    [{ view: 'releases', pid: P, id: 'rel1' }, `#/p/${P}/releases/rel1`],
    [{ view: 'incidents', pid: P, id: 'inc1' }, `#/p/${P}/incidents/inc1`],
    [{ view: 'team', pid: P }, `#/p/${P}/team`],
    [{ view: 'activity', pid: P }, `#/p/${P}/activity`],
    [{ view: 'project-settings', pid: P, tab: 'general' }, `#/p/${P}/settings`],
    [{ view: 'project-settings', pid: P, tab: 'members' }, `#/p/${P}/settings/members`],
  ]
  for (const [r, hash] of cases) {
    assert.equal(routeHash(r), hash)
    assert.deepEqual(route(hash), r, hash)
  }
})

test('экраны установки проекта в адресе не несут', () => {
  const cases: [Route, string][] = [
    [{ view: 'projects' }, '#/projects'],
    [{ view: 'mysteps' }, '#/mysteps'],
    [{ view: 'runners' }, '#/runners'],
    [{ view: 'usage' }, '#/usage'],
    [{ view: 'profile' }, '#/profile'],
    [{ view: 'app-management', tab: 'connections' }, '#/app-management/connections'],
  ]
  for (const [r, hash] of cases) {
    assert.equal(routeHash(r), hash)
    assert.deepEqual(route(hash), r, hash)
  }
  assert.deepEqual(route('#/app-management/models'), { view: 'app-management', tab: 'connections' }, 'старая вкладка «Модели»')
  assert.deepEqual(route('#/app-management/nope'), { view: 'app-management', tab: 'users' })
})

test('адрес проекта без раздела и с неизвестным разделом открывает обзор', () => {
  assert.deepEqual(route(`#/p/${P}`), projectHome(P))
  assert.deepEqual(route(`#/p/${P}/`), projectHome(P))
  assert.deepEqual(route(`#/p/${P}/nope/1`), projectHome(P))
  assert.deepEqual(route(`#/p/${P}/epic`), { view: 'epics', pid: P }, 'дашборд без id — список')
  assert.deepEqual(route(`#/p/${P}/settings/nope`), { view: 'project-settings', pid: P, tab: 'general' })
  assert.deepEqual(route(`#/p/${P}/cycle?phase=nope&period=year`), { view: 'cycle', pid: P }, 'неизвестные фаза и период отбрасываются')
  assert.deepEqual(parseHash('#/p/'), { kind: 'home' }, 'проект пустой')
})

test('проект с необычными символами переживает сборку и разбор', () => {
  const odd = 'a b/c?d'
  const hash = routeHash({ view: 'epics', pid: odd })
  assert.equal(hash, '#/p/a%20b%2Fc%3Fd/epics')
  assert.deepEqual(route(hash), { view: 'epics', pid: odd })
})

test('старые адреса без проекта ведут в последний открытый проект', () => {
  const last = 'last'
  const cases: [string, string][] = [
    ['#/epics', `#/p/${last}/epics`],
    ['#/tasks', `#/p/${last}/tasks`],
    ['#/team', `#/p/${last}/team`],
    ['#/activity', `#/p/${last}/activity`],
    ['#/overview', `#/p/${last}/overview`],
    ['#/overview/month', `#/p/${last}/overview/month`],
    ['#/discovery/r2', `#/p/${last}/discovery/r2`],
    ['#/architecture/c4/components/app.api?el=x', `#/p/${last}/architecture/c4/components/app.api?el=x`],
    ['#/architecture', `#/p/${last}/architecture/hld`],
    ['#/releases', `#/p/${last}/releases`],
    ['#/incidents/i1', `#/p/${last}/incidents/i1`],
    ['#/epic/e1/task/t1', `#/p/${last}/epic/e1/task/t1`],
  ]
  for (const [old, next] of cases) assert.equal(legacy(old, last), next, old)
})

test('старый адрес без известного проекта открывает «Проекты»', () => {
  for (const old of ['#/epics', '#/architecture/c4', '#/epic/e1', '#/cycle', '#/releases/r1']) {
    assert.equal(legacy(old, null), '#/projects', old)
  }
})

test('старые адреса с проектом сохраняют свой проект', () => {
  assert.equal(legacy('#/project/x1/cycle?phase=review&period=30d', 'last'), '#/p/x1/cycle?phase=review&period=30d')
  assert.equal(legacy('#/project/x1/cycle', null), '#/p/x1/cycle')
  assert.equal(legacy('#/project/x1/settings/members', 'last'), '#/p/x1/settings/members')
  assert.equal(legacy('#/project/x1/settings', null), '#/p/x1/settings')
  assert.equal(legacy('#/cycle/x2?period=today', 'last'), '#/p/x2/cycle?period=today', 'самый ранний адрес цикла')
  assert.equal(legacy('#/cycle', 'last'), '#/p/last/cycle')
})

test('старый адрес Epic’а несёт Epic и задачу: проект стор подставляет из Epic’а', () => {
  const p = parseHash('#/epic/e1/task/t1')
  assert.deepEqual(p, { kind: 'legacy', target: { view: 'epic', id: 'e1', taskId: 't1' } })
})

test('пустой и неизвестный адрес: обзор последнего проекта или «Проекты»', () => {
  for (const h of ['', '#', '#/', '#/nope', '#/project/x1', '#/project/x1/epics', '#/settings']) {
    assert.deepEqual(parseHash(h), { kind: 'home' }, h)
    assert.equal(legacy(h, 'last'), '#/p/last/overview', h)
    assert.equal(legacy(h, null), '#/projects', h)
  }
})

test('цель без проекта получает текущий проект', () => {
  assert.deepEqual(withProject({ view: 'epic', id: 'e1' }, P), { view: 'epic', id: 'e1', pid: P })
  assert.deepEqual(withProject({ view: 'epic', id: 'e1', pid: 'other' }, P), { view: 'epic', id: 'e1', pid: 'other' }, 'свой проект цели важнее')
  assert.deepEqual(withProject({ view: 'tasks' }, null), { view: 'projects' }, 'без проекта экран проекта не открывается')
  assert.deepEqual(withProject({ view: 'runners' }, P), { view: 'runners' })
  assert.deepEqual(withProject({ view: 'app-management', tab: 'users' }, null), { view: 'app-management', tab: 'users' })
})

test('переключение проекта оставляет раздел и сбрасывает объект', () => {
  const B = 'p-2'
  const cases: [Route, Route][] = [
    [{ view: 'epic', pid: P, id: 'e1', taskId: 't1' }, { view: 'epics', pid: B }],
    [{ view: 'releases', pid: P, id: 'r1' }, { view: 'releases', pid: B }],
    [{ view: 'incidents', pid: P, id: 'i1' }, { view: 'incidents', pid: B }],
    [{ view: 'discovery', pid: P, runId: 'r1' }, { view: 'discovery', pid: B }],
    [{ view: 'architecture', pid: P, tab: 'c4', sub: 'components', id: 'x', el: 'y' }, { view: 'architecture', pid: B, tab: 'c4' }],
    [{ view: 'overview', pid: P, period: '30d' }, { view: 'overview', pid: B, period: '30d' }],
    [{ view: 'cycle', pid: P, phase: 'release', period: 'today' }, { view: 'cycle', pid: B, phase: 'release', period: 'today' }],
    [{ view: 'cycle', pid: P }, { view: 'cycle', pid: B }],
    [{ view: 'project-settings', pid: P, tab: 'policies' }, { view: 'project-settings', pid: B, tab: 'policies' }],
    [{ view: 'tasks', pid: P }, { view: 'tasks', pid: B }],
    [{ view: 'runners' }, projectHome(B)],
  ]
  for (const [from, to] of cases) assert.deepEqual(switchProject(from, B), to, from.view)
})

test('пункты меню проекта: порядок и экраны по умолчанию', () => {
  assert.deepEqual(PROJECT_SECTIONS.map(s => s.label), ['Обзор', 'Ассистент', 'Исследование', 'Дизайн-система', 'Архитектура', 'Epic’и', 'Задачи',
    'Цикл разработки', 'Релизы', 'Инциденты', 'Команда', 'Активность', 'Настройки'])
  assert.equal(routeHash(sectionRoute('overview', P)), `#/p/${P}/overview`)
  assert.equal(routeHash(sectionRoute('architecture', P)), `#/p/${P}/architecture/hld`)
  assert.equal(routeHash(sectionRoute('project-settings', P)), `#/p/${P}/settings`)
  assert.equal(routeHash(sectionRoute('cycle', P)), `#/p/${P}/cycle`)
})

test('крошки: «Проекты / проект / раздел», имя проекта ведёт в обзор', () => {
  assert.deepEqual(crumbs({ view: 'tasks', pid: P }, 'Alpha'), [
    { label: 'Проекты', href: '#/projects' }, { label: 'Alpha', href: `#/p/${P}/overview` }, { label: 'Задачи' },
  ])
  assert.deepEqual(crumbs({ view: 'epic', pid: P, id: 'e1' }, 'Alpha').slice(2), [
    { label: 'Epic’и', href: `#/p/${P}/epics` }, { label: 'дашборд' },
  ])
  assert.deepEqual(crumbs({ view: 'releases', pid: P, id: 'r1' }, 'Alpha').slice(2), [
    { label: 'Релизы', href: `#/p/${P}/releases` }, { label: 'релиз' },
  ])
  assert.deepEqual(crumbs({ view: 'project-settings', pid: P, tab: 'members' }, 'Alpha').slice(2), [{ label: 'Настройки' }])
  assert.deepEqual(crumbs({ view: 'runners' }, 'Alpha'), [{ label: 'Runner’ы' }], 'экран установки — только название')
  assert.deepEqual(crumbs({ view: 'app-management', tab: 'users' }, ''), [{ label: 'Управление приложением' }])
})

test('пункт меню экрана и отметка родителя у вложенных экранов', () => {
  assert.equal(activeItem({ view: 'epic', pid: P, id: 'e1' }), 'epics')
  assert.equal(isSubPage({ view: 'epic', pid: P, id: 'e1' }), true)
  assert.equal(isSubPage({ view: 'releases', pid: P, id: 'r1' }), true)
  assert.equal(isSubPage({ view: 'incidents', pid: P }), false)
  assert.equal(isSubPage({ view: 'epics', pid: P }), false)
  assert.equal(isSubPage({ view: 'runners' }), false)
})
