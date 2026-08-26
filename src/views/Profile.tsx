import { useCallback, useEffect, useState } from 'react'
import { api, type AccessToken, type User } from '../api/client'
import { Button, Field, FormActions, FormNote, PasswordInput, TextInput, errText, useBusy } from '../components/form'

// Профиль (спека web «Профиль пользователя»): смена своего пароля и работа
// со своими personal access tokens. Доступен любому вошедшему.

export function Profile({ me }: { me: User }) {
  const [tokens, setTokens] = useState<AccessToken[]>([])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [tokenName, setTokenName] = useState('')
  // Секрет токена существует только в ответе на создание.
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, run] = useBusy()

  const refresh = useCallback(() => {
    api.tokens().then(t => setTokens(t ?? [])).catch(e => setErr(errText(e)))
  }, [])
  useEffect(refresh, [refresh])

  const act = (fn: () => Promise<unknown>, msg = '') => () => run(async () => {
    setErr(''); setNote('')
    try { await fn(); setNote(msg); refresh() } catch (e) { setErr(errText(e)) }
  })
  const nextErr = next && next.length < 8 ? 'Не короче 8 символов' : undefined

  return (
    <div className="page">
      <div className="page-head">
        <h1>Профиль</h1>
        <span className="sub">{me.login}{me.name ? ` · ${me.name}` : ''}</span>
      </div>
      <div style={{ marginBottom: 8 }}><FormNote err={err || undefined} ok={note || undefined} /></div>

      <div className="dw-sec f-form" style={{ maxWidth: 720 }}>
        <h3>Пароль</h3>
        <div className="f-grid">
          <Field label="Текущий пароль">
            {ids => <PasswordInput ids={ids} placeholder="Текущий пароль" value={current} onChange={e => setCurrent(e.target.value)} />}
          </Field>
          <Field label="Новый пароль" hint="не короче 8 символов" error={nextErr}>
            {ids => <PasswordInput ids={ids} placeholder="Новый пароль (от 8 символов)" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />}
          </Field>
        </div>
        <FormActions>
          <Button variant="primary" size="sm" busy={busy} disabled={!current || next.length < 8}
            onClick={act(async () => {
              await api.changePassword(current, next)
              setCurrent(''); setNext('')
            }, 'пароль изменён, остальные сессии завершены')}>
            Сменить пароль
          </Button>
        </FormActions>
      </div>

      <div className="dw-sec">
        <h3>Personal access tokens</h3>
        {secret && (
          <div className="row" style={{ marginBottom: 8, gap: 8, alignItems: 'center', display: 'flex' }}>
            <span className="mono" style={{ wordBreak: 'break-all' }}>{secret}</span>
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(secret)}>Скопировать</Button>
            <Button size="sm" variant="quiet" onClick={() => setSecret('')}>Скрыть</Button>
          </div>
        )}
        <div className="sess-list">
          {tokens.map(t => (
            <div className="sess-row" key={t.id}>
              <span className="mono">{t.prefix}…</span>
              <span className="sess-agent">{t.name}</span>
              <span className="muted">создан {new Date(t.created_at).toLocaleDateString()}</span>
              <span className="muted">
                {t.expires_at ? `до ${new Date(t.expires_at).toLocaleDateString()}` : 'без срока'}
              </span>
              <Button size="sm" variant="danger" busy={busy} onClick={act(() => api.deleteToken(t.id), 'токен отозван')}>
                Отозвать
              </Button>
            </div>
          ))}
          {tokens.length === 0 && <span className="muted">токенов нет</span>}
        </div>
        <div className="f-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', marginTop: 8, maxWidth: 520 }}>
          <Field label="Новый токен" hint="секрет показывается один раз после создания">
            {ids => <TextInput ids={ids} placeholder="Название токена" value={tokenName} onChange={e => setTokenName(e.target.value)} />}
          </Field>
          <Button busy={busy} disabled={!tokenName}
            onClick={act(async () => {
              const created = await api.createToken(tokenName)
              setSecret(created.secret); setTokenName('')
            }, 'токен создан: секрет показывается один раз')}>
            Создать токен
          </Button>
        </div>
      </div>
    </div>
  )
}

// PasswordGate — экран обязательной смены пароля после сброса
// администратором: до смены остальные разделы недоступны (спека web).
export function PasswordGate({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState('')
  const [busy, run] = useBusy()

  const submit = () => run(async () => {
    setErr('')
    try {
      await api.changePassword(current, next)
      onDone()
    } catch (e) { setErr(errText(e)) }
  })

  return (
    <div className="login-wrap">
      <form className="login-card f-form" onSubmit={e => { e.preventDefault(); void submit() }}>
        <h1 style={{ fontSize: 15 }}>Смена пароля</h1>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Пароль сброшен администратором. Задайте новый, чтобы продолжить работу.
        </div>
        <Field label="Выданный пароль">
          {ids => <PasswordInput ids={ids} placeholder="Выданный пароль" autoFocus value={current} onChange={e => setCurrent(e.target.value)} />}
        </Field>
        <Field label="Новый пароль" hint="не короче 8 символов" error={err || undefined}>
          {ids => <PasswordInput ids={ids} placeholder="Новый пароль (от 8 символов)" autoComplete="new-password"
            value={next} onChange={e => setNext(e.target.value)} />}
        </Field>
        <FormActions>
          <Button type="submit" variant="primary" busy={busy} disabled={!current || next.length < 8}>Сменить пароль</Button>
        </FormActions>
      </form>
    </div>
  )
}
