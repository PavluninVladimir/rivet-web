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
