import { useState } from 'react'
import { api, type Check, type CreateProjectInput, type ProbeResult, type Project } from '../api/client'

// Пошаговый мастер создания проекта (спека web «Мастер создания проекта»):
// репозиторий → проверки → подтверждение. Вперёд с первого шага можно
// только после успешной проверки подключения; ничего не создаётся до
// последнего шага.

type Step = 'repo' | 'checks' | 'confirm'
type Mode = 'connect' | 'create'

const REASON_LABEL: Record<string, string> = {
  not_found: 'Репозиторий не найден',
  no_access: 'Нет доступа',
  insufficient_scope: 'Не хватает прав',
  unreachable: 'Хостинг недоступен',
  bad_token: 'Токен не принят',
}

export function ProjectWizard({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (p: Project) => void
}) {
  const [step, setStep] = useState<Step>('repo')
  const [mode, setMode] = useState<Mode>('connect')
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('github')
  const [repoURL, setRepoURL] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [owner, setOwner] = useState('')
  const [repoName, setRepoName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  // Токен намеренно не переживает возврат назад: держать секрет в форме
  // дольше необходимого незачем (design, решение 9).
  const [token, setToken] = useState('')
  const [checks, setChecks] = useState<Check[]>([])
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const runProbe = async () => {
    setBusy(true); setErr(''); setProbe(null)
    try {
      const res = await api.probe({
        provider,
        repo_url: mode === 'connect' ? repoURL : undefined,
        base_url: mode === 'create' ? (baseURL || undefined) : undefined,
        token,
      })
      setProbe(res)
      if (!res.ok) setErr(`${REASON_LABEL[res.reason] ?? 'Проверка не прошла'}: ${res.message}`)
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const input: CreateProjectInput = { name, provider, token, checks }
      if (mode === 'connect') input.repo_url = repoURL
      else {
        if (baseURL) input.base_url = baseURL
        input.create = { owner, repo_name: repoName, visibility }
      }
      onCreated(await api.createProject(input))
    } catch (e) { setErr(String(e)); setBusy(false) }
  }

  const back = () => {
    setToken(''); setProbe(null); setErr('')
    setStep(step === 'confirm' ? 'checks' : 'repo')
  }
  const canLeaveRepo = !!name.trim() && !!probe?.ok

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wizard" onClick={e => e.stopPropagation()}>
        <h2>Новый проект</h2>
        <div className="wiz-steps">
          {(['repo', 'checks', 'confirm'] as Step[]).map((s, i) => (
            <span key={s} className={'wiz-step' + (s === step ? ' active' : '')}>
              {i + 1}. {s === 'repo' ? 'Репозиторий' : s === 'checks' ? 'Проверки' : 'Подтверждение'}
            </span>
          ))}
        </div>

        {step === 'repo' && (
          <>
            <input placeholder="Название проекта" value={name} onChange={e => setName(e.target.value)} />
            <div className="row" style={{ gap: 8 }}>
              <select value={provider} onChange={e => { setProvider(e.target.value); setProbe(null) }}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
              <select value={mode} onChange={e => { setMode(e.target.value as Mode); setProbe(null) }}>
                <option value="connect">Подключить существующий</option>
                <option value="create">Создать новый</option>
              </select>
            </div>
            {mode === 'connect' ? (
              <input placeholder="URL репозитория (https://github.com/owner/name)"
                value={repoURL} onChange={e => { setRepoURL(e.target.value); setProbe(null) }} />
            ) : (
              <>
                <input placeholder="URL инстанса (пусто — облачный)"
                  value={baseURL} onChange={e => setBaseURL(e.target.value)} />
                <input placeholder="Владелец (аккаунт, организация или группа)"
                  value={owner} onChange={e => setOwner(e.target.value)} />
                <input placeholder="Имя репозитория" value={repoName} onChange={e => setRepoName(e.target.value)} />
                <select value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'public')}>
                  <option value="private">Приватный</option>
                  <option value="public">Публичный</option>
                </select>
              </>
            )}
            <input type="password" placeholder="Токен доступа к хостингу"
              value={token} onChange={e => { setToken(e.target.value); setProbe(null) }} />
            <div className="row">
              <button className="btn sm" disabled={!token || busy} onClick={runProbe}>
                {busy ? 'Проверка…' : 'Проверить доступ'}
              </button>
              {probe?.ok && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {probe.token_owner}
                  {probe.repo_path ? ` · ${probe.repo_path}` : ''}
                  {probe.can_push ? ' · push ✓' : ''}
                  {probe.can_merge_request ? ' · PR/MR ✓' : ''}
                </span>
              )}
            </div>
          </>
        )}

        {step === 'checks' && (
          <>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Команды этапа testing. Их можно изменить позже в настройках проекта.
            </div>
            {checks.map((c, i) => (
              <div className="row" key={i} style={{ gap: 8 }}>
                <input placeholder="Имя" value={c.name}
                  onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input placeholder="Команда" value={c.cmd}
                  onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, cmd: e.target.value } : x))} />
                <button className="btn sm" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setChecks([...checks, { name: '', cmd: '' }])}>
              Добавить проверку
            </button>
          </>
        )}

        {step === 'confirm' && (
          <div className="meta-grid">
            <div className="kv"><span>проект</span><b>{name}</b></div>
            <div className="kv"><span>хостинг</span><b>{provider}</b></div>
            <div className="kv"><span>репозиторий</span>
              <b>{mode === 'connect' ? (probe?.repo_path || repoURL) : `${owner}/${repoName}`}</b></div>
            <div className="kv"><span>токен</span><b>{probe?.token_owner || '—'}</b></div>
            <div className="kv"><span>проверок</span><b>{checks.length}</b></div>
            {mode === 'create' && <div className="kv"><span>видимость</span><b>{visibility}</b></div>}
          </div>
        )}

        {err && <div style={{ color: 'var(--c-block)', fontSize: 12 }}>{err}</div>}

        <div className="row">
          {step !== 'repo' && <button className="btn" onClick={back}>Назад</button>}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Отмена</button>
          {step === 'repo' && (
            <button className="btn primary" disabled={!canLeaveRepo} onClick={() => setStep('checks')}>Далее</button>
          )}
          {step === 'checks' && (
            <button className="btn primary" onClick={() => setStep('confirm')}>Далее</button>
          )}
          {step === 'confirm' && (
            <button className="btn primary" disabled={busy} onClick={create}>
              {busy ? 'Создание…' : 'Создать проект'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
