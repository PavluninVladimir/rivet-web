import type { CyclePhaseId } from '../api/client'

// Геометрия кольца цикла разработки (add-sdlc-cycle, design решение 12):
// восемь узлов на окружности, первая фаза сверху, по часовой стрелке.
// Внешние стрелки соединяют соседей, внутренние дуги ведут назад.
// Модуль чистый: его же используют анимация метки и тесты.

export const PHASES: CyclePhaseId[] = ['discovery', 'architecture', 'planning', 'development', 'testing', 'review', 'release', 'operations']

// Цвет фазы — токен статусов прототипа.
export const PHASE_COLOR: Record<CyclePhaseId, string> = {
  discovery: 'var(--c-queue)',
  architecture: 'var(--c-ready)',
  planning: 'var(--accent)',
  development: 'var(--c-run)',
  testing: 'var(--c-test)',
  review: 'var(--c-review)',
  release: 'var(--c-done)',
  operations: 'var(--c-fix)',
}

export const PHASE_TITLE: Record<CyclePhaseId, string> = {
  discovery: 'Исследование', architecture: 'Архитектура', planning: 'Планирование', development: 'Разработка',
  testing: 'Тестирование', review: 'Ревью', release: 'Релиз', operations: 'Сопровождение',
}

export const isPhase = (v: unknown): v is CyclePhaseId => typeof v === 'string' && (PHASES as string[]).includes(v)

// Размеры в единицах viewBox.
export const VIEW = 760
export const CENTER = VIEW / 2
export const RADIUS = 290
// Угловой зазор стрелки у узла (узел — карточка поверх окружности).
const GAP = 0.27

export interface Point { x: number; y: number }

const round = (v: number) => Math.round(v * 10) / 10

export function angleOf(i: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / PHASES.length
}

export function nodePoint(i: number, r = RADIUS): Point {
  const a = angleOf(i)
  return { x: round(CENTER + r * Math.cos(a)), y: round(CENTER + r * Math.sin(a)) }
}

// Положение узла в процентах контейнера (HTML-карточки поверх SVG).
export function nodePercent(i: number): { left: string; top: string } {
  const p = nodePoint(i)
  return { left: `${round((p.x / VIEW) * 100)}%`, top: `${round((p.y / VIEW) * 100)}%` }
}

const pointAt = (a: number, r = RADIUS): Point => ({ x: round(CENTER + r * Math.cos(a)), y: round(CENTER + r * Math.sin(a)) })

// Внешняя стрелка от узла i к следующему по часовой стрелке.
export function forwardArc(i: number): string {
  const a0 = angleOf(i) + GAP
  const a1 = angleOf(i + 1) - GAP
  const p0 = pointAt(a0), p1 = pointAt(a1)
  return `M ${p0.x} ${p0.y} A ${RADIUS} ${RADIUS} 0 0 1 ${p1.x} ${p1.y}`
}

// Обратные дуги: исправление после ревью и после тестирования (подпись
// одна, у дуги из ревью), инциденты из сопровождения в разработку, отзывы
// в исследование.
export interface BackArc { from: CyclePhaseId; to: CyclePhaseId; label?: string }
export const BACK_ARCS: BackArc[] = [
  { from: 'review', to: 'development', label: 'исправление' },
  { from: 'testing', to: 'development' },
  { from: 'operations', to: 'development', label: 'инциденты' },
  { from: 'operations', to: 'discovery', label: 'отзывы' },
]

// Контрольная точка обратной дуги. Соседей (до двух шагов по часовой
// стрелке) соединяет кривая, прогнутая к центру. Дальние фазы — кривая
// через середину обратного пути внутри кольца, а не через центр: сводка в
// центре остаётся читаемой.
function backControl(i: number, j: number, p0: Point, p1: Point): Point {
  const cw = (j - i + PHASES.length) % PHASES.length
  if (cw <= 2) {
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    return { x: round(mid.x + (CENTER - mid.x) * 0.55), y: round(mid.y + (CENTER - mid.y) * 0.55) }
  }
  const back = (i - j + PHASES.length) % PHASES.length
  const a = angleOf(i) - (back / 2) * (2 * Math.PI / PHASES.length)
  return pointAt(a, RADIUS * (back <= 2 ? 0.75 : 1.05))
}

