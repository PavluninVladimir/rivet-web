import { stLabel } from '../api/client'

export function StBadge({ s }: { s: string }) {
  return <span className={`st st-${s}`}>{stLabel[s] ?? s.toUpperCase()}</span>
}

export function timeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function attemptStr(used: number, limit: number): string {
  return `${used} / ${limit}`
}

// ─── usage: null = «данные недоступны», не ноль (api-contract) ─────────

export function fmtTokens(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU')
}

export function fmtCost(v: number | null | undefined): string {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${s}с`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}м ${s % 60}с` : `${Math.floor(m / 60)}ч ${m % 60}м`
}

// Ctx-бар как в прототипе: подсветка hot при >60 %, «—» при неизвестной
// заполненности (спека runners «Мониторинг контекста и расхода»).
export function CtxBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="muted">—</span>
  return (
    <span className="ctx-cell">
      <span className="ctx-bar"><i className={pct > 60 ? 'hot' : ''} style={{ width: `${pct}%` }} /></span>
      <span className="mono">{pct}%</span>
    </span>
  )
}

// ─── вкладки (адресуемые, состояние живёт в маршруте) ──────────────────

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void
}) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.id} className={'tab' + (t.id === active ? ' on' : '')} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Время назад для последнего сигнала runner'а и использования токена.
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}с назад`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}м назад`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}ч назад` : `${Math.floor(h / 24)}д назад`
}

// Цвет состояния компонента установки через статусную систему прототипа:
// ok как done, degraded как review, down как blocked.
export function statusColor(s: 'ok' | 'degraded' | 'down'): string {
  return s === 'ok' ? 'var(--c-done)' : s === 'degraded' ? 'var(--c-review)' : 'var(--c-block)'
}

// Однократно показанный секрет с копированием (токены, одноразовые пароли).
export function SecretOnce({ title, secret, hint, onHide }: { title: string; secret: string; hint: string; onHide: () => void }) {
  return (
    <div className="dw-sec">
      <h3>{title}</h3>
      <div className="row">
        <span className="mono" style={{ wordBreak: 'break-all' }}>{secret}</span>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(secret)}>Скопировать</button>
        <button className="btn sm" onClick={onHide}>Скрыть</button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{hint}</div>
    </div>
  )
}
