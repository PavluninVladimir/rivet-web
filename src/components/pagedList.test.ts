import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendPage, incidentAfter, mergeHead, releaseAfter } from './pagedList.ts'

const rel = (n: number) => ({ id: 'r' + String(n).padStart(3, '0'), created_at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() })
// Релизы от новых к старым: n убывает.
const rels = (from: number, to: number) => { const out = []; for (let n = from; n >= to; n--) out.push(rel(n)); return out }

test('новый релиз не теряет строку на границе страницы', () => {
  // Показаны 150 релизов (три страницы), курсор на самом старом.
  const prev = { rows: rels(150, 1), next: 'r001' }
  // Пришёл релиз 151: первая страница 151..102, строка 101 вытеснена.
  const head = { rows: rels(151, 102), next: 'r102' }
  const got = mergeHead(prev, head, releaseAfter)
  assert.equal(got.rows.length, 151)
  assert.deepEqual(got.rows.map(r => r.id), rels(151, 1).map(r => r.id))
  assert.equal(got.next, 'r001')
})

test('перечитывание не обрезает догруженный хвост инцидентов', () => {
  const inc = (n: number, status = 'open') => ({ id: 'i' + String(n).padStart(3, '0'), status, last_seen: new Date(Date.UTC(2026, 0, 1, 0, 300 - n)).toISOString() })
  const all = Array.from({ length: 150 }, (_, i) => inc(i + 1))
  const prev = { rows: all, next: 'i150' }
  // Инцидент 3 закрыт и ушёл из фильтра «активные», остальные сдвинулись.
  const head = { rows: all.filter(x => x.id !== 'i003').slice(0, 50), next: 'i051' }
  const got = mergeHead(prev, head, incidentAfter)
  assert.equal(got.rows.length, 149)
  assert.equal(got.rows.some(x => x.id === 'i003'), false)
  assert.equal(got.next, 'i150')
})

test('голова без продолжения — весь список', () => {
  const prev = { rows: rels(10, 1), next: null }
  const head = { rows: rels(11, 1), next: null }
  assert.equal(mergeHead(prev, head, releaseAfter).rows.length, 11)
})

test('«Ещё» после перечитывания не повторяет строки', () => {
  const prev = { rows: rels(151, 101), next: 'r101' }
  const got = appendPage(prev, { rows: rels(101, 52), next: 'r052' })
  assert.equal(got.rows.length, 100)
  assert.equal(new Set(got.rows.map(r => r.id)).size, 100)
  assert.equal(got.next, 'r052')
})

test('порядок инцидентов: открытые раньше смягчённых', () => {
  const a = { id: 'a', status: 'mitigated', last_seen: '2026-01-02T00:00:00Z' }
  const b = { id: 'b', status: 'open', last_seen: '2026-01-01T00:00:00Z' }
  assert.equal(incidentAfter(a, b), true)
  assert.equal(incidentAfter(b, a), false)
})