// Внутренняя дуга между узлами.
export function backPath(from: CyclePhaseId, to: CyclePhaseId): string {
  const i = PHASES.indexOf(from), j = PHASES.indexOf(to)
  const r = RADIUS - 62
  const p0 = nodePoint(i, r), p1 = nodePoint(j, r)
  const c = backControl(i, j, p0, p1)
  return `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`
}

// Точка подписи обратной дуги: середина кривой Безье.
export function backLabelPoint(from: CyclePhaseId, to: CyclePhaseId): Point {
  const nums = backPath(from, to).match(/-?\d+(\.\d+)?/g)!.map(Number)
  const [x0, y0, cx, cy, x1, y1] = nums
  return { x: round(0.25 * x0 + 0.5 * cx + 0.25 * x1), y: round(0.25 * y0 + 0.5 * cy + 0.25 * y1) }
}

// Путь метки для перехода phase_from → phase_to: вперёд по кольцу через
// промежуточные фазы, назад по обратной дуге, вход в цикл из центра и
// выход в центр. Пустая строка — двигать нечего.
export function travelPath(from: CyclePhaseId | null, to: CyclePhaseId | null): string {
  if (!from && !to) return ''
  if (!from) {
    const p = nodePoint(PHASES.indexOf(to!))
    return `M ${CENTER} ${CENTER} L ${p.x} ${p.y}`
  }
  if (!to) {
    const p = nodePoint(PHASES.indexOf(from))
    return `M ${p.x} ${p.y} L ${CENTER} ${CENTER}`
  }
  const i = PHASES.indexOf(from), j = PHASES.indexOf(to)
  if (i === j) return ''
  if (j > i) {
    // По часовой стрелке по окружности от центра узла до центра узла.
    const p0 = nodePoint(i), p1 = nodePoint(j)
    const large = (j - i) * (360 / PHASES.length) > 180 ? 1 : 0
    return `M ${p0.x} ${p0.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${p1.x} ${p1.y}`
  }
  const p0 = nodePoint(i), p1 = nodePoint(j)
  const c = backControl(i, j, p0, p1)
  return `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`
}

// Фаза события для ленты: переход задачи, иначе по типу события.
export function eventPhase(type: string, payload: Record<string, unknown> | undefined): CyclePhaseId | null {
  const to = payload?.phase_to, from = payload?.phase_from
  if (isPhase(to)) return to
  if (isPhase(from)) return from
  if (type.startsWith('release.') || type.startsWith('deploy.')) return 'release'
  if (type.startsWith('incident.') || type.startsWith('monitor.')) return 'operations'
  if (type === 'ops.job') return payload?.kind === 'incident_description' ? 'operations' : 'release'
  if (type.startsWith('epic.')) return 'planning'
  return null
}

// LIVE_MS — событие старше этого не анимируется: реплей журнала после
// подключения потока не должен выглядеть как живая работа.
export const LIVE_MS = 15000

// liveTransitions — переходы для анимации: только события новее последнего
// виденного и свежие по времени, с фазой до или после.
export function liveTransitions(events: { ID: number; TS: string; Payload?: Record<string, unknown> }[], seenId: number, now: number):
  { id: number; from: CyclePhaseId | null; to: CyclePhaseId | null }[] {
  const out: { id: number; from: CyclePhaseId | null; to: CyclePhaseId | null }[] = []
  for (const e of events) {
    if (e.ID <= seenId) continue
    const ts = Date.parse(e.TS)
    if (!Number.isFinite(ts) || now - ts > LIVE_MS) continue
    const p = e.Payload
    if (!p || !('phase_to' in p || 'phase_from' in p)) continue
    const from = isPhase(p.phase_from) ? p.phase_from : null
    const to = isPhase(p.phase_to) ? p.phase_to : null
    if (from === to) continue
    out.push({ id: e.ID, from, to })
  }
  return out.sort((a, b) => a.id - b.id)
}

// safeExternal — внешняя ссылка артефакта: только http(s).
export function safeExternal(url: string | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null
}

// Событие цикла: меняет фазу задачи или относится к релизам и сопровождению.
export function isCycleEvent(type: string, payload: Record<string, unknown> | undefined): boolean {
  if (payload && ('phase_to' in payload || 'phase_from' in payload)) return true
  return /^(release|incident|monitor|ops)\./.test(type) || type === 'deploy.status'
    || type === 'epic.decomposed' || type === 'epic.decomposing' || type === 'epic.progress'
}
