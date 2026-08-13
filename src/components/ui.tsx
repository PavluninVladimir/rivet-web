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
