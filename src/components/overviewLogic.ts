import type { Amount, Decision, OverviewPeriod, RiskStatus } from '../api/client'

// Обзор проекта для руководителя (add-project-lead-view): чистые функции
// без React, чтобы проверяться юнит-тестом. Цифры считает сервер, консоль
// только подписывает и раскладывает их.

export const OVERVIEW_PERIODS: { id: OverviewPeriod; label: string }[] = [
  { id: 'today', label: 'сегодня' }, { id: '7d', label: '7 суток' },
  { id: '30d', label: '30 суток' }, { id: 'month', label: 'месяц' },
]

export function parsePeriod(s: string | undefined): OverviewPeriod {
  return OVERVIEW_PERIODS.some(p => p.id === s) ? s as OverviewPeriod : '7d'
}

// Часовой пояс браузера для границ дня и месяца, без него UTC.
export function browserTZ(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

// События проекта, после которых обзор перечитывается (api-contract,
// «Реальное время»). Публикации приходят как deploy.*. Эскалация уровня
// проекта своего события не имеет и приходит вместе с policy.decision,
// плановый бюджет месяца меняет policy.activated.
const RELEVANT = ['task.', 'epic.', 'attention.', 'deploy.', 'deployment.', 'role.', 'policy.']
export function overviewEventRelevant(type: string): boolean {
  return RELEVANT.some(p => type.startsWith(p))
}

// Склейка перечитываний: не чаще раза в ms, первый вызов сразу, вызовы
// внутри окна сводятся к одному завершающему в конце окна.
export interface Clock {
  now: () => number
  set: (fn: () => void, ms: number) => unknown
  clear: (h: unknown) => void
}
const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
}
export function throttle(fn: () => void, ms: number, clock: Clock = realClock): { call: () => void; cancel: () => void } {
  let last = -Infinity
  let timer: unknown = null
  const fire = () => { timer = null; last = clock.now(); fn() }
  return {
    call: () => {
      if (timer !== null) return
      const wait = last + ms - clock.now()
      if (wait <= 0) fire()
      else timer = clock.set(fire, wait)
    },
    cancel: () => {
      if (timer !== null) clock.clear(timer)
      timer = null
    },
  }
}

// throttle с повтором: каждый вызов перечитывает сразу (через склейку) и
// ещё раз через ms. Повтор ловит то, что поток событий мог пропустить:
// курсор SSE идёт по id, а транзакция с меньшим id иногда коммитится на
// миллисекунды позже уже доставленной. Чаще раза в ms перечитываний нет.
export function throttleWithRecheck(fn: () => void, ms: number, clock: Clock = realClock): { call: () => void; cancel: () => void } {
  const th = throttle(fn, ms, clock)
  const pending = new Set<unknown>()
  return {
    call: () => {
      th.call()
      const h = clock.set(() => { pending.delete(h); th.call() }, ms)
      pending.add(h)
    },
    cancel: () => {
      th.cancel()
      for (const h of pending) clock.clear(h)
      pending.clear()
    },
  }
}

// Статус риска: подпись и цвет статусной системы прототипа.
export function riskInfo(s: RiskStatus | string): { label: string; color: string } {
  switch (s) {
    case 'on_track': return { label: 'в графике', color: 'var(--c-done)' }
    case 'at_risk': return { label: 'под риском', color: 'var(--c-review)' }
    case 'needs_human': return { label: 'нужен человек', color: 'var(--c-block)' }
    case 'done': return { label: 'завершён', color: 'var(--c-done)' }
    default: return { label: s, color: 'var(--muted)' }
  }
}

export const DECISION_LABELS: Record<string, string> = {
  plan_approval: 'План на утверждении',
  escalation: 'Эскалация',
  merge_confirmation: 'Подтверждение merge',
  my_step: 'Мой шаг',
}

