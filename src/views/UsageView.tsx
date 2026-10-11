import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type UsageRow } from '../api/client'
import { fmtCost, fmtDuration, fmtTokens } from '../components/ui'
import { FormNote } from '../components/form'
import { useStore } from '../store'

// Представление Usage (спека web «Представление Usage»): сводка за период и
// разбивка с переключением группировки. Одно и то же представление живёт в
// главной навигации (по проектам участника) и во вкладке раздела управления
// со срезом по всей установке (design, одно представление на два места).

type Group = 'model' | 'runner' | 'project' | 'epic' | 'task'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'model', label: 'модель' }, { id: 'runner', label: 'runner' },
  { id: 'project', label: 'проект' }, { id: 'epic', label: 'Epic' }, { id: 'task', label: 'задача' },
]
type Preset = 'today' | '7d' | '30d' | 'custom'

function presetRange(p: Preset): { from?: string; to?: string } {
  const now = new Date()
  const start = new Date(now)
  if (p === 'today') start.setHours(0, 0, 0, 0)
  else if (p === '7d') start.setDate(now.getDate() - 7)
  else if (p === '30d') start.setDate(now.getDate() - 30)
  else return {}
  return { from: start.toISOString() }
}

function sumNullable(rows: UsageRow[], pick: (r: UsageRow) => number | null): number | null {
  let acc: number | null = null
  for (const r of rows) {
    const v = pick(r)
    if (v == null) continue
    acc = (acc ?? 0) + v
  }
  return acc
}

export function UsageView({ scope, defaultGroup = 'model', title = 'Usage', sub }: {
  scope?: 'installation'; defaultGroup?: Group; title?: string; sub?: string
}) {
  const { tick } = useStore()
  const [group, setGroup] = useState<Group>(defaultGroup)
  const [preset, setPreset] = useState<Preset>('7d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [rows, setRows] = useState<UsageRow[]>([])
  const [err, setErr] = useState('')

  const period = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset)
    const out: { from?: string; to?: string } = {}
    if (custom.from) out.from = new Date(custom.from).toISOString()
    if (custom.to) out.to = new Date(custom.to).toISOString()
    return out
  }, [preset, custom])

  const refresh = useCallback(() => {
    api.usage(group, period, scope).then(r => { setRows(r ?? []); setErr('') }).catch(e => setErr(String(e)))
  }, [group, period, scope])
  useEffect(refresh, [refresh, tick])

  // Токены и стоимость: null = ни одна запись периода не сообщила данных.
  const tokIn = sumNullable(rows, r => r.tokens_in)
  const tokOut = sumNullable(rows, r => r.tokens_out)
  const tokens = tokIn == null && tokOut == null ? null : (tokIn ?? 0) + (tokOut ?? 0)
  const cost = sumNullable(rows, r => r.cost_usd)
  const duration = rows.reduce((s, r) => s + r.duration_s, 0)
  const share = (r: UsageRow) => {
    const v = (r.tokens_in ?? 0) + (r.tokens_out ?? 0)
    return tokens ? Math.round(v / tokens * 100) : 0
  }
  const label = (r: UsageRow) => r.label || (r.key === '—' ? 'без привязки' : r.key)

  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <span className="sub">{sub ?? (scope === 'installation' ? 'вся установка' : 'токены и стоимость по вашим проектам')}</span>
        <div className="right row" style={{ gap: 8 }}>
          <div className="seg">
            {(['today', '7d', '30d', 'custom'] as Preset[]).map(p => (
              <button key={p} className={p === preset ? 'on' : ''} onClick={() => setPreset(p)}>
                {p === 'today' ? 'сегодня' : p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : 'вручную'}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <>
              <input type="datetime-local" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
              <input type="datetime-local" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
            </>
          )}
        </div>
      </div>
      {err && <div style={{ marginBottom: 8 }}><FormNote err={err} /></div>}
      <div className="stat-strip">
        <div className="mini-stat"><div className="v">{fmtTokens(tokens)}</div><div className="l">Токены</div></div>
        <div className="mini-stat"><div className="v">{fmtTokens(tokIn)}<em>in</em></div><div className="l">Входные токены</div></div>
        <div className="mini-stat"><div className="v">{fmtTokens(tokOut)}<em>out</em></div><div className="l">Выходные токены</div></div>
        <div className="mini-stat"><div className="v">{fmtCost(cost)}</div><div className="l">Стоимость</div></div>
        <div className="mini-stat"><div className="v">{fmtDuration(duration)}</div><div className="l">Длительность</div></div>
        <div className="mini-stat"><div className="v">{rows.length}</div><div className="l">Строк разбивки</div></div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Разбивка</h3>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          {GROUPS.map(g => (
            <button key={g.id} className={g.id === group ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>
          ))}
        </div>
      </div>
      <table className="tbl">
        <thead><tr><th>{GROUPS.find(g => g.id === group)?.label}</th><th>Доля</th><th className="num">Токены in</th><th className="num">Токены out</th><th className="num">Стоимость</th><th className="num">Длительность</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className={group === 'model' || group === 'runner' ? 'mono' : ''} title={r.key}>{label(r)}</td>
              <td><div className="bar-cell"><div className="bar"><i style={{ width: `${share(r)}%` }} /></div><span className="mono muted" style={{ fontSize: 11 }}>{share(r)}%</span></div></td>
              <td className="num">{fmtTokens(r.tokens_in)}</td>
              <td className="num">{fmtTokens(r.tokens_out)}</td>
              <td className="num">{fmtCost(r.cost_usd)}</td>
              <td className="num">{fmtDuration(r.duration_s)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">За период записей нет.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
