import type { EnvHost, HostAction, InfraCatalog, InfraConnection, Money, PeriodMoney, ProvisionConfig } from '../api/client'

// Хост окружения и подключения инфраструктуры (add-environment-provisioning):
// чистые функции без React, чтобы проверяться юнит-тестом. Состояние хоста
// ведёт сервер, консоль только подписывает его и решает, какие действия
// показать.

export const HOST_STATE_LABEL: Record<string, string> = {
  quoting: 'считаем цену',
  awaiting_approval: 'ждёт решения',
  approved: 'решение принято',
  creating: 'создаётся',
  bootstrapping: 'настройка хоста',
  ready: 'готов',
  delete_requested: 'ждёт решения об удалении',
  deleting: 'удаляется',
  deleted: 'удалён',
  rejected: 'отклонён',
  failed: 'провал',
}

// Подпись состояния: сервер, ждущий оплаты, и шаг, ждущий повтора от
// человека, видны прямо в подписи.
export function hostStateLabel(h: Pick<EnvHost, 'state' | 'waiting_payment' | 'needs_retry'>): string {
  const base = HOST_STATE_LABEL[h.state] ?? h.state
  if (h.state === 'creating' && h.waiting_payment) return `${base} · ждёт оплаты`
  if (h.needs_retry && (h.state === 'bootstrapping' || h.state === 'deleting')) return `${base} · ждёт повтора`
  return base
}

// Цвет состояния из статусной системы прототипа: готов как done, решение
// как review, провал как fail, конечные без провала приглушены.
export function hostStateColor(state: string): string {
  switch (state) {
    case 'ready': return 'var(--c-done)'
    case 'awaiting_approval': case 'delete_requested': return 'var(--c-review)'
    case 'failed': return 'var(--c-fail)'
    case 'deleting': return 'var(--c-fix)'
    case 'deleted': case 'rejected': return 'var(--c-cancel)'
    default: return 'var(--c-run)'
  }
}

export const HOST_TERMINAL = ['deleted', 'rejected', 'failed'] as const
export function hostTerminal(state: string): boolean {
  return (HOST_TERMINAL as readonly string[]).includes(state)
}

// Платный провайдер: у него цена, решение и «оплачено до». Сейчас платный
// только ruvds, local денег не тратит.
export const paidProvider = (provider: string | undefined) => !!provider && provider !== 'local'

// Удаление запрашивается у готового хоста, у хоста в настройке и у
// создаваемого, когда сервер у провайдера уже известен.
export function canDeleteHost(h: Pick<EnvHost, 'live' | 'state' | 'server_id'>): boolean {
  if (!h.live) return false
  return h.state === 'ready' || h.state === 'bootstrapping' || (h.state === 'creating' && !!h.server_id)
}

// Действия, которые карточка окружения показывает пользователю. Решения,
// удаление, повтор и новый запрос: только владельцу проекта, обновление
// стоимости: любому участнику.
export function hostActions(h: EnvHost | null | undefined, opts: { owner: boolean; bound: boolean }): HostAction[] {
  const out: HostAction[] = []
  if (!h) return opts.owner && opts.bound ? ['request'] : []
  if (opts.owner) {
    if (h.state === 'awaiting_approval') {
      if (h.quote) out.push('approve')
      out.push('reject')
    }
    if (h.state === 'delete_requested') out.push('confirm-delete', 'cancel-delete')
    if (h.needs_retry && h.live) out.push('retry')
    if (canDeleteHost(h)) out.push('delete')
    if (!h.live && opts.bound) out.push('request')
  }
  if (h.state === 'ready' && paidProvider(h.provider)) out.push('refresh')
  return out
}

// До конца оплаты меньше трёх суток (или уже прошла): дата подсвечивается.
export const PAID_SOON_MS = 3 * 24 * 60 * 60 * 1000
export function paidSoon(paidTill: string | null | undefined, now: number = Date.now()): boolean {
  if (!paidTill) return false
  const t = Date.parse(paidTill)
  if (!Number.isFinite(t)) return false
  return t - now < PAID_SOON_MS
}