// Куда ведёт решение одним кликом: план — дашборд Epic'а с кнопкой
// запуска, задача — её деталка, свой шаг — очередь «Мои шаги». Эскалация
// без задачи: публикации (DEPLOY_FAILED) — окружения проекта, остальные
// уровня проекта (движок или источник политик) — политики проекта, как в
// списке задач.
export const DEPLOY_FAILED = 'DEPLOY_FAILED'
export type DecisionTarget =
  | { view: 'epic'; id: string; taskId?: string }
  | { view: 'mysteps' }
  | { view: 'environments' }
  | { view: 'policies' }
  | null
export function decisionTarget(d: Decision): DecisionTarget {
  if (d.kind === 'my_step') return { view: 'mysteps' }
  if (d.kind === 'plan_approval') return d.epic_id ? { view: 'epic', id: d.epic_id } : null
  if (d.epic_id && d.task_id) return { view: 'epic', id: d.epic_id, taskId: d.task_id }
  if (d.kind === 'escalation' && !d.task_id) return d.reason === DEPLOY_FAILED ? { view: 'environments' } : { view: 'policies' }
  return d.epic_id ? { view: 'epic', id: d.epic_id } : null
}

// Действие под карточкой решения.
export function decisionAction(d: Decision): string {
  const t = decisionTarget(d)
  if (!t) return ''
  switch (t.view) {
    case 'mysteps': return 'К моим шагам →'
    case 'environments': return 'К окружениям →'
    case 'policies': return 'К политикам →'
    default: return d.kind === 'plan_approval' ? 'К плану →' : 'Открыть →'
  }
}

// Копирование в буфер: Clipboard API есть только в защищённом контексте
// (https или localhost). Без него — выделение во временном поле и
// execCommand. false — скопировать не удалось.
export async function copyText(text: string, doc: Document | undefined = globalThis.document,
  clip: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (clip?.writeText) {
    try { await clip.writeText(text); return true } catch { /* ниже запасной путь */ }
  }
  if (!doc?.body) return false
  const ta = doc.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  doc.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = doc.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

// Время ожидания: минуты, часы, сутки.
export function fmtWait(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60)
  if (m < 1) return 'меньше минуты'
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} сут ${h % 24} ч` : `${d} сут`
}

// Токены суммы: null, если ни одна запись токенов не сообщила.
export function amountTokens(a: Amount): number | null {
  return a.tokens_in == null && a.tokens_out == null ? null : (a.tokens_in ?? 0) + (a.tokens_out ?? 0)
}

// Доля 0…1 в процентах, null — недоступна.
export function fmtShare(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

// Число с одной цифрой после запятой без лишнего нуля: 2, 2,5.
export function fmtNum(v: number, digits = 1): string {
  return Number(v.toFixed(digits)).toLocaleString('ru-RU')
}

// Значение для поля datetime-local в поясе браузера и обратно в RFC 3339.
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function fromLocalInput(v: string): string | null {
  if (!v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Период отчёта: последние 7 суток (по умолчанию сервера), прошлая
// календарная неделя с понедельника в поясе браузера или свои даты.
export type ReportPreset = '7d' | 'last_week' | 'custom'
export function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}
export function reportRange(p: ReportPreset, now: Date, custom: { from: string; to: string }): { from?: string; to?: string } | { error: string } {
  if (p === '7d') return {}
  if (p === 'last_week') {
    const to = startOfWeek(now)
    const from = new Date(to)
    from.setDate(from.getDate() - 7)
    return { from: from.toISOString(), to: to.toISOString() }
  }
  // Свои даты — с и по включительно: конец периода — начало следующего дня.
  if (!custom.from || !custom.to) return { error: 'укажите обе даты' }
  const [fy, fm, fd] = custom.from.split('-').map(Number)
  const [ty, tm, td] = custom.to.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd)
  const to = new Date(ty, tm - 1, td + 1)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'неверная дата' }
  if (from >= to) return { error: 'дата начала позже конца' }
  return { from: from.toISOString(), to: to.toISOString() }
}
