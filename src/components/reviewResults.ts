import type { Criterion, Event } from '../api/client.ts'

export function criterionState(c: Criterion) {
  if (c.status === 'ok') return { className: 'ok', mark: '✓', label: 'выполнен' }
  if (c.status === 'fail') return { className: 'fail', mark: '✗', label: 'не выполнен' }
  return { className: 'pend', mark: '○', label: 'не проверен' }
}

export function timelineDetail(e: Pick<Event, 'Type' | 'Payload'>): string {
  if (e.Type === 'session.step' || !e.Payload || typeof e.Payload !== 'object') return ''
  const detail = (e.Payload as Record<string, unknown>).detail
  return typeof detail === 'string' && detail.trim() ? detail : ''
}
