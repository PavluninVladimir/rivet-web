import type { Epic, Task } from '../api/client'
import type { NavTarget } from '../routes'

// Пункты командной палитры (спека web «Командная палитра»,
// fix-web-console-tails): чистая сборка и фильтр, без запросов. Действия
// предлагаются только допустимые по статусу объекта и только обратимые:
// отмены, архивирования и удаления в палитре нет.
//
// Поиск по имени объекта ведёт к объекту, а не к действию над ним: команда
// находится только по своему глаголу («пауза», «запуск», «PR»), имя
// объекта лишь сужает список команд. Если запрос нашёл и объекты, они идут
// выше команд, и начальное выделение стоит на объекте; на команде,
// меняющей состояние, оно не стоит никогда. Запуск Epic'а и повтор задачи
// требуют подтверждения вторым нажатием.

export type PalGroup = 'commands' | 'sections' | 'projects' | 'epics' | 'tasks' | 'runners'

// Порядок групп и подписи, как в прототипе (Commands, Tasks, Runners, Epics).
export const GROUP_ORDER: PalGroup[] = ['commands', 'sections', 'projects', 'epics', 'tasks', 'runners']
export const GROUP_LABEL: Record<PalGroup, string> = {
  commands: 'Команды', sections: 'Переходы', projects: 'Проекты', epics: 'Epic’и', tasks: 'Задачи', runners: 'Runner’ы',
}
// Сколько пунктов группы показывается за раз. У задач, Epic'ов и runner'ов
// лимиты прототипа: широкий запрос не вытесняет их командами и переходами.
export const GROUP_LIMIT: Record<PalGroup, number> = {
  commands: 6, sections: 6, projects: 5, epics: 4, tasks: 6, runners: 4,
}

export type EpicActionKind = 'start' | 'pause' | 'resume'

export type PalAction =
  | { kind: 'nav'; target: NavTarget }
  | { kind: 'new-epic'; pid: string }
  | { kind: 'epic'; action: EpicActionKind; pid: string; epicId: string }
  | { kind: 'retry'; pid: string; epicId: string; taskId: string }
  | { kind: 'open-pr'; url: string }

export interface PalItem {
  key: string
  group: PalGroup
  label: string
  hint: string
  status?: string
  // Действие над открытым Epic'ом или задачей: видно и без запроса.
  context?: boolean
  // Слова глагола команды: по ним команда находится поиском.
  verbs?: string[]
  // Меняет состояние на сервере: начальное выделение на него не ставится.
  effect?: boolean
  // Выполняется только вторым нажатием.
  confirm?: boolean
  action: PalAction
}

// Действия над Epic'ом по статусу: те же, что кнопки дашборда, кроме
// архивирования. Запуск рассылает задачи агентам, поэтому с подтверждением.
const EPIC_ACTIONS: Record<string, { action: EpicActionKind; verb: string; verbs: string[]; confirm: boolean }> = {
  planned: { action: 'start', verb: 'Запустить', verbs: ['запустить', 'запуск', 'старт'], confirm: true },
  running: { action: 'pause', verb: 'Пауза', verbs: ['пауза', 'приостановить'], confirm: false },
  paused: { action: 'resume', verb: 'Возобновить', verbs: ['возобновить'], confirm: false },
}

export interface EpicWithTasks { epic: Epic; tasks: Task[] }

// commandItems: команды проекта (новый Epic, действия над Epic'ами и
// задачами). open: открытые Epic и задача, их действия контекстные.
export function commandItems(pid: string, epics: EpicWithTasks[], open: { epicId?: string; taskId?: string } = {}): PalItem[] {
  const out: PalItem[] = [
    { key: 'cmd-new-epic', group: 'commands', label: 'Новый Epic', hint: 'форма в списке Epic’ов', context: true,
      verbs: ['новый', 'создать'], action: { kind: 'new-epic', pid } },
  ]
  for (const { epic, tasks } of epics) {
    const a = EPIC_ACTIONS[epic.Status]
    if (a) {
      out.push({
        key: `cmd-epic-${a.action}-${epic.ID}`, group: 'commands', label: `${a.verb} Epic «${epic.Title}»`, hint: 'действие над Epic’ом',
        status: epic.Status, context: epic.ID === open.epicId, verbs: a.verbs, effect: true, confirm: a.confirm,
        action: { kind: 'epic', action: a.action, pid: epic.ProjectID || pid, epicId: epic.ID },
      })
    }
    for (const t of tasks) {
      const context = t.ID === open.taskId
      const name = `task-${t.Num} · ${t.Title}`
      if (t.Status === 'failed') {
        out.push({
          key: `cmd-retry-${t.ID}`, group: 'commands', label: `Повторить ${name}`, hint: 'действие над задачей', status: t.Status, context,
          verbs: ['повторить', 'повтор'], effect: true, confirm: true,
          action: { kind: 'retry', pid: epic.ProjectID || pid, epicId: epic.ID, taskId: t.ID },
        })
      }
      if (t.PRURL) {
        out.push({
          key: `cmd-pr-${t.ID}`, group: 'commands', label: `Открыть PR ${name}`, hint: 'PR в новой вкладке', context,
          verbs: ['pr', 'открыть'], action: { kind: 'open-pr', url: t.PRURL },
        })
      }
    }
  }
  return out
}

// Слово запроса называет глагол команды: целое слово глагола (для «PR») или
// его префикс от четырёх букв. Трёх мало: «про», «пере», «ста» начинают и
// обычные слова, и команды всплывали бы, пока набирают имя раздела.
const VERB_PREFIX = 4
function isVerb(word: string, verbs: string[]): boolean {
  return verbs.some(v => v === word || (word.length >= VERB_PREFIX && v.startsWith(word)))
}

// matches: обычный пункт находится по вхождению запроса в подпись. Команда
// только если в запросе есть её глагол, а остальные слова есть в подписи.
function matches(i: PalItem, needle: string): boolean {
  const label = i.label.toLowerCase()
  if (i.group !== 'commands') return label.includes(needle)
  const words = needle.split(/\s+/).filter(Boolean)
  const verbs = i.verbs ?? []
  if (!words.some(w => isVerb(w, verbs))) return false
  return words.every(w => isVerb(w, verbs) || label.includes(w))
}

// filterItems: пункты по запросу, сгруппированные в порядке GROUP_ORDER, с
// лимитом каждой группы. Без запроса команды показываются только
// контекстные: иначе действия над всеми Epic'ами проекта вытеснили бы
// переходы. Если запрос нашёл объекты или переходы, команды идут после них:
// запрос «Открыть доступ» ведёт к задаче с таким именем, а не к её PR.
export function filterItems(items: PalItem[], q: string): PalItem[] {
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? items.filter(i => matches(i, needle))
    : items.filter(i => i.group !== 'commands' || i.context)
  const objects = needle !== '' && shown.some(i => i.group !== 'commands')
  const order = objects ? [...GROUP_ORDER.filter(g => g !== 'commands'), 'commands' as const] : GROUP_ORDER
  const out: PalItem[] = []
  for (const g of order) out.push(...shown.filter(i => i.group === g).slice(0, GROUP_LIMIT[g]))
  return out
}

// initialKey: начальное выделение, первый по порядку пункт без побочного
// эффекта. Объекты, найденные запросом, стоят выше команд (filterItems),
// поэтому выделение попадает на объект. Если найдены только команды,
// меняющие состояние, ничего не выделено: Enter не сработает, пока
// пользователь не выберет пункт стрелкой.
export function initialKey(items: PalItem[]): string | null {
  return items.find(i => !i.effect)?.key ?? null
}
