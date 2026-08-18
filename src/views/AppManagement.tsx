import { useCallback, useEffect, useState } from 'react'
import { api, type User } from '../api/client'

// Раздел «Управление приложением» (спека web): настройки уровня установки.
// Пока одна вкладка — пользователи; runner-токены, здоровье, аудит, модели,
// usage и политики приходят следующими change'ами раздела.

export function AppManagement({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  // Одноразовый пароль показывается ровно один раз (спека web).
  const [oneTime, setOneTime] = useState<{ login: string; password: string } | null>(null)
  const [form, setForm] = useState({ login: '', name: '', password: '', admin: false })

  const refresh = useCallback(() => {
    api.users().then(u => setUsers(u ?? [])).catch(e => setErr(String(e)))
  }, [])
  useEffect(refresh, [refresh])

  const act = (fn: () => Promise<unknown>, msg = '') => async () => {
    setErr(''); setNote('')
    try { await fn(); setNote(msg); refresh() } catch (e) { setErr(String(e)) }
  }

  // Последний активный администратор: у него действия «снять права» и
  // «отключить» недоступны, а не отклоняются после нажатия.
  const activeAdmins = users.filter(u => u.admin && !u.disabled).length
  const locked = (u: User) => u.admin && !u.disabled && activeAdmins <= 1

  return (
    <div className="page">
      <div className="page-head">
        <h1>Управление приложением</h1>
        <span className="sub">пользователи установки</span>
      </div>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ color: 'var(--c-done)', fontSize: 12, marginBottom: 8 }}>{note}</div>}
      {oneTime && (
        <div className="dw-sec">
          <h3>Одноразовый пароль для {oneTime.login}</h3>
          <div className="row">
            <span className="mono">{oneTime.password}</span>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(oneTime.password)}>
              Скопировать
            </button>
            <button className="btn sm" onClick={() => setOneTime(null)}>Скрыть</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Показывается один раз. Пользователь войдёт с ним и должен будет сменить пароль.
          </div>
        </div>
      )}

      <div className="dw-sec">
        <h3>Пользователи</h3>
        <div className="sess-list">
          {users.map(u => (
            <div className="sess-row" key={u.id}>
              <span className="mono">{u.login}</span>
              <span className="sess-agent">{u.name}</span>
              {u.admin && <span className="chip"><span className="n">админ</span></span>}
              <span className={u.disabled ? 'muted' : ''}>{u.disabled ? 'отключён' : 'активен'}</span>
              <button className="btn sm" disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { admin: !u.admin }),
                  u.admin ? 'права администратора сняты' : 'права администратора выданы')}>
                {u.admin ? 'Снять админа' : 'Сделать админом'}
              </button>
              <button className="btn sm"
                onClick={act(async () => {
                  const { password } = await api.resetPassword(u.id)
                  setOneTime({ login: u.login, password })
                }, 'пароль сброшен')}>
                Сбросить пароль
              </button>
              <button className="btn sm" disabled={locked(u)}
                title={locked(u) ? 'последний администратор установки' : ''}
                onClick={act(() => api.patchUser(u.id, { disabled: !u.disabled }),
                  u.disabled ? 'пользователь включён' : 'пользователь отключён')}>
                {u.disabled ? 'Включить' : 'Отключить'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="dw-sec">
        <h3>Новый пользователь</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Логин" value={form.login}
            onChange={e => setForm({ ...form, login: e.target.value })} />
          <input placeholder="Имя" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="password" placeholder="Пароль (от 8 символов)" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })} />
          <label className="row" style={{ gap: 6, marginRight: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.admin}
              onChange={e => setForm({ ...form, admin: e.target.checked })} />
            администратор
          </label>
          <button className="btn sm primary" disabled={!form.login || form.password.length < 8}
            onClick={act(async () => {
              await api.createUser(form)
              setForm({ login: '', name: '', password: '', admin: false })
            }, 'пользователь создан')}>
            Создать
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Вы вошли как {me.login}. Свой пароль и токены — на странице профиля.
        </div>
      </div>
    </div>
  )
}
