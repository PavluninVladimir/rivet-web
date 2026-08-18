import { useCallback, useEffect, useState } from 'react'
import { api, type AccessToken, type User } from '../api/client'

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

  const refresh = useCallback(() => {
    api.tokens().then(t => setTokens(t ?? [])).catch(e => setErr(String(e)))
  }, [])
  useEffect(refresh, [refresh])

  const act = (fn: () => Promise<unknown>, msg = '') => async () => {
    setErr(''); setNote('')
    try { await fn(); setNote(msg); refresh() } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Профиль</h1>
        <span className="sub">{me.login}{me.name ? ` · ${me.name}` : ''}</span>
      </div>
      {err && <div style={{ color: 'var(--c-block)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ color: 'var(--c-done)', fontSize: 12, marginBottom: 8 }}>{note}</div>}

      <div className="dw-sec">
        <h3>Пароль</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input type="password" placeholder="Текущий пароль" value={current}
            onChange={e => setCurrent(e.target.value)} />
          <input type="password" placeholder="Новый пароль (от 8 символов)" value={next}
            onChange={e => setNext(e.target.value)} />
          <button className="btn sm primary" disabled={!current || next.length < 8}
            onClick={act(async () => {
              await api.changePassword(current, next)
              setCurrent(''); setNext('')
            }, 'пароль изменён, остальные сессии завершены')}>
            Сменить пароль
          </button>
        </div>
      </div>

      <div className="dw-sec">
        <h3>Personal access tokens</h3>
        {secret && (
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="mono">{secret}</span>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(secret)}>Скопировать</button>
            <button className="btn sm" onClick={() => setSecret('')}>Скрыть</button>
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
              <button className="btn sm" onClick={act(() => api.deleteToken(t.id), 'токен отозван')}>
                Отозвать
              </button>
            </div>
          ))}
          {tokens.length === 0 && <span className="muted">токенов нет</span>}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Название токена" value={tokenName}
            onChange={e => setTokenName(e.target.value)} />
          <button className="btn sm" disabled={!tokenName}
            onClick={act(async () => {
              const created = await api.createToken(tokenName)
              setSecret(created.secret); setTokenName('')
            }, 'токен создан: секрет показывается один раз')}>
            Создать токен
          </button>
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

  const submit = async () => {
    setErr('')
    try {
      await api.changePassword(current, next)
      onDone()
    } catch (e) { setErr(String(e)) }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Смена пароля</h1>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Пароль сброшен администратором. Задайте новый, чтобы продолжить работу.
        </div>
        <input className="search" style={{ width: '100%' }} type="password" placeholder="Выданный пароль"
          autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        <input className="search" style={{ width: '100%' }} type="password" placeholder="Новый пароль (от 8 символов)"
          autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit() }} />
        {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}
        <button className="btn primary" disabled={!current || next.length < 8} onClick={() => void submit()}>
          Сменить пароль
        </button>
      </div>
    </div>
  )
}
