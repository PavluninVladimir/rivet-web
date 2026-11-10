import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROUP_LIMIT, commandItems, filterItems, initialKey, type EpicWithTasks, type PalItem } from './paletteItems.ts'
import type { Epic, Task } from '../api/client'

// Команды палитры (спека web «Командная палитра»): только допустимые по
// статусу и обратимые действия. Без запроса видны только действия над
// открытыми объектами, по имени объекта находится переход, а не действие.

const epic = (id: string, Status: string, Title = id): Epic => ({ ID: id, ProjectID: 'p1', Title, Status } as Epic)
const task = (id: string, Num: number, Status: string, PRURL = ''): Task => ({ ID: id, Num, Title: `T${Num}`, Status, PRURL } as Task)

const EPICS: EpicWithTasks[] = [
  { epic: epic('e1', 'planned', 'План'), tasks: [task('t1', 1, 'queued')] },
  { epic: epic('e2', 'running', 'Работа'), tasks: [task('t2', 2, 'failed'), task('t3', 3, 'review', 'https://fake.local/pr/3')] },
  { epic: epic('e3', 'paused', 'Пауза'), tasks: [] },
  { epic: epic('e4', 'done', 'Готово'), tasks: [task('t4', 4, 'done', 'https://fake.local/pr/4')] },
  { epic: epic('e5', 'archived', 'Архив'), tasks: [task('t5', 5, 'cancelled')] },
]

const nav = (key: string, group: PalItem['group'], label: string): PalItem => ({ key, group, label, hint: '', action: { kind: 'nav', target: { view: 'projects' } } })

// Палитра проекта: команды, переходы к Epic'ам и задачам.
function all(open: { epicId?: string; taskId?: string } = {}): PalItem[] {
  const out = [...commandItems('p1', EPICS, open), nav('section-epics', 'sections', 'Перейти: Epic’и')]
  for (const { epic: e, tasks } of EPICS) {
    out.push(nav(`epic-${e.ID}`, 'epics', e.Title))
    for (const t of tasks) out.push(nav(`task-${t.ID}`, 'tasks', `task-${t.Num} · ${t.Title}`))
  }
  return out
}
const labels = (items: PalItem[]) => items.map(i => i.label)

test('действия по статусу: запуск, пауза, возобновление, повтор, PR', () => {
  const items = commandItems('p1', EPICS)
  assert.deepEqual(labels(items), [
    'Новый Epic',
    'Запустить Epic «План»',
    'Пауза Epic «Работа»',
    'Повторить task-2 · T2',
    'Открыть PR task-3 · T3',
    'Возобновить Epic «Пауза»',
    'Открыть PR task-4 · T4',
  ])
  const pause = items.find(i => i.label.startsWith('Пауза'))!
  assert.deepEqual(pause.action, { kind: 'epic', action: 'pause', pid: 'p1', epicId: 'e2' })
  const retry = items.find(i => i.label.startsWith('Повторить'))!
  assert.deepEqual(retry.action, { kind: 'retry', pid: 'p1', epicId: 'e2', taskId: 't2' })
  // Подтверждение: запуск и повтор; меняют состояние запуск, пауза, возобновление, повтор.
  assert.deepEqual(items.filter(i => i.confirm).map(i => i.key), ['cmd-epic-start-e1', 'cmd-retry-t2'])
  assert.deepEqual(items.filter(i => i.effect).map(i => i.key), ['cmd-epic-start-e1', 'cmd-epic-pause-e2', 'cmd-retry-t2', 'cmd-epic-resume-e3'])
  // Необратимых действий нет.
  assert.ok(!items.some(i => /архив|отмен|удал/i.test(i.label)))
})

test('поиск по имени Epic’а и по task-N ведёт к объекту, а не к действию', () => {
  for (const [q, first] of [['План', 'План'], ['работа', 'Работа'], ['task-2', 'task-2 · T2'], ['task-3', 'task-3 · T3'], ['Пауза', 'Пауза']]) {
    const out = filterItems(all(), q)
    assert.ok(!out.some(i => i.group === 'commands' && i.label !== 'Новый Epic' && !/^пауза/i.test(q)), `${q}: команд по имени нет`)
    const sel = out.find(i => i.key === initialKey(out))!
    assert.equal(sel.label, first, `${q}: выделен переход`)
  }
  // «Пауза» одновременно глагол и имя Epic'а: команды есть, но выделен переход.
  const p = filterItems(all(), 'пауза')
  assert.ok(p.some(i => i.label === 'Пауза Epic «Работа»'))
  assert.equal(p.find(i => i.key === initialKey(p))!.label, 'Пауза')
})

