import { useState, type FormEvent } from 'react'
import { api, type User } from '../api/client'
import { Button, Field, FormActions, FormNote, PasswordInput, TextInput, useBusy } from './form'

// Экран входа (спека web «Вход в консоль»): до аутентификации данных
// установки не видно. Собран из токенов прототипа: центрированная карточка,
// тёмная тема, моно-акценты; поля по системе форм консоли.
export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, run] = useBusy()
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    await run(async () => {
      try {
        onLogin(await api.login(login, password))
      } catch {
        // Бэкенд намеренно не уточняет причину (логин или пароль).
        setErr('Неверный логин или пароль')
      }
    })
  }

  return (
    <div className="login-wrap">
      <form className="login-card f-form" onSubmit={submit}>
        <div className="side-brand" style={{ padding: 0, marginBottom: 4 }}>
          <span className="glyph">R</span><b>Rivet</b>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Вход в консоль оркестрации</div>
        <Field label="Логин">
          {ids => <TextInput ids={ids} placeholder="логин" autoFocus autoComplete="username" size="lg"
            value={login} onChange={e => setLogin(e.target.value)} />}
        </Field>
        <Field label="Пароль" error={err || undefined}>
          {ids => <PasswordInput ids={ids} placeholder="пароль" className="f-lg"
            value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        <FormActions>
          <Button type="submit" variant="primary" size="lg" busy={busy} busyLabel="вход…" disabled={!login || !password}>Войти</Button>
        </FormActions>
        <FormNote />
      </form>
    </div>
  )
}