// Сумма с валютой: рубли знаком, прочие кодом.
export function fmtMoney(m: Money | null | undefined): string {
  if (!m || typeof m.amount !== 'number' || !Number.isFinite(m.amount)) return '—'
  const n = m.amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  const cur = !m.currency || m.currency === 'RUB' ? '₽' : m.currency
  return `${n} ${cur}`
}

// Сумма за период: «320 ₽ за 1 месяц».
export function fmtPeriodMoney(m: PeriodMoney | null | undefined): string {
  if (!m) return '—'
  return m.period_label ? `${fmtMoney(m)} за ${m.period_label}` : fmtMoney(m)
}

// Баланс меньше цены: создание остановится с провалом.
export function balanceShort(quote: Money | null | undefined, balance: Money | null | undefined): boolean {
  if (!quote || !balance) return false
  if (quote.currency && balance.currency && quote.currency !== balance.currency) return false
  return balance.amount < quote.amount
}

// Дата без времени: «10.12.2026».
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU')
}

// ─── справочники провайдера ─────────────────────────────────────────────

// Ответ справочника без null вместо списков: дальше код читает массивы.
export function normCatalog(c: Partial<InfraCatalog> | null | undefined): InfraCatalog {
  return {
    datacenters: (c?.datacenters ?? []).map(d => ({ ...d, tariffs: d.tariffs ?? [], drive_tariffs: d.drive_tariffs ?? [] })),
    tariffs: c?.tariffs ?? [],
    drive_tariffs: c?.drive_tariffs ?? [],
    os: c?.os ?? [],
    payment_periods: c?.payment_periods ?? [],
  }
}

// Тарифы сервера, доступные в дата-центре (только действующие).
export function dcTariffs(c: InfraCatalog, dc: number | undefined) {
  const d = c.datacenters.find(x => x.id === dc)
  if (!d) return []
  return c.tariffs.filter(t => t.active !== false && d.tariffs.includes(t.id))
}

// Тарифы диска, доступные в дата-центре.
export function dcDriveTariffs(c: InfraCatalog, dc: number | undefined) {
  const d = c.datacenters.find(x => x.id === dc)
  if (!d) return []
  return c.drive_tariffs.filter(t => t.active !== false && d.drive_tariffs.includes(t.id))
}

export function activeOS(c: InfraCatalog) {
  return c.os.filter(o => o.active !== false)
}

// Смена дата-центра: тариф и тариф диска, которых в новом дата-центре нет,
// заменяются первыми доступными.
export function withDatacenter(c: InfraCatalog, p: ProvisionConfig, dc: number | undefined): ProvisionConfig {
  const tariffs = dcTariffs(c, dc)
  const drives = dcDriveTariffs(c, dc)
  return {
    ...p,
    datacenter: dc,
    tariff_id: tariffs.some(t => t.id === p.tariff_id) ? p.tariff_id : tariffs[0]?.id,
    drive_tariff_id: drives.some(t => t.id === p.drive_tariff_id) ? p.drive_tariff_id : drives[0]?.id,
  }
}

// Пустые поля привязки заполняются первыми значениями справочника, уже
// выбранные не трогаются.
export function fillFromCatalog(c: InfraCatalog, p: ProvisionConfig): ProvisionConfig {
  let out: ProvisionConfig = { ...p }
  if (out.datacenter === undefined && c.datacenters[0]) out = withDatacenter(c, out, c.datacenters[0].id)
  else if (out.datacenter !== undefined) {
    if (out.tariff_id === undefined) out.tariff_id = dcTariffs(c, out.datacenter)[0]?.id
    if (out.drive_tariff_id === undefined) out.drive_tariff_id = dcDriveTariffs(c, out.datacenter)[0]?.id
  }
  if (out.os_id === undefined) out.os_id = activeOS(c)[0]?.id
  if (out.payment_period === undefined) out.payment_period = c.payment_periods[0]?.id
  return out
}