test('команды находятся по глаголу, имя объекта сужает список', () => {
  assert.deepEqual(labels(filterItems(all(), 'запуст')), ['Запустить Epic «План»'])
  assert.deepEqual(labels(filterItems(all(), 'пауза раб')), ['Пауза Epic «Работа»'])
  assert.deepEqual(labels(filterItems(all(), 'ВОЗОБН')), ['Возобновить Epic «Пауза»'])
  assert.deepEqual(labels(filterItems(all(), 'pr task-3')), ['Открыть PR task-3 · T3'])
  assert.deepEqual(labels(filterItems(all(), 'повтор')), ['Повторить task-2 · T2'])
  assert.deepEqual(labels(filterItems(all(), 'новый epic')), ['Новый Epic'])
  assert.deepEqual(labels(filterItems(all(), 'архив')), ['Архив'])
  assert.deepEqual(labels(filterItems(all(), 'отменить')), [])
  // Всё найденное меняет состояние: выделения нет, Enter ничего не делает.
  assert.equal(initialKey(filterItems(all(), 'запуст')), null)
  // Открыть PR состояние не меняет: его можно выделить.
  assert.equal(initialKey(filterItems(all(), 'pr task-3')), 'cmd-pr-t3')
})

test('без запроса: контекстные команды и переходы, выделение без побочного эффекта', () => {
  const out = filterItems(all({ epicId: 'e2', taskId: 't2' }), '')
  assert.deepEqual(labels(out.filter(i => i.group === 'commands')), ['Новый Epic', 'Пауза Epic «Работа»', 'Повторить task-2 · T2'])
  assert.equal(initialKey(out), 'cmd-new-epic')
  const onlyEffects = filterItems(all({ epicId: 'e2' }), '').filter(i => i.effect)
  assert.equal(initialKey(onlyEffects), null)
})

test('группы в порядке прототипа, у каждой свой лимит', () => {
  const many: PalItem[] = []
  for (let i = 0; i < 20; i++) many.push(nav(`t${i}`, 'tasks', `task-${i}`), nav(`r${i}`, 'runners', `runner-${i}`), nav(`s${i}`, 'sections', `Перейти ${i}`))
  const out = filterItems(many, '')
  assert.equal(out.filter(i => i.group === 'tasks').length, GROUP_LIMIT.tasks)
  assert.equal(out.filter(i => i.group === 'runners').length, GROUP_LIMIT.runners)
  assert.deepEqual([...new Set(out.map(i => i.group))], ['sections', 'tasks', 'runners'])
  assert.equal(out[0].key, 's0', 'порядок внутри группы сохраняется')
})

test('запрос совпал с именем объекта: объект выше команды и выделен', () => {
  const items: EpicWithTasks[] = [{ epic: epic('e9', 'running', 'Доступы'), tasks: [{ ...task('t7', 7, 'review', 'https://fake.local/pr/7'), Title: 'Открыть доступ партнёрам' } as Task] }]
  const list = [...commandItems('p1', items), nav('task-t7', 'tasks', 'task-7 · Открыть доступ партнёрам')]
  const out = filterItems(list, 'Открыть доступ')
  assert.deepEqual(labels(out), ['task-7 · Открыть доступ партнёрам', 'Открыть PR task-7 · Открыть доступ партнёрам'])
  assert.equal(initialKey(out), 'task-t7')
  // Только глагол: объектов нет, команда первая.
  assert.equal(filterItems(list, 'pr task-7')[0].key, 'cmd-pr-t7')
})

test('короткие префиксы не поднимают команды', () => {
  for (const q of ['про', 'пере', 'ста', 'отк', 'воз', 'пов']) {
    assert.ok(!filterItems(all(), q).some(i => i.group === 'commands' && i.key !== 'cmd-new-epic'), `${q}: команд нет`)
  }
  assert.deepEqual(labels(filterItems(all(), 'запу')), ['Запустить Epic «План»'])
  assert.deepEqual(labels(filterItems(all(), 'повт')), ['Повторить task-2 · T2'])
  assert.deepEqual(labels(filterItems(all(), 'откр')), ['Открыть PR task-3 · T3', 'Открыть PR task-4 · T4'])
})
