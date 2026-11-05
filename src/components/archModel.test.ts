import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArchitectureData, C4Element, Decision, Event } from '../api/client'
import {
  archErrorInfo, architectureEventStale, archRouteHash, crumbs, defectHints, eventAfterLoad, outsideDocsFailure, outsideDocsOf, diagramKind, drillTarget, elementLevel, filterDecisions, filterScenarios, hldLinkURL,
  hostingFileURL, levelElements, linkCounts, normalizeData, c4MacroType, c4NodeSignature, docLinkURL, matchC4Nodes, parseC4Shapes, parseArchRoute, parseStatusFilter,
  resolveLevel, shownSnapshot, statusFilterParam, taskActive,
} from './archModel.ts'

const el = (id: string, kind: string, name: string, parent: string | null = null, external = false): C4Element =>
  ({ id, kind, name, description: '', technology: '', external, parent })

const view = (t: string) => ({ title: t, mermaid: `C4Context\ntitle ${t}` })

function crm(): ArchitectureData {
  return normalizeData({
    system: { name: 'CRM', description: '' },
    elements: [
      el('biz.manager', 'person', 'Менеджер'),
      el('crm', 'system', 'CRM'),
      el('mail', 'system', 'Почта', null, true),
      el('app.web', 'container', 'Веб-клиент', 'crm'),
      el('app.api', 'container', 'API', 'crm'),
      el('tech.db', 'database', 'Хранилище', 'crm'),
      el('app.api.contacts', 'component', 'Контакты API', 'app.api'),
    ],
    views: {
      context: view('контекст'),
      containers: [{ system_id: 'crm', view: view('контейнеры') }],
      components: [{ container_id: 'app.api', view: view('компоненты') }],
      deployment: null,
    },
    scenarios: [
      { id: 'sc.a', title: 'А', description: '', process: null, participants: [{ id: 'app.api', name: 'API', alias: 'n_app_api', kind: 'participant' }], view: view('a') },
      { id: 'sc.b', title: 'Б', description: '', process: 'biz.lead', participants: [], view: view('b') },
    ],
    links: { 'app.api': { decisions: [1, 2], scenarios: ['sc.a'] } },
  })!
}

test('адрес архитектуры: вкладка, уровень, id и фильтры туда и обратно', () => {
  const r = parseArchRoute(['c4', 'components', 'app.api'], 'el=app.api.contacts')
  assert.deepEqual(r, { tab: 'c4', sub: 'components', id: 'app.api', el: 'app.api.contacts' })
  assert.equal(archRouteHash(r), '#/architecture/c4/components/app.api?el=app.api.contacts')
  assert.deepEqual(parseArchRoute(['nope'], ''), { tab: 'hld' })
  assert.equal(archRouteHash({ tab: 'decisions', sub: '3', status: 'all' }), '#/architecture/decisions/3?status=all')
  // Идентификатор с косой чертой не ломает разбор.
  const odd = archRouteHash({ tab: 'erd', sub: 'db/main' })
  assert.deepEqual(parseArchRoute(odd.replace('#/architecture/', '').split('/'), ''), { tab: 'erd', sub: 'db/main' })
})

test('старый снимок без ERD, сценариев и решений считается пустым', () => {
  const d = normalizeData({ system: { name: 'X', description: '' }, elements: [], views: { context: view('c'), containers: [], components: [], deployment: null }, hld: '', dsl: '' } as Partial<ArchitectureData>)!
  assert.deepEqual(d.erd, { all: null, stores: [], entities: [] })
  assert.deepEqual(d.scenarios, [])
  assert.deepEqual(d.decisions, [])
  assert.deepEqual(d.links, {})
})

test('показывается текущий снимок, иначе последняя корректная версия', () => {
  const d = crm()
  const base = { project_id: 'p', defects: [], source: { branch: 'main', path: 'docs/architecture', url: '' }, task: null, error: null }
  assert.equal(shownSnapshot({ ...base, status: 'ok', sha: 'a', read_at: null, current: d, last_valid: null })?.lastValid, false)
  const s = shownSnapshot({ ...base, status: 'invalid', sha: 'b', read_at: null, current: null, last_valid: { sha: 'a', read_at: null, data: d } })
  assert.equal(s?.sha, 'a'); assert.equal(s?.lastValid, true)
  assert.equal(shownSnapshot({ ...base, status: 'absent', sha: null, read_at: null, current: null, last_valid: null }), null)
})