// Подпись значения справочника: название из снимка хоста (spec_labels, на
// момент расчёта цены), иначе из загруженного справочника, иначе
// идентификатор.
export function specLabel(id: number | undefined, label: string | undefined, list?: { id: number; name: string }[]): string {
  if (id === undefined || id === null) return '—'
  return label?.trim() || list?.find(x => x.id === id)?.name || `#${id}`
}

// Конфигурация хоста строками для решения: названия из снимка хоста или
// справочника, иначе идентификаторы.
export function specLines(spec: ProvisionConfig, c: InfraCatalog | null, quote?: PeriodMoney | null, labels?: Record<string, string> | null): [string, string][] {
  const l = labels ?? {}
  const name = (key: string, list: { id: number; name: string }[] | undefined, id: number | undefined) => specLabel(id, l[key], list)
  const drive = spec.drive_tariff_id !== undefined ? (l.drive_tariff?.trim() || c?.drive_tariffs.find(t => t.id === spec.drive_tariff_id)?.name) : undefined
  const period = quote?.period_label
    || c?.payment_periods.find(p => p.id === spec.payment_period)?.label
    || (spec.payment_period !== undefined ? `#${spec.payment_period}` : '—')
  const n = (v: number | undefined) => v === undefined || v === null ? '?' : String(v)
  return [
    ['дата-центр', name('datacenter', c?.datacenters, spec.datacenter)],
    ['тариф', name('tariff', c?.tariffs, spec.tariff_id)],
    ['ресурсы', `${n(spec.cpu)} CPU · ${n(spec.ram)} ГБ RAM · ${n(spec.drive)} ГБ диск${drive ? ` (${drive})` : ''}`],
    ['ОС', name('os', c?.os, spec.os_id)],
    ['период оплаты', period],
  ]
}

// ─── форма окружения ────────────────────────────────────────────────────

// Откуда хост: свой адрес, машина runner'а или подключение провайдера
// (`ruvds:<id подключения>`), значение селекта формы.
export function hostSource(p: ProvisionConfig | null | undefined): string {
  if (!p) return 'address'
  if (p.provider === 'local') return 'local'
  return `${p.provider}:${p.connection ?? ''}`
}

const RUVDS_DEFAULTS = { cpu: 2, ram: 2, drive: 20 }

// Привязка после смены источника хоста. Ресурсы, ключ и скрипт переходят
// между подключениями одного провайдера, значения справочника: нет:
// у другого подключения их заново заполнит справочник.
export function provisionForSource(src: string, prev: ProvisionConfig | null | undefined): ProvisionConfig | undefined {
  if (src === 'address') return undefined
  if (src === 'local') return { provider: 'local', port: prev?.provider === 'local' ? prev.port ?? 0 : 0 }
  const i = src.indexOf(':')
  const provider = i < 0 ? src : src.slice(0, i)
  const connection = i < 0 ? '' : src.slice(i + 1)
  if (prev?.provider === provider && prev.connection === connection) return prev
  const same = prev?.provider === provider ? prev : undefined
  return {
    provider, connection,
    cpu: same?.cpu ?? RUVDS_DEFAULTS.cpu,
    ram: same?.ram ?? RUVDS_DEFAULTS.ram,
    drive: same?.drive ?? RUVDS_DEFAULTS.drive,
    ssh_public_key: same?.ssh_public_key ?? '',
    bootstrap_cmd: same?.bootstrap_cmd ?? '',
  }
}

