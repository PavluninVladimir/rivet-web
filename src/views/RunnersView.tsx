import { useCallback, useEffect, useState } from 'react'
import { api, type Runner } from '../api/client'
import { CtxBar, fmtAgo, StBadge } from '../components/ui'
import { Performer } from '../components/RoleChip'
import { Button, TextInput, errText } from '../components/form'
import { useStore } from '../store'

// Представление Runner'ов открыто всем (спека runners «Список runner'ов»);
// регистрация — выпуск токена в разделе управления и запуск на хосте, поэтому
// кнопка добавления ведёт на вкладку токенов (design, сверка с прототипом).
export function RunnersView({ admin }: { admin: boolean }) {
  const { tick, nav } = useStore()
  const [runners, setRunners] = useState<Runner[]>([])
  // Правка имени runner'а администратором (add-agent-roles): одна строка
  // за раз; пустое имя возвращает имя из регистрации.
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null)
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(() => {
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [])
  useEffect(refresh, [refresh, tick])

  const nameErr = edit && edit.value.trim().length > 40 ? 'не длиннее 40 символов' : ''
  const saveName = async () => {
    if (!edit || nameErr || saving) return
    setSaving(true); setEditErr('')
    try { await api.renameRunner(edit.id, edit.value.trim()); setEdit(null); refresh() }
    catch (e) { setEditErr(errText(e)) } finally { setSaving(false) }
  }

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
        <thead><tr><th>Runner</th><th>Сейчас</th><th>Профиль</th><th>Хост</th><th>Capabilities</th><th>Глубина</th><th>Контекст</th><th>Статус</th><th>Последний сигнал</th><th></th></tr></thead>
        <tbody>
          {runners.map(r => (
            <tr key={r.ID}>
              <td data-runner-name={r.ID}>
                {edit?.id === r.ID
                  ? <span className="row" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <TextInput size="sm" autoFocus aria-label={`имя runner’а ${r.ID}`} placeholder={r.ID} value={edit.value}
                        aria-invalid={nameErr || editErr ? true : undefined}
                        onChange={e => setEdit({ id: r.ID, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEdit(null) }} />
                      <Button size="sm" variant="primary" busy={saving} disabled={!!nameErr} onClick={saveName}>OK</Button>
                      <Button size="sm" variant="quiet" aria-label="отмена" onClick={() => { setEdit(null); setEditErr('') }}>✕</Button>
                      {(nameErr || editErr) && <span className="f-error" role="alert">{nameErr || editErr}</span>}
                    </span>
                  : <>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        <b title={r.DisplayNameLocked ? 'имя задано в консоли и не меняется при переподключении' : undefined}>{r.DisplayName || r.ID}</b>
                        {admin && <Button variant="quiet" size="sm" aria-label={`изменить имя ${r.ID}`} title="задать имя runner’а; пусто: имя из регистрации"
                          onClick={() => { setEdit({ id: r.ID, value: r.DisplayName ?? '' }); setEditErr('') }}>✎</Button>}
                      </span>
                      {r.DisplayName && <div className="mono muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.ID}</div>}
                    </>}
              </td>
              <td title="агент команды, чья сессия идёт на runner’е">
                {r.AgentName || r.RoleID
                  ? <Performer roleId={r.RoleID} agentName={r.AgentName} />
                  : <span className="muted">{r.TaskID ? 'занят' : '—'}</span>}
              </td>
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
