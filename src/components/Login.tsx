import { useState, type FormEvent } from 'react'
import { api, type User } from '../api/client'

// Экран входа (спека web «Вход в консоль»): до аутентификации данных
// установки не видно. Собран из токенов прототипа: центрированная карточка,
// тёмная тема, моно-акценты.
export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      onLogin(await api.login(login, password))
    } catch {
      // Бэкенд намеренно не уточняет причину (логин или пароль).
      setErr('Неверный логин или пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="side-brand" style={{ padding: 0, marginBottom: 4 }}>
          <span className="glyph">R</span><b>Rivet</b>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Вход в консоль оркестрации</div>
        <input className="search" style={{ width: '100%' }} placeholder="Логин" autoFocus
          autoComplete="username" value={login} onChange={e => setLogin(e.target.value)} />
        <input className="search" style={{ width: '100%' }} placeholder="Пароль" type="password"
          autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy || !login || !password}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