test('уровни C4: переход вниз, ближайший уровень после удаления, крошки', () => {
  const d = crm()
  assert.deepEqual(resolveLevel(d, 'components', 'app.api'), { lvl: { level: 'components', id: 'app.api' }, fallback: false })
  // Компонентов у веб-клиента нет: ближайший уровень — контейнеры CRM.
  assert.deepEqual(resolveLevel(d, 'components', 'app.web'), { lvl: { level: 'containers', id: 'crm' }, fallback: true })
  assert.deepEqual(resolveLevel(d, 'components', 'gone'), { lvl: { level: 'context' }, fallback: true })
  assert.deepEqual(resolveLevel(d, 'containers', 'mail'), { lvl: { level: 'context' }, fallback: true })
  assert.deepEqual(resolveLevel(d), { lvl: { level: 'context' }, fallback: false })

  const byIdOf = (id: string) => d.elements.find(e => e.id === id)!
  assert.deepEqual(drillTarget(d, byIdOf('crm')), { level: 'containers', id: 'crm' })
  assert.deepEqual(drillTarget(d, byIdOf('app.api')), { level: 'components', id: 'app.api' })
  assert.equal(drillTarget(d, byIdOf('app.web')), null)
  assert.equal(drillTarget(d, byIdOf('mail')), null)

  assert.deepEqual(levelElements(d, { level: 'context' }).map(e => e.id), ['biz.manager', 'crm', 'mail'])
  assert.deepEqual(levelElements(d, { level: 'containers', id: 'crm' }).map(e => e.id), ['app.web', 'app.api', 'tech.db'])

  assert.deepEqual(crumbs(d, { level: 'components', id: 'app.api' }).map(c => c.label), ['Контекст', 'CRM · контейнеры', 'API · компоненты'])

  assert.deepEqual(elementLevel(d, 'app.api.contacts'), { level: 'components', id: 'app.api' })
  assert.deepEqual(elementLevel(d, 'tech.db'), { level: 'containers', id: 'crm' })
  assert.deepEqual(elementLevel(d, 'biz.manager'), { level: 'context' })
  assert.deepEqual(elementLevel(d, 'data.contact'), { level: 'context' })
})

test('узел C4 узнаётся по типу и имени из исходника схемы, а не по описанию', () => {
  const els: C4Element[] = [
    { ...el('app.pay', 'container', 'Платёжный шлюз', 'crm'), alias: 'n_app_pay' },
    { ...el('ext.pay', 'system', 'Платёжный шлюз', null, true), alias: 'n_ext_pay' },
    { ...el('app.orders', 'container', 'Сервис "Заказы"', 'crm'), alias: 'n_app_orders' },
    { ...el('tech.orders', 'database', 'Заказы клиентов', 'crm'), alias: 'n_tech_orders' },
    { ...el('app.a', 'component', 'Заказы', 'app.orders'), alias: 'n_a' },
    { ...el('app.b', 'component', 'Заказы', 'app.orders'), alias: 'n_b' },
  ]
  // Так бэкенд пишет схему: кавычки в имени заменены одинарными.
  const code = [
    'C4Container',
    '  title Контейнеры: CRM',
    '  System_Ext(n_ext_pay, "Платёжный шлюз", "")',
    '  System_Boundary(n_system, "CRM") {',
    '    Container(n_app_pay, "Платёжный шлюз", "Go", "адаптер")',
    '    Container(n_app_orders, "Сервис \'Заказы\'", "Go", "Заказы клиентов")',
    '    ContainerDb(n_tech_orders, "Заказы клиентов", "PostgreSQL", "")',
    '  }',
  ].join('\n')
  assert.deepEqual(parseC4Shapes(code).map(x => x.type), ['external_system', 'container', 'container', 'container_db'])
  const sig = (type: string, ...name: string[]) => c4NodeSignature([
    { text: `<<${type}>>`, bold: false }, ...name.map(text => ({ text, bold: true })),
    { text: '[Go]', bold: false }, { text: 'Заказы клиентов', bold: false },
  ])
  const nodes = [
    sig('container', 'Платёжный шлюз'),
    sig('external_system', 'Платёжный шлюз'),
    // Имя перенесено на две строки, в описании — имя базы.
    sig('container', "Сервис 'Заказы'"),
    sig('container_db', 'Заказы', 'клиентов'),
    sig('container', 'Неизвестный'),
  ]
  assert.deepEqual(matchC4Nodes(code, nodes, els).map(e => e?.id), ['app.pay', 'ext.pay', 'app.orders', 'tech.orders', undefined])
  // Полные тёзки одного типа — по порядку объявления.
  const twins = 'C4Component\n  Component(n_a, "Заказы", "", "")\n  Component(n_b, "Заказы", "", "")'
  assert.deepEqual(matchC4Nodes(twins, [sig('component', 'Заказы'), sig('component', 'Заказы')], els).map(e => e?.id), ['app.a', 'app.b'])
  // Директива в имени на схеме не видна: узел всё равно узнаётся.
  const dir = 'C4Context\n  System(n_ext_pay, "Платёжный шлюз %%{init: {\'theme\': \'dark\'}}%%", "")'
  assert.equal(matchC4Nodes(dir, [sig('system', 'Платёжный шлюз')], els)[0]?.id, 'ext.pay')
  assert.equal(c4MacroType('ContainerQueue_Ext'), 'external_container_queue')
  assert.equal(c4MacroType('Person'), 'person')
})

