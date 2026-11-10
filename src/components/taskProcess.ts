import type { ProcessDoc, ResolvedProcess, StepTransition } from '../api/client'
import { DEFAULT_TITLE, type EdgeFilter } from './processLayout.ts'

// Процесс задачи в деталке (fix-web-console-tails, спека web «Процесс
// задачи в деталке»): снимок процесса задачи превращается в документ графа,
// история переходов проигрывается по порядку (design, решение 2).
//
// Проигрывание идёт по фактической цели перехода, а не по заявленной в
// событии: цель перехода это шаг следующего перехода, у последнего это
// текущий шаг задачи. Заявленная цель расходится с фактической, когда
// исчерпан лимит возвратов (задача остаётся на шаге и уходит в эскалацию,
// повтор возвращает её на тот же шаг) или задача вошла на шаг без события
// (сессия доработки, конфликт merge).
//
// Исход ok отмечает шаг пройденным. Вход на шаг снимает отметку с него и
// всех шагов после: пройдено только то, что задача прошла в текущем
// проходе, до шага, на котором она стоит.

export type StepState = 'current' | 'passed' | 'ahead'

export interface TaskProcessView {
  doc: ProcessDoc
  current: string | null
  passed: Set<string>
  // Число переходов по ребру графа: ключ `${шаг}:${исход}`, как id ребра
  // раскладки. Эскалация по исчерпанному лимиту считается по ребру шага в
  // узел «эскалация».
  taken: Map<string, number>
  done: boolean
  // Задача сейчас на эскалации после перехода в неё.
  escalated: boolean
  // Рёбра графа: ok всегда, возвраты и эскалации только пройденные.
  keep: EdgeFilter
  // Подписи рёбер, которые ведут в эскалацию (ключ как у taken):
  // «эскалация» у перехода fail и «лимит changes» у исчерпанного лимита.
  labels: Map<string, string>
  summary: string
}

const FINISHED = new Set(['done', 'cancelled'])
const STOPPED = new Set(['blocked', 'failed'])

export function stepTitle(s: { id: string; kind: string; title?: string }): string {
  return s.title || DEFAULT_TITLE[s.kind] || s.id
}

export function taskProcessView(proc: ResolvedProcess | null | undefined, history: StepTransition[] | null | undefined,
  step: string, status: string): TaskProcessView | null {
  const steps = proc?.steps ?? []
  if (!steps.length) return null
  const doc: ProcessDoc = { steps: steps.map(s => ({ id: s.id, kind: s.kind, title: s.title, on: { ...s.on } })) }
  const idx = new Map(steps.map((s, i) => [s.id, i]))
  const finished = FINISHED.has(status)
  // Где задача стоит. У отменённой шаг тоже есть: по нему видно, что лимит
  // исчерпан до отмены, но текущим он не выделяется.
  const position = status !== 'done' && idx.has(step) ? step : null
  const current = finished ? null : position
  // Переходы шагов, которых нет в снимке, графу не принадлежат.
  const hist = (history ?? []).filter(h => idx.has(h.step))

  const passed = new Set<string>()
  const taken = new Map<string, number>()
  // Эскалации по исчерпанному лимиту: шаг → исход, который упёрся в лимит,
  // и число таких эскалаций.
  const escalations = new Map<string, { outcomes: Set<string>; n: number }>()
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const enter = (id: string) => { for (const s of steps.slice(idx.get(id)!)) passed.delete(s.id) }
  let lastEscalated = false
  hist.forEach((h, i) => {
    if (h.outcome === 'ok') passed.add(h.step)
    const last = i + 1 === hist.length
    const actual = last ? position ?? h.next : hist[i + 1].step
    // Задача осталась на шаге, хотя заявлен переход в другое место: лимит
    // возвратов исчерпан, это эскалация, а не возврат. У возврата на тот же
    // шаг (changes у code) место не меняется в любом случае, и исчерпание
    // видно только по статусу failed после последнего перехода.
    // Переход прямо в эскалацию заявлен самим событием, это не исчерпание.
    const self = h.next === h.step
    const stayed = h.outcome !== 'ok' && h.next !== 'escalate' && actual === h.step && (!self || (last && status === 'failed'))
    lastEscalated = h.next === 'escalate' || stayed
    if (stayed) {
      const e = escalations.get(h.step) ?? { outcomes: new Set<string>(), n: 0 }
      e.outcomes.add(h.outcome); e.n++
      escalations.set(h.step, e)
    } else count(taken, `${h.step}:${h.outcome}`)
    if (idx.has(actual)) enter(actual)
  })
  if (position) enter(position)

  // Эскалации по лимиту рисуются ребром шага в узел «эскалация»: это его
  // переход fail по умолчанию. Если fail шага ведёт на другой шаг и по нему
  // не ходили, ребро для графа перенаправляется в эскалацию.
  const labels = new Map<string, string>()
  for (const s of doc.steps) {
    for (const o of ['changes', 'fail'] as const) if (s.on?.[o] === 'escalate' && taken.has(`${s.id}:${o}`)) labels.set(`${s.id}:${o}`, 'эскалация')
  }
  for (const [id, e] of escalations) {
    const s = doc.steps.find(x => x.id === id)!
    const key = `${id}:fail`
    const genuine = taken.get(key) ?? 0
    if (s.on?.fail !== 'escalate') {
      if (genuine) continue
      s.on = { ...s.on, fail: 'escalate' }
    }
    taken.set(key, genuine + e.n)
    const limit = `лимит ${[...e.outcomes].join(', ')}`
    labels.set(key, genuine ? `эскалация, ${limit}` : limit)
  }

  const done = status === 'done'
  // Завершённая задача прошла весь процесс, даже если merge подтвердили
  // кнопкой мимо шагов.
  if (done) for (const s of steps) passed.add(s.id)
  const escalated = !done && STOPPED.has(status) && hist.length > 0 && lastEscalated
  const keep: EdgeFilter = (from, o) => o === 'ok' || taken.has(`${from}:${o}`)

  const n = `пройдено ${passed.size} из ${steps.length}`
  const cur = current ? steps.find(s => s.id === current)! : null
  const last = hist[hist.length - 1]
  const summary = done ? `Задача завершена · ${n}`
    : status === 'cancelled' ? `Задача отменена · ${n}`
      : escalated ? `Эскалация на шаге «${stepTitle(cur ?? steps[idx.get(last.step)!])}» · ${n}`
        : cur ? `Текущий шаг: ${stepTitle(cur)} · ${n}`
          : n
  return { doc, current, passed, taken, done, escalated, keep, labels, summary }
}

// edgeLabel: подпись ребра графа, кроме ok: исход, «эскалация» или
// «лимит …», и число переходов, если их больше одного.
export function edgeLabel(v: TaskProcessView, id: string, outcome: string): string {
  const n = v.taken.get(id) ?? 0
  return (v.labels.get(id) ?? outcome) + (n > 1 ? ` ×${n}` : '')
}

export function stepState(v: TaskProcessView, id: string): StepState {
  return v.current === id ? 'current' : v.passed.has(id) ? 'passed' : 'ahead'
}
