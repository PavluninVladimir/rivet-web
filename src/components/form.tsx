import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes, type KeyboardEvent } from 'react'
import { ApiError } from '../api/client'

// Система элементов форм (redesign-console-forms, спека clients/web
// «Система элементов форм»): нативные элементы под капотом, единые
// подписи, подсказки, ошибки с привязкой, состояние «занято» у кнопок.

// ─── подпись, подсказка, ошибка ─────────────────────────────────────────

export function Field({ label, hint, error, optional, inline, children, className }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; inline?: boolean
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  className?: string
}) {
  const id = useId()
  const hintId = hint ? id + '-hint' : undefined
  const errId = error ? id + '-err' : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={'f-field' + (inline ? ' inline' : '') + (className ? ' ' + className : '')}>
      {label && <label htmlFor={id} className="f-label">{label}{optional && <span className="f-opt">необязательно</span>}</label>}
      {children({ id, describedBy, invalid: !!error })}
      {hint && <div id={hintId} className="f-hint">{hint}</div>}
      {error && <div id={errId} className="f-error" role="alert">{error}</div>}
    </div>
  )
}

type Ids = { id: string; describedBy?: string; invalid: boolean }
// Атрибуты связки с Field идут после rest: id, aria-describedby и
// aria-invalid от Field не перекрываются случайными пропсами.
const bind = (ids?: Ids) => {
  const a: Record<string, unknown> = {}
  if (ids) {
    a.id = ids.id
    if (ids.describedBy) a['aria-describedby'] = ids.describedBy
    if (ids.invalid) a['aria-invalid'] = true
  }
  return a
}

export function TextInput({ ids, size, mono, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { ids?: Ids; size?: 'sm' | 'md' | 'lg'; mono?: boolean }) {
  return <input type="text" {...rest} {...bind(ids)}
    className={[rest.className, size && size !== 'md' ? `f-${size}` : '', mono ? 'mono' : ''].filter(Boolean).join(' ') || undefined} />
}

export function NumberInput({ ids, width = 80, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ids?: Ids; width?: number }) {
  return <input type="number" {...rest} {...bind(ids)} style={{ width, ...(rest.style ?? {}) }} />
}

export function TextArea({ ids, auto = true, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ids?: Ids; auto?: boolean }) {
  return <textarea {...rest} {...bind(ids)} className={[rest.className, auto ? 'f-auto' : ''].filter(Boolean).join(' ') || undefined} />
}

// rows — число видимых строк у списка с multiple (нативный size).
export function Select({ ids, size, rows, children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { ids?: Ids; size?: 'sm' | 'md' | 'lg'; rows?: number }) {
  return <select {...rest} {...bind(ids)} size={rows} className={[rest.className, size && size !== 'md' ? `f-${size}` : ''].filter(Boolean).join(' ') || undefined}>{children}</select>
}

// Поле со списком подсказок: свободный ввод плюс варианты из datalist.
export function Combo({ ids, options, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ids?: Ids; options: string[] }) {
  const listId = useId()
  return <>
    <input type="text" list={listId} {...rest} {...bind(ids)} />
    <datalist id={listId}>{options.map(o => <option key={o} value={o} />)}</datalist>
  </>
}

export function PasswordInput({ ids, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ids?: Ids }) {
  const [show, setShow] = useState(false)
  return (
    <span className="f-wrap">
      <input type={show ? 'text' : 'password'} autoComplete={rest.autoComplete ?? 'current-password'} {...rest} {...bind(ids)} />
      <button type="button" className="f-eye" aria-label={show ? 'скрыть пароль' : 'показать пароль'} aria-pressed={show}
        onClick={() => setShow(s => !s)}>{show ? 'скрыть' : 'показать'}</button>
    </span>
  )
}

// Теги: Enter и запятая добавляют, Backspace на пустом поле снимает последний.
export function TagsInput({ ids, value, onChange, placeholder, disabled, mono = true }: {
  ids?: Ids; value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean; mono?: boolean
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const commit = () => {
    const t = draft.trim().replace(/,+$/, '')
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className={'f-tags' + (disabled ? ' disabled' : '') + (ids?.invalid ? ' invalid' : '')} onClick={() => inputRef.current?.focus()}>
      {value.map(t => (
        <span key={t} className="f-tag">{t}
          {!disabled && <button type="button" aria-label={`убрать ${t}`} onMouseDown={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); onChange(value.filter(x => x !== t)) }}>✕</button>}
        </span>
      ))}
      <input ref={inputRef} className={mono ? 'mono' : undefined} {...bind(ids)} value={draft} placeholder={value.length ? '' : placeholder}
        disabled={disabled} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
    </div>
  )
}

// Переключатель — кнопка с role=switch (по прототипу .sw / .sw.on): не
// checkbox, чтобы не смешиваться с чекбоксами «переопределить» в строках.
export function Switch({ on, disabled, onChange, label, title }: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string
}) {
  // <label> вокруг кнопки: клик по подписи переключает, читалка связывает
  // подпись с переключателем (кнопка — labelable-элемент).
  const id = useId()
  return (
    <label className="f-switch" title={title}>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={label ? id : undefined}
        className={'sw' + (on ? ' on' : '')} disabled={disabled} onClick={() => onChange(!on)} />
      {label && <span id={id}>{label}</span>}
    </label>
  )
}

