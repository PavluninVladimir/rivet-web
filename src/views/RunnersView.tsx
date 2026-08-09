import { useCallback, useEffect, useState } from 'react'
import { api, type Runner } from '../api/client'
import { StBadge } from '../components/ui'
import { useStore } from '../store'

export function RunnersView() {
  const { tick } = useStore()
  const [runners, setRunners] = useState<Runner[]>([])

  const refresh = useCallback(() => {
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [])
  useEffect(refresh, [refresh, tick])

  const toggle = async (r: Runner) => {
    await api.drain(r.ID, !r.Draining).catch(() => {})
    refresh()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Runner’ы</h1>
        <span className="sub">{runners.filter(r => r.Status !== 'offline').length} online</span>
      </div>
      <table className="tbl">
        <thead><tr><th>ID</th><th>Агент</th><th>Хост</th><th>Capabilities</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          {runners.map(r => (
            <tr key={r.ID}>
              <td className="id">{r.ID}</td>
              <td className="muted">{r.Agent}{r.Model ? ` · ${r.Model}` : ''}</td>
              <td className="mono muted">{r.Host}</td>
              <td className="mono muted">{r.Capabilities.join(', ')}</td>
              <td><StBadge s={r.Status} />{r.Draining && <span className="muted" style={{ marginLeft: 6, fontSize: 10.5 }}>drain</span>}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn sm" onClick={() => toggle(r)}>
                  {r.Draining ? 'Вернуть в ротацию' : 'Вывести из ротации'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