// Привязка для сохранения: только поля своего провайдера.
export function cleanProvision(p: ProvisionConfig | null | undefined): ProvisionConfig | undefined {
  if (!p) return undefined
  if (p.provider === 'local') return { provider: 'local', port: p.port ?? 0 }
  return {
    provider: p.provider,
    connection: p.connection,
    datacenter: p.datacenter,
    tariff_id: p.tariff_id,
    os_id: p.os_id,
    payment_period: p.payment_period,
    cpu: p.cpu,
    ram: p.ram,
    drive: p.drive,
    drive_tariff_id: p.drive_tariff_id,
    ssh_public_key: (p.ssh_public_key ?? '').trim(),
    bootstrap_cmd: p.bootstrap_cmd ?? '',
  }
}

// Verify локального хоста по умолчанию: проверку URL выполняет runner на
// той же машине.
export const localVerifyUrl = (port: number) => `http://127.0.0.1:${port}/`

// URL проверки после смены порта: пустой или подставленный для прежнего
// порта меняется, введённый человеком остаётся.
export function nextVerifyUrl(current: string | undefined, oldPort: number, newPort: number): string | undefined {
  const cur = current ?? ''
  const auto = cur === '' || (oldPort > 0 && cur === localVerifyUrl(oldPort))
  if (!auto) return current
  if (newPort > 0) return localVerifyUrl(newPort)
  return cur === '' ? current : ''
}

// ─── подключения инфраструктуры ─────────────────────────────────────────

export const INFRA_STATE_LABEL: Record<string, string> = { ok: 'в порядке', invalid: 'токен отклонён', unchecked: 'не проверено' }
export const infraStateColor = (s: string) => s === 'ok' ? 'var(--c-done)' : s === 'invalid' ? 'var(--c-block)' : 'var(--c-review)'
export const INFRA_PROVIDER_LABEL: Record<string, string> = { ruvds: 'RUVDS', local: 'машина runner\'а' }

// Префикс токена с многоточием (сервер может прислать его уже с ним).
export function tokenPrefixText(c: Pick<InfraConnection, 'has_token' | 'token_prefix'>): string {
  if (!c.has_token) return 'нет'
  const p = c.token_prefix || '••••'
  return p.endsWith('…') ? p : `${p}…`
}

// Понятный текст отказа API для подключения инфраструктуры.
export function infraErrorText(code: string, message: string): string {
  switch (code) {
    case 'session_required':
      return 'Токен вводится только из сессии консоли: запрос с personal access token отклонён. Войдите в консоль и повторите.'
    case 'no_secret_key':
      return 'У установки не настроен ключ шифрования (RIVET_SECRET_KEY): токен сохранить нельзя. Задайте ключ и перезапустите rivetd.'
    default:
      return message
  }
}

// Понятный текст отказа действия с хостом.
export function hostErrorText(code: string, message: string): string {
  switch (code) {
    case 'session_required':
      return 'Подтвердить можно только из сессии консоли: запрос с personal access token отклонён.'
    case 'price_changed':
      return 'Цена изменилась. Проверьте новую цену и подтвердите ещё раз.'
    case 'bad_state':
      return 'Состояние хоста уже изменилось, карточка обновлена.'
    default:
      return message
  }
}

// Окружения, которые держат подключение (409 in_use): ссылки лежат в
// error.refs или рядом с конвертом.
export interface InfraRef { kind: string; id: string; name?: string; project_id?: string }
export function infraRefs(data: unknown): InfraRef[] {
  const d = data as { error?: { refs?: unknown }; refs?: unknown } | null
  const refs = (d?.error && typeof d.error === 'object' ? d.error.refs : undefined) ?? d?.refs
  return Array.isArray(refs) ? refs.filter((r): r is InfraRef => !!r && typeof r === 'object' && typeof (r as InfraRef).id === 'string') : []
}
export function inUseText(message: string, refs: InfraRef[]): string {
  if (!refs.length) return message
  const names = refs.map(r => r.name || r.id).join(', ')
  return `Подключение используется окружениями: ${names}. Сначала отвяжите их или удалите хосты.`
}
