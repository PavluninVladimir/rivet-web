import type { BacklogEpic, DecomposeState, Dropped, Epic, EpicRef, Need, Persona, Quote, Run, RunStatus } from '../api/client'

// Подписи и расчёты представления «Исследование» (add-product-discovery):
// чистые функции без React, чтобы проверяться юнит-тестом.

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'идёт анализ', ready: 'готова', failed: 'сбой', approved: 'утверждена', superseded: 'заменена',
}

export const PRIORITY_LABEL: Record<string, string> = { must: 'must', should: 'should', could: 'could' }
export const PRIORITIES = ['must', 'should', 'could'] as const
export const SIZES = ['S', 'M', 'L'] as const
export const KIND_LABEL: Record<string, string> = { pain: 'боль', need: 'потребность', wish: 'пожелание' }
export const IMPORTANCE_LABEL: Record<string, string> = { high: 'важно', medium: 'заметно', low: 'мелочь' }
export const DROPPED_KIND_LABEL: Record<string, string> = {
  quote: 'цитата', finding: 'находка', persona: 'персона', need: 'потребность', epic: 'Epic', dependency: 'зависимость',
}

// Лимиты полей Epic'а бэклога (api-contract BacklogEpic).
export const GOAL_MIN = 40
export const GOAL_MAX = 4000
export const TITLE_MAX = 120

// Подпись Аналитика версии: «Аналитик Вера», без агента — название роли.
export function analystName(run: Pick<Run, 'role' | 'agent'> | null | undefined): string {
  const title = run?.role?.title || 'Аналитик'
  const name = run?.agent?.name?.trim()
  return name ? `${title} ${name}` : title
}

// Ход анализа строкой: «Аналитик Вера конспектирует: 2 из 5», затем
// «синтезирует результат».
export function progressText(run: Pick<Run, 'status' | 'stage' | 'progress' | 'role' | 'agent'>): string {
  const who = analystName(run)
  if (run.status !== 'running') return RUN_STATUS_LABEL[run.status] ?? run.status
  if (run.stage === 'synthesis' || run.stage === 'done') return `${who} синтезирует результат`
  return `${who} конспектирует: ${run.progress.done} из ${run.progress.total}`
}

// Доля хода для полосы: конспекты дают 80 %, синтез — оставшиеся 20 %.
export function progressPct(run: Pick<Run, 'status' | 'stage' | 'progress'>): number {
  if (run.status !== 'running') return 100
  if (run.stage !== 'summaries') return 90
  const { done, total } = run.progress
  return total > 0 ? Math.round((done / total) * 80) : 0
}

// Стоимость анализа: неизвестная стоимость — «—», а не ноль.
export function usageText(u: Run['usage'] | undefined): string {
  if (!u) return '—'
  const parts: string[] = []
  if (u.tokens_in != null || u.tokens_out != null) parts.push(`${(u.tokens_in ?? 0).toLocaleString('ru-RU')} / ${(u.tokens_out ?? 0).toLocaleString('ru-RU')} tok`)
  parts.push(u.cost_usd != null ? `$${u.cost_usd.toFixed(2)}` : 'стоимость неизвестна')
  return parts.join(' · ')
}

// Потребности по персонам в порядке персон; потребности без известной
// персоны — отдельной группой в конце.
export function needsByPersona(personas: Persona[], needs: Need[]): { persona: Persona | null; needs: Need[] }[] {
  const known = new Set(personas.map(p => p.id))
  const out: { persona: Persona | null; needs: Need[] }[] = personas.map(p => ({ persona: p, needs: needs.filter(n => n.persona === p.id) }))
  const rest = needs.filter(n => !known.has(n.persona))
  if (rest.length) out.push({ persona: null, needs: rest })
  return out.filter(g => g.needs.length > 0 || g.persona)
}

