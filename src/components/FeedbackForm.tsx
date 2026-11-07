import { useState } from 'react'
import { ApiError, api, type Interview } from '../api/client'
import { Button, Field, FormActions, FormNote, TextArea, TextInput, errText, useBusy } from './form'
import { feedbackFieldErrors, runeCount, FEEDBACK_MAX } from './discovery'

// Форма отзыва пользователя (add-user-feedback, спека web «Обратная связь
// и наблюдение в консоли»): текст и источник. Доступна любому участнику
// проекта, ошибки — у поля. Одна форма в панели фазы «Исследование» и в
// представлении «Исследование».
//
// Длина считается в символах, как на сервере: maxLength браузера считает
// единицы UTF-16, и эмодзи упирались бы в лимит раньше счётчика. Escape в
// полях формы не закрывает панель фазы и не стирает черновик.

function apiFieldOf(e: unknown): string | undefined {
  return e instanceof ApiError ? (e.data as { error?: { field?: string } } | null)?.error?.field : undefined
}

export function FeedbackForm({ projectId, onAdded, compact }: {
  projectId: string; onAdded?: (fb: Interview) => void; compact?: boolean
}) {
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [ok, setOk] = useState('')
  const [busy, run] = useBusy()
  const save = () => run(async () => {
    setNote(''); setOk('')
    const local = feedbackFieldErrors(text, source)
    setErrs(local)
    if (Object.keys(local).length) return
    try {
      const fb = await api.addFeedback(projectId, { text, source })
      setText(''); setSource('')
      setOk('Отзыв сохранён: он войдёт в следующий анализ.')
      onAdded?.(fb)
    } catch (e) {
      const field = apiFieldOf(e)
      if (field) setErrs({ [field]: errText(e) })
      else setNote(errText(e))
    }
  })
  const left = FEEDBACK_MAX - runeCount(text)
  const edited = (field: string) => { setOk(''); if (errs[field]) setErrs(({ [field]: _, ...rest }) => rest) }
  return (
    <div className={'f-form feedback-form' + (compact ? ' compact' : '')}
      onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
      <Field label="Отзыв" error={errs.text} hint={left < 200 ? (left >= 0 ? `осталось ${left} символов` : `длиннее лимита на ${-left} символов`) : undefined}>
        {ids => <TextArea ids={ids} rows={compact ? 3 : 4} value={text}
          onChange={e => { setText(e.target.value); edited('text') }}
          placeholder="Что пользователь сказал о продукте" />}
      </Field>
      <Field label="Источник" error={errs.source}>
        {ids => <TextInput ids={ids} value={source}
          onChange={e => { setSource(e.target.value); edited('source') }}
          placeholder="менеджер Анна, чат поддержки" />}
      </Field>
      <FormActions note={<FormNote ok={ok || undefined} err={note || undefined} />}>
        <Button variant="primary" busy={busy} busyLabel="сохраняю…" onClick={save}>Добавить отзыв</Button>
      </FormActions>
    </div>
  )
}