test('вид диаграммы по первой строке', () => {
  assert.equal(diagramKind('%% comment\nC4Container\ntitle x'), 'c4')
  assert.equal(diagramKind('erDiagram\n  A ||--o{ B : has'), 'er')
  assert.equal(diagramKind('sequenceDiagram\n'), 'sequence')
  assert.equal(diagramKind('flowchart LR'), 'other')
})

test('ссылки на хостинг: файл по SHA, относительные ссылки HLD', () => {
  const gh = { url: 'https://github.com/o/r/tree/main/docs/architecture', branch: 'main', path: 'docs/architecture' }
  assert.equal(hostingFileURL(gh, 'abc', 'docs/architecture/adr/0001-x.md'), 'https://github.com/o/r/blob/abc/docs/architecture/adr/0001-x.md')
  assert.equal(hostingFileURL(gh, null, 'a.md'), 'https://github.com/o/r/blob/main/a.md')
  const gl = { url: 'https://gl.example/g/r/-/tree/dev/docs/architecture', branch: 'dev', path: 'docs/architecture' }
  assert.equal(hostingFileURL(gl, 'abc', 'x.md'), 'https://gl.example/g/r/-/blob/abc/x.md')
  assert.equal(hostingFileURL({ url: '', branch: 'main' }, 'abc', 'x.md'), '')
  assert.equal(hldLinkURL(gh, 'abc', 'c4/context.md'), 'https://github.com/o/r/blob/abc/docs/architecture/views/c4/context.md')
  assert.equal(hldLinkURL(gh, 'abc', '../adr/0001-x.md#top'), 'https://github.com/o/r/blob/abc/docs/architecture/adr/0001-x.md')
  // «/tree/» в имени ветки не сбивает префикс репозитория.
  const rel = { url: 'https://github.com/o/r/tree/release/tree/v1/docs/architecture', branch: 'release/tree/v1', path: 'docs/architecture' }
  assert.equal(hostingFileURL(rel, null, 'a.md'), 'https://github.com/o/r/blob/release/tree/v1/a.md')
  // Якорь остаётся текстом, «/путь» — от корня репозитория.
  assert.equal(docLinkURL(gh, 'abc', 'docs/architecture/adr', '#контекст'), '')
  assert.equal(docLinkURL(gh, 'abc', 'docs/architecture/adr', '/README.md'), 'https://github.com/o/r/blob/abc/README.md')
  assert.equal(docLinkURL(gh, 'abc', 'docs/architecture/adr', '0002-y.md#a'), 'https://github.com/o/r/blob/abc/docs/architecture/adr/0002-y.md')
})

test('решения: фильтр статусов по умолчанию и в адресе, фильтр по элементу', () => {
  const dec = (number: number, status: string, elements: string[] = []): Decision =>
    ({ number, slug: '', title: '', status, date: '', elements, supersedes: [], superseded_by: null, body: '', path: '' })
  const list = [dec(3, 'rejected'), dec(1, 'accepted', ['app.api']), dec(2, 'superseded', ['app.api']), dec(4, 'proposed')]
  assert.deepEqual(parseStatusFilter(undefined), ['accepted', 'proposed'])
  assert.deepEqual(filterDecisions(list, parseStatusFilter(undefined)).map(d => d.number), [1, 4])
  assert.deepEqual(filterDecisions(list, parseStatusFilter('all'), 'app.api').map(d => d.number), [1, 2])
  assert.deepEqual(parseStatusFilter('superseded,bogus'), ['superseded'])
  assert.equal(statusFilterParam(['proposed', 'accepted']), undefined)
  assert.equal(statusFilterParam(['accepted', 'proposed', 'superseded', 'deprecated', 'rejected']), 'all')
  assert.equal(statusFilterParam(['rejected', 'accepted']), 'accepted,rejected')
})

test('сценарии элемента и счётчики связей', () => {
  const d = crm()
  assert.deepEqual(filterScenarios(d, 'app.api').map(s => s.id), ['sc.a'])
  assert.deepEqual(filterScenarios(d, 'biz.lead').map(s => s.id), ['sc.b'])
  assert.equal(filterScenarios(d).length, 2)
  assert.deepEqual(linkCounts(d, 'app.api'), { decisions: 2, scenarios: 1 })
  assert.deepEqual(linkCounts(d, 'mail'), { decisions: 0, scenarios: 0 })
})

test('задача описания активна, пока не завершилась', () => {
  assert.equal(taskActive('running'), true)
  assert.equal(taskActive('review'), true)
  assert.equal(taskActive('failed'), false)
  assert.equal(taskActive('done'), false)
  assert.equal(taskActive(undefined), false)
})

