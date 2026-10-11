import { useCallback, useEffect, useState } from 'react'
import { api, type Runner } from '../api/client'
import { CtxBar, fmtAgo, StBadge } from '../components/ui'
import { useStore } from '../store'

// Представление Runner'ов открыто всем (спека runners «Список runner'ов»);
// регистрация — выпуск токена в разделе управления и запуск на хосте, поэтому
// кнопка добавления ведёт на вкладку токенов (design, сверка с прототипом).
export function RunnersView({ admin }: { admin: boolean }) {
  const { tick, nav } = useStore()
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
        <span className="sub">{runners.filter(r => r.Status !== 'offline').length} online · {runners.filter(r => r.Status === 'offline').length} offline</span>
        {admin && (
          <div className="right">
            <button className="btn" onClick={() => nav({ view: 'app-management', tab: 'runners' })}>Добавить runner</button>
          </div>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>ID</th><th>Агент</th><th>Хост</th><th>Capabilities</th><th>Глубина</th><th>Контекст</th><th>Статус</th><th>Последний сигнал</th><th></th></tr></thead>
        <tbody>
          {runners.map(r => (
            <tr key={r.ID}>
              <td className="id">{r.ID}</td>
              <td className="muted">
                {r.ProfileName ? <>{r.ProfileName} <span className="mono">{r.Agent}</span></> : r.Agent}
                {r.Models?.length ? <span className="mono"> · {r.Models.join(', ')}</span> : r.Model ? <span className="mono"> · {r.Model}</span> : null}
                {!r.Catalog && <span className="chip" style={{ marginLeft: 6 }} title="профиля в каталоге агентов нет: модели и окружение runner’а свои"><span className="n">вне каталога</span></span>}
                {r.Catalog && !r.Secure && <span className="chip" style={{ marginLeft: 6 }} title="канал без TLS и не с этой машины: секреты подключений runner’у не уходят"><span className="n">канал не защищён</span></span>}
              </td>
              <td className="mono muted">{r.Host}</td>
              <td className="mono muted">{r.Capabilities.join(', ')}</td>
              <td className="mono muted" title={`адаптер ${r.Adapter || 'wrap'}: глубина данных подключения; обратный канал контекста: ${r.ContextChannel ? 'есть' : 'нет'}`}>
                {r.Depth || 'minimal'}
              </td>
              <td><CtxBar pct={r.CtxPct} /></td>
              <td><StBadge s={r.Status} />{r.Draining && <span className="muted" style={{ marginLeft: 6, fontSize: 10.5 }}>drain</span>}</td>
              <td className="muted" title={r.LastSeen}>{fmtAgo(r.LastSeen)}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn sm" disabled={!admin} title={admin ? '' : 'только администратор'} onClick={() => toggle(r)}>
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
