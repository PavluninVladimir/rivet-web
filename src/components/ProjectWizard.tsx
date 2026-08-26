import { useState } from 'react'
import { api, type Check, type CreateProjectInput, type ProbeResult, type Project } from '../api/client'
import { Button, Field, FormActions, FormNote, PasswordInput, Select, TextInput, errText, useBusy } from './form'

// Пошаговый мастер создания проекта (спека web «Мастер создания проекта»):
// репозиторий → проверки → подтверждение. Вперёд с первого шага можно
// только после успешной проверки подключения; ничего не создаётся до
// последнего шага. Поля по системе форм: подпись над полем, ошибка
// проверки подключения у поля адреса.

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
  const [busy, run] = useBusy()
  const [err, setErr] = useState('')
  // Ошибка проверки подключения живёт у поля адреса (или токена).
  const [probeErr, setProbeErr] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const touch = (k: string) => setTouched(t => ({ ...t, [k]: true }))

  const runProbe = () => run(async () => {
    setErr(''); setProbeErr(''); setProbe(null)
    try {
      const res = await api.probe({
        provider,
        repo_url: mode === 'connect' ? repoURL : undefined,
        base_url: mode === 'create' ? (baseURL || undefined) : undefined,
        token,
      })
      setProbe(res)
      if (!res.ok) setProbeErr(`${REASON_LABEL[res.reason] ?? 'Проверка не прошла'}: ${res.message}`)
    } catch (e) { setErr(errText(e)) }
  })

  const create = () => run(async () => {
    setErr('')
    try {
      const input: CreateProjectInput = { name, provider, token, checks }
      if (mode === 'connect') input.repo_url = repoURL
      else {
        if (baseURL) input.base_url = baseURL
        input.create = { owner, repo_name: repoName, visibility }
      }
      onCreated(await api.createProject(input))
    } catch (e) { setErr(errText(e)) }
  })

  const back = () => {
    setToken(''); setProbe(null); setErr(''); setProbeErr('')
    setStep(step === 'confirm' ? 'checks' : 'repo')
  }
  const nameErr = touched.name && !name.trim() ? 'Укажите название проекта' : undefined
  const urlErr = touched.url && mode === 'connect' && !repoURL.trim() ? 'Укажите адрес репозитория' : undefined
  const canLeaveRepo = !!name.trim() && !!probe?.ok

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wizard f-form" onClick={e => e.stopPropagation()}>
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
            <Field label="Название" error={nameErr}>
              {ids => <TextInput ids={ids} placeholder="Название проекта" autoFocus value={name}
                onChange={e => setName(e.target.value)} onBlur={() => touch('name')} />}
            </Field>
            <div className="f-grid">
              <Field label="Хостинг">
                {ids => <Select ids={ids} value={provider} onChange={e => { setProvider(e.target.value); setProbe(null); setProbeErr('') }}>
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                </Select>}
              </Field>
              <Field label="Репозиторий">
                {ids => <Select ids={ids} value={mode} onChange={e => { setMode(e.target.value as Mode); setProbe(null); setProbeErr('') }}>
                  <option value="connect">Подключить существующий</option>
                  <option value="create">Создать новый</option>
                </Select>}
              </Field>
            </div>
            {mode === 'connect' ? (
              <Field label="Адрес репозитория" error={probeErr || urlErr} hint="например, https://github.com/owner/name">
                {ids => <TextInput ids={ids} mono placeholder="URL репозитория (https://github.com/owner/name)"
                  value={repoURL} onChange={e => { setRepoURL(e.target.value); setProbe(null); setProbeErr('') }} onBlur={() => touch('url')} />}
              </Field>
            ) : (
              <>
                <Field label="Инстанс" optional hint="пусто, если облачный хостинг" error={probeErr || undefined}>
                  {ids => <TextInput ids={ids} mono placeholder="URL инстанса (пусто — облачный)"
                    value={baseURL} onChange={e => { setBaseURL(e.target.value); setProbeErr('') }} />}
                </Field>
                <div className="f-grid">
                  <Field label="Владелец">
                    {ids => <TextInput ids={ids} placeholder="Владелец (аккаунт, организация или группа)"
                      value={owner} onChange={e => setOwner(e.target.value)} />}
                  </Field>
                  <Field label="Имя репозитория">
                    {ids => <TextInput ids={ids} mono placeholder="Имя репозитория" value={repoName} onChange={e => setRepoName(e.target.value)} />}
                  </Field>
                </div>
                <Field label="Видимость">
                  {ids => <Select ids={ids} value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'public')}>
                    <option value="private">Приватный</option>
                    <option value="public">Публичный</option>
                  </Select>}
                </Field>
              </>
            )}
            <Field label="Токен доступа" hint="хранится зашифрованным, наружу не показывается">
              {ids => <PasswordInput ids={ids} placeholder="Токен доступа к хостингу" autoComplete="off"
                value={token} onChange={e => { setToken(e.target.value); setProbe(null); setProbeErr('') }} />}
            </Field>
            <div className="f-actions" style={{ justifyContent: 'flex-start' }}>
              <Button size="sm" disabled={!token} busy={busy} busyLabel="проверка…" onClick={runProbe}>Проверить доступ</Button>
              {probe?.ok && (
                <span className="f-note ok">
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
              <div className="f-grid" key={i} style={{ gridTemplateColumns: '1fr 2fr auto', alignItems: 'end' }}>
                <Field label={i === 0 ? 'Имя' : undefined}>
                  {ids => <TextInput ids={ids} placeholder="Имя" value={c.name}
                    onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />}
                </Field>
                <Field label={i === 0 ? 'Команда' : undefined}>
                  {ids => <TextInput ids={ids} mono placeholder="Команда" value={c.cmd}
                    onChange={e => setChecks(checks.map((x, j) => j === i ? { ...x, cmd: e.target.value } : x))} />}
                </Field>
                <Button variant="quiet" aria-label="убрать проверку" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => setChecks([...checks, { name: '', cmd: '' }])}>Добавить проверку</Button>
            </div>
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

        <FormActions note={<FormNote err={err || undefined} />}>
          {step !== 'repo' && <Button onClick={back}>Назад</Button>}
          <Button variant="quiet" onClick={onClose}>Отмена</Button>
          {step === 'repo' && <Button variant="primary" disabled={!canLeaveRepo} onClick={() => setStep('checks')}>Далее</Button>}
          {step === 'checks' && <Button variant="primary" onClick={() => setStep('confirm')}>Далее</Button>}
          {step === 'confirm' && <Button variant="primary" busy={busy} busyLabel="создание…" onClick={create}>Создать проект</Button>}
        </FormActions>
      </div>
    </div>
  )
}