// Цвет персоны по её порядку: палитра ролей консоли.
const PERSONA_COLORS = ['blue', 'violet', 'green', 'amber', 'rose', 'teal', 'indigo', 'slate']
export function personaColor(personas: Persona[], id: string): string {
  const i = personas.findIndex(p => p.id === id)
  return i < 0 ? 'var(--muted)' : `var(--role-${PERSONA_COLORS[i % PERSONA_COLORS.length]})`
}

// Ключ нового Epic'а, добавленного человеком: h1, h2… после занятых.
export function nextHumanKey(backlog: Pick<BacklogEpic, 'key'>[]): string {
  let max = 0
  for (const e of backlog) {
    const m = /^h(\d+)$/.exec(e.key)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `h${max + 1}`
}

export function emptyEpic(key: string): BacklogEpic {
  return { key, title: '', goal: '', rationale: '', needs: [], priority: 'should', size: 'M', depends_on: [], existing_epic: null }
}

// Убрать Epic из бэклога: ссылки других Epic'ов на него тоже снимаются,
// иначе сервер отклонит неизвестную зависимость.
export function removeEpic(backlog: BacklogEpic[], key: string): BacklogEpic[] {
  return backlog.filter(e => e.key !== key).map(e => ({ ...e, depends_on: (e.depends_on ?? []).filter(d => d !== key) }))
}

// Варианты зависимости строки: другие Epic'и бэклога и Epic'и проекта
// (не архивные и не связанные с другими строками: на них ссылается строка).
export function depOptions(backlog: BacklogEpic[], key: string, projectEpics: Pick<Epic, 'ID' | 'Title' | 'Status'>[]): { value: string; label: string }[] {
  const linked = new Set(backlog.map(e => e.existing_epic).filter((v): v is string => !!v))
  const self = backlog.find(e => e.key === key)
  const out = backlog.filter(e => e.key !== key).map(e => ({ value: e.key, label: `${e.key} · ${e.title || 'без названия'}` }))
  for (const p of projectEpics) {
    if (p.Status === 'archived' || linked.has(p.ID) || p.ID === self?.existing_epic) continue
    out.push({ value: p.ID, label: `Epic проекта · ${p.Title}` })
  }
  return out
}

// withMissing — варианты зависимостей плюс выбранные значения без варианта
// (архивный Epic, удалённая строка): мультиселект показывает их, а не
// теряет молча.
export function withMissing(opts: { value: string; label: string }[], selected: string[] | null,
  projectEpics: Pick<Epic, 'ID' | 'Title' | 'Status'>[]): { value: string; label: string }[] {
  const have = new Set(opts.map(o => o.value))
  const extra = (selected ?? []).filter(v => !have.has(v)).map(v => {
    const ep = projectEpics.find(e => e.ID === v)
    return { value: v, label: ep ? `Epic проекта · ${ep.Title} (${ep.Status === 'archived' ? 'в архиве' : 'недоступен'})` : `${v} (не найден)` }
  })
  return [...opts, ...extra]
}

// Проверка полей строки до отправки: те же правила, что на сервере, чтобы
// ошибка была видна у поля сразу.
export function validateRow(e: BacklogEpic): Partial<Record<'title' | 'goal', string>> {
  const errs: Partial<Record<'title' | 'goal', string>> = {}
  const title = e.title.trim()
  if (!title) errs.title = 'укажите название'
  else if ([...title].length > TITLE_MAX) errs.title = `название длиннее ${TITLE_MAX} символов`
  const goal = [...e.goal.trim()].length
  if (goal < GOAL_MIN) errs.goal = `цель не короче ${GOAL_MIN} символов, сейчас ${goal}`
  else if (goal > GOAL_MAX) errs.goal = `цель длиннее ${GOAL_MAX} символов`
  return errs
}

// Поле ошибки API вида epics[2].depends_on → строка и поле.
export function backlogField(field: string | undefined): { index: number; field: string } | null {
  const m = /^epics\[(\d+)\]\.?([a-z_]*)$/.exec(field ?? '')
  return m ? { index: Number(m[1]), field: m[2] || 'title' } : null
}

// Порядок статусов версии: running → ready/failed → approved/superseded.
const RUN_STAGE: Record<string, number> = { running: 0, ready: 1, failed: 1, approved: 2, superseded: 2 }

// runIsOlder — версия next старше prev той же версии: меньше ревизия
// бэклога или более ранний статус. Ответ GET, отправленный до сохранения
// или утверждения, не заменяет их итог.
export function runIsOlder(next: Pick<Run, 'id' | 'backlog_rev' | 'status'>, prev: Pick<Run, 'id' | 'backlog_rev' | 'status'>): boolean {
  if (next.id !== prev.id) return false
  if (next.backlog_rev !== prev.backlog_rev) return next.backlog_rev < prev.backlog_rev
  return (RUN_STAGE[next.status] ?? 0) < (RUN_STAGE[prev.status] ?? 0)
}

// Ход декомпозиции строки бэклога после утверждения.
export function decomposeText(d: DecomposeState | null | undefined): string {
  switch (d?.status) {
    case 'pending': return 'ждёт декомпозиции'
    case 'running': return 'декомпозиция…'
    case 'done': return 'план готов'
    case 'failed': return 'план не составлен' + (d.detail ? `: ${d.detail}` : '')
    default: return ''
  }
}

// Причина ожидания Epic'а: «ждёт Epic „Сделки“, „Компании“ (в архиве)».
export function waitingText(refs: EpicRef[] | null | undefined): string {
  if (!refs?.length) return ''
  return 'ждёт Epic ' + refs.map(r => `«${r.title}»` + (r.status === 'archived' ? ' (в архиве, снимите зависимость)' : '')).join(', ')
}

// Сводка отброшенного по видам: «цитата 3 · потребность 1».
export function droppedSummary(dropped: Dropped[] | null | undefined): string {
  const counts = new Map<string, number>()
  for (const d of dropped ?? []) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
  return [...counts].map(([k, n]) => `${DROPPED_KIND_LABEL[k] ?? k} ${n}`).join(' · ')
}

// Строки, которые занимает цитата в тексте интервью: с её строки на
// столько строк, сколько переводов строк в самом фрагменте.
export function quoteLines(q: Pick<Quote, 'line' | 'text'>): { from: number; to: number } {
  const extra = (q.text.match(/\n/g) ?? []).length
  return { from: q.line, to: q.line + extra }
}

// Подсветка цитаты в строке: начало и конец фрагмента в строке. Для
// первой строки ищется начало цитаты, для последней — её конец, средние
// подсвечиваются целиком. -1 — фрагмент в строке не найден.
export function highlightRange(lineText: string, lineNo: number, q: Pick<Quote, 'line' | 'text'>): [number, number] | null {
  const { from, to } = quoteLines(q)
  if (lineNo < from || lineNo > to) return null
  const parts = q.text.split('\n')
  if (from === to) {
    const i = lineText.indexOf(q.text)
    return i < 0 ? [0, lineText.length] : [i, i + q.text.length]
  }
  if (lineNo === from) {
    const i = lineText.lastIndexOf(parts[0])
    return i < 0 ? [0, lineText.length] : [i, lineText.length]
  }
  if (lineNo === to) {
    const last = parts[parts.length - 1]
    return lineText.startsWith(last) ? [0, last.length] : [0, lineText.length]
  }
  return [0, lineText.length]
}

// Отметка строки бэклога: новый Epic или связь с Epic'ом проекта.
export function linkLabel(e: Pick<BacklogEpic, 'existing_epic'>, projectEpics: Pick<Epic, 'ID' | 'Title'>[]): string {
  if (!e.existing_epic) return 'новый'
  const p = projectEpics.find(x => x.ID === e.existing_epic)
  return `связан с Epic «${p?.Title ?? e.existing_epic}»`
}

// Размер интервью: символы и строки.
export function sizeText(chars: number, lines: number): string {
  return `${chars.toLocaleString('ru-RU')} симв. · ${lines} стр.`
}