export function Checkbox({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: ReactNode
}) {
  return (
    <label className="f-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

// ─── кнопки ─────────────────────────────────────────────────────────────

export function Button({ variant = 'default', size = 'md', busy, busyLabel = 'выполняю…', children, className, onClick, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'default' | 'quiet' | 'danger'; size?: 'sm' | 'md' | 'lg'; busy?: boolean; busyLabel?: string }) {
  // Занятая кнопка не выпадает из порядка табуляции (aria-disabled, не
  // disabled), держит ширину и не принимает повторных нажатий.
  const ref = useRef<HTMLButtonElement>(null)
  const widthRef = useRef<number | undefined>(undefined)
  if (busy && ref.current && widthRef.current === undefined) widthRef.current = ref.current.getBoundingClientRect().width
  if (!busy) widthRef.current = undefined
  const cls = ['btn', variant !== 'default' ? variant : '', size !== 'md' ? size : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={rest.type ?? 'button'} className={cls} disabled={disabled}
      aria-disabled={busy || undefined} style={{ ...(rest.style ?? {}), ...(widthRef.current ? { minWidth: widthRef.current } : {}) }}
      onClick={e => { if (busy) { e.preventDefault(); return } onClick?.(e) }} {...rest}>
      {busy ? <><span className="f-spin" aria-hidden="true" /><span className="f-sr" aria-live="polite">{busyLabel}</span>{children}</> : children}
    </button>
  )
}

export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <div className="f-actions">{note}{children}</div>
}

// Заметка формы: успех, ошибка или нейтральный текст; исчезает при новом
// действии, а не по таймеру.
export function FormNote({ ok, err, children }: { ok?: string; err?: string; children?: ReactNode }) {
  if (err) return <div className="f-note err" role="alert">{err}</div>
  if (ok) return <div className="f-note ok" role="status">{ok}</div>
  if (children) return <div className="f-note muted">{children}</div>
  return null
}

// ─── помощники ──────────────────────────────────────────────────────────

// useBusy — один запрос за раз: повторный вызов, пока идёт первый, игнорируется.
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    if (lock.current) return undefined
    lock.current = true; setBusy(true)
    try { return await fn() } finally { if (mounted.current) setBusy(false); lock.current = false }
  }, [])
  return [busy, run]
}

// fieldError — текст ошибки API для поля, если сервер назвал поле.
export function fieldError(e: unknown, field: string): string | undefined {
  if (e instanceof ApiError) {
    const d = e.data as { field?: string } | null
    if (d?.field === field) return e.message
  }
  return undefined
}

export function errText(e: unknown): string { return e instanceof Error ? e.message : String(e) }