test('ошибка снимка по виду: учётные данные, хостинг, лимит, данные', () => {
  const nc = archErrorInfo('no_credentials')
  assert.equal(nc.settings, true); assert.equal(nc.describe, false); assert.equal(nc.showReason, false)
  // Заголовок не повторяет причину бэкенда: она выводится отдельно.
  assert.equal(archErrorInfo('host').title, 'Хостинг не ответил')
  assert.equal(archErrorInfo('host').describe, false)
  assert.match(archErrorInfo('limit').hint, /600 файлов и 8 МиБ/)
  assert.equal(archErrorInfo('limit').describe, false)
  assert.equal(archErrorInfo('data').describe, true)
  assert.equal(archErrorInfo(undefined).title, 'Описание не удалось прочитать')
})

test('PR задачи описания вне docs/architecture: файлы, merged, сброс после возврата в работу', () => {
  const ev = (ID: number, Type: string, Payload: Record<string, unknown>, Text = ''): Event =>
    ({ ID, TS: '2026-11-04T10:00:00Z', ActorKind: 'system', ActorID: '', Type, ProjectID: '', EpicID: '', TaskID: 't', Text, Payload })
  const out = ev(2, 'task.status', { status: 'failed', reason: 'architecture_outside_docs', files: ['src/app.js', 7, 'README.md'], merged: true }, 'PR меняет файлы')
  assert.deepEqual(outsideDocsOf([ev(1, 'task.status', { status: 'review' }), out]), { reason: 'architecture_outside_docs', files: ['src/app.js', 'README.md'], total: 2, merged: true, message: 'PR меняет файлы' })
  assert.equal(outsideDocsOf([out, ev(3, 'task.status', { status: 'ready' })]), null)
  assert.equal(outsideDocsOf([ev(1, 'task.status', { status: 'failed', reason: 'other' })]), null)
  assert.equal(outsideDocsOf(null), null)
  // Поле failure: урезанный список и общее число.
  assert.deepEqual(outsideDocsFailure({ reason: 'architecture_outside_docs', message: 'm', files: ['a', 'b'], files_total: 12, merged: false }), { reason: 'architecture_outside_docs', files: ['a', 'b'], total: 12, merged: false, message: 'm' })
  assert.deepEqual(outsideDocsFailure({ reason: 'architecture_files_truncated', message: 'неполный', files: [], files_total: 0, merged: true }), { reason: 'architecture_files_truncated', files: [], total: 0, merged: true, message: 'неполный' })
  assert.deepEqual(defectHints([{ rule: 'file.symlink' }, { rule: 'views.stale' }, { rule: 'ref.unresolved' }]).length, 2)
  assert.deepEqual(defectHints([{ rule: 'ref.unresolved' }]), [])
  assert.equal(outsideDocsFailure({ reason: 'other' }), null)
  assert.equal(outsideDocsFailure(null), null)
})

test('событие снимка: тот же снимок и реплей истории не перечитываются', () => {
  const arch = { project_id: 'p', status: 'ok', sha: 'b', read_at: '2026-11-04T10:00:00Z', error: null, defects: [],
    source: { branch: 'main', path: 'docs/architecture', url: '' }, current: null, last_valid: null, task: null }
  const ev = (TS: string, sha: string, status = 'ok'): Event =>
    ({ ID: 1, TS, ActorKind: 'system', ActorID: '', Type: 'project.architecture_updated', ProjectID: 'p', EpicID: '', TaskID: '', Text: '', Payload: { sha, status } })
  assert.equal(architectureEventStale(ev('2026-11-04T10:00:05Z', 'b'), arch), true)
  assert.equal(architectureEventStale(ev('2026-11-04T09:00:00Z', 'a'), arch), true)
  assert.equal(architectureEventStale(ev('2026-11-04T10:00:05Z', 'c'), arch), false)
  assert.equal(architectureEventStale(ev('2026-11-04T10:00:05Z', 'b', 'invalid'), arch), false)
  assert.equal(architectureEventStale(ev('2026-11-04T09:00:00Z', 'a'), null), false)
})

test('событие задачи после загрузки снимка: только по часам сервера', () => {
  const at = Date.parse('2026-11-04T10:00:00Z')
  assert.equal(eventAfterLoad('2026-11-04T09:59:59.500Z', at), true) // секунда запаса на точность Date
  assert.equal(eventAfterLoad('2026-11-04T09:59:58Z', at), false)
  assert.equal(eventAfterLoad('2026-11-04T10:00:03Z', at), true)
  assert.equal(eventAfterLoad('2026-11-04T09:00:00Z', null), true)
  assert.equal(eventAfterLoad('не время', at), true)
})
