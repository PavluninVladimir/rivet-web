import { useEffect, useState } from 'react'
import { api, type ApplicationSecret, type ApplicationSecretPatch, type Environment } from '../api/client'
import { Button, Field, FormNote, TextInput, errText } from './form'
import { secretPatch } from './applicationSecretsLogic'

export function ApplicationSecrets({ env }: { env: Environment }) {
  const [items, setItems] = useState<ApplicationSecret[]>([])
  const [name, setName] = useState(''), [value, setValue] = useState('')
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(''), [note, setNote] = useState('')
  useEffect(() => {
    let live = true
    void api.applicationSecrets(env.id).then(data => { if (live) { setItems(data); setLoaded(true) } })
      .catch(e => { if (live) setError(errText(e)) })
    return () => { live = false }
  }, [env.id])
  const save = async (patch: ApplicationSecretPatch) => {
    if (busy) return
    setBusy(true); setError(''); setNote('')
    try {
      setItems(await api.patchApplicationSecrets(env.id, patch))
      setName(''); setValue('')
      setNote('Секреты сохранены. Опубликуйте новое поколение, чтобы применить изменения. Логи публикаций с секретами скрыты.')
    } catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }
  const submit = () => {
    try { void save(secretPatch(name, value, env.config.local_docker?.env)) }
    catch (e) { setError(errText(e)) }
  }
  return <section aria-label="Секреты приложения" style={{ marginTop: 16 }}>
    <p className="muted">Значения зашифрованы и не читаются обратно. Их получает только Docker runner. Для смены секрета введите его имя и новое значение.</p>
    {items.map(item => <div className="dw-actions" key={item.name}>
      <span className="mono">{item.name}</span><span aria-label="Значение скрыто">***</span>
      <Button size="sm" disabled={busy} onClick={() => { setName(item.name); setValue(''); setNote('Введите новое значение') }}>Заменить</Button>
      <Button size="sm" disabled={busy} onClick={() => void save({ delete: [item.name] })}>Удалить {item.name}</Button>
    </div>)}
    {loaded && items.length === 0 && <p className="muted">Секретов пока нет.</p>}
    <Field label="Имя секретной переменной" hint="Например, ADMIN_PASSWORD">
      {ids => <TextInput ids={ids} autoComplete="off" spellCheck={false} maxLength={128} value={name} disabled={busy} onChange={e => setName(e.target.value)} />}
    </Field>
    <Field label="Новое секретное значение" hint="Пустое поле ничего не заменяет. После сохранения значение очищается.">
      {ids => <TextInput ids={ids} type="password" autoComplete="new-password" value={value} disabled={busy} onChange={e => setValue(e.target.value)} />}
    </Field>
    <Button disabled={busy || !loaded || !name || !value} onClick={submit}>Сохранить секрет</Button>
    <FormNote err={error || undefined} />
    {note && <p role="status" className="muted">{note}</p>}
  </section>
}
