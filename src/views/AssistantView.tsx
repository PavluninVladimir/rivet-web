import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type ModelChoice, type User } from '../api/client'
import {
  assistantApi,
  type AssistantAction,
  type AssistantConfig,
  type AssistantMessage,
  type AssistantRun,
  type AssistantView as View,
  type EvidenceRef
} from '../api/assistant'
import { ACTION_LABEL, projectEvidenceHref, RUN_LABEL } from '../components/assistantLogic'
import { Button, errText } from '../components/form'
import { useIsOwner } from '../components/useOwner'
import { useStore } from '../store'

export function AssistantView({ user }: { user: User }) {
  const { projectId, tick, connected } = useStore(),
    owner = useIsOwner(projectId, user.login)
  const [view, setView] = useState<View | null>(null),
    [messages, setMessages] = useState<AssistantMessage[]>([]),
    [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null),
    [run, setRun] = useState<AssistantRun | null>(null),
    [actions, setActions] = useState<AssistantAction[]>([])
  const [config, setConfig] = useState<AssistantConfig | null>(null),
    [text, setText] = useState(''),
    [intent, setIntent] = useState<'question' | 'recover'>('question'),
    [err, setErr] = useState(''),
    [unsupported, setUnsupported] = useState(false),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false)
  const seq = useRef(0),
    loadedHistory = useRef(false),
    pending = useRef<{ text: string; intent: 'question' | 'recover'; revision: string; key: string } | null>(
      null
    )
  const refresh = useCallback(async () => {
    if (!projectId) return
    const n = ++seq.current
    setRefreshing(true)
    try {
      const [v, m] = await Promise.all([assistantApi.view(projectId), assistantApi.messages(projectId)])
      if (n !== seq.current) return
      setView(v)
      setRefreshing(false)
      setMessages(prev => [
        ...(m.items ?? []),
        ...prev.filter(old => !(m.items ?? []).some(item => item.id === old.id))
      ])
      if (!loadedHistory.current) setCursor(m.next_cursor)
      setUnsupported(!v.capability)
      const id = selected ?? v.active_run?.id ?? m.items?.find(item => item.run_id)?.run_id
      if (id) {
        const detail = await assistantApi.run(projectId, id)
        if (n === seq.current) {
          setRun(detail.run)
          setActions(detail.actions ?? [])
        }
      }
    } catch (e) {
      if (n === seq.current) {
        if (e instanceof ApiError && e.status === 404) setUnsupported(true)
        else setErr(errText(e))
      }
    }
  }, [projectId, selected])
  useEffect(() => {
    void refresh()
    return () => {
      seq.current++
    }
  }, [refresh, tick])
  const send = async () => {
    if (!projectId || !view || !text.trim() || busy) return
    setBusy(true)
    setErr('')
    const old = pending.current
    const cmd =
      old && old.text === text && old.intent === intent
        ? old
        : { text, intent, revision: view.snapshot.revision, key: crypto.randomUUID() }
    pending.current = cmd
    try {
      const res = await assistantApi.send(projectId, cmd.text, cmd.intent, cmd.revision, cmd.key)
      pending.current = null
      setSelected(res.run.id)
      setRun(res.run)
      setText('')
      await refresh()
    } catch (e) {
      setErr(errText(e))
      if (e instanceof ApiError && e.status < 500) {
        pending.current = null
        if (e.status === 409) await refresh()
      }
    } finally {
      setBusy(false)
    }
  }
  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      setConfig(null)
      await refresh()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const evidence = (ids: string[]) =>
    ids
      .map(id => view?.snapshot.refs.find(r => r.id === id))
      .filter((r): r is EvidenceRef => !!r)
      .map(r => {
        const url = projectEvidenceHref(r.url, projectId ?? '')
        return (
          <li key={r.id}>
            {url ? <a href={url}>{r.label}</a> : <span>{r.label}</span>} <small>{r.observed_at}</small>
            {r.excerpt && <blockquote>{r.excerpt}</blockquote>}
          </li>
        )
      })
  if (unsupported)
    return (
      <div className="page">
        <h1>Ассистент</h1>
        <p>Ассистент недоступен на этой версии сервера.</p>
      </div>
    )
  return (
    <div className="page workspace assistant">
      <div className="page-head">
        <h1>Ассистент</h1>
        <span className="sub">Проектные факты и действия по действующим правилам</span>
      </div>
      {err && (
        <p role="alert" className="workspace-error">
          {err}
        </p>
      )}
      {!view ? (
        <p>Загрузка…</p>
      ) : (
        <>
          <div className="workspace-toolbar">
            <span>{connected ? 'Связь есть' : 'Нет связи, данные могут устареть'}</span>
            <span>Снимок: {view.snapshot.computed_at}</span>
            <Button size="sm" onClick={() => void refresh()}>
              Обновить
            </Button>
          </div>
          <form
            onSubmit={e => {
              e.preventDefault()
              void send()
            }}
            className="workspace-card"
          >
            <label>
              Вопрос о проекте
              <textarea
                value={text}
                maxLength={8000}
                rows={3}
                onChange={e => setText(e.target.value)}
                placeholder="Что с проектом? Что мешает завершению?"
              />
            </label>
            <label>
              Режим
              <select value={intent} onChange={e => setIntent(e.target.value as typeof intent)}>
                <option value="question">Только ответ</option>
                <option value="recover">Восстановить: выполнить разрешённые retry/resume</option>
              </select>
            </label>
            {intent === 'recover' && (
              <p className="muted">
                Разрешённые действия выполняются автоматически. Запреты и решения человека остаются в силе.
              </p>
            )}
            <Button type="submit" busy={busy} disabled={!connected || !text.trim()}>
              Отправить
            </Button>
          </form>
          <section aria-label="Диалог" className="workspace-card">
            <h2>Диалог</h2>
            {[...messages]
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map(m => (
                <article key={m.id} className="assistant-message">
                  <b>{m.author === 'user' ? 'Вы' : 'Ассистент'}</b> <small>{m.created_at}</small>
                  <p>{m.text}</p>
                  <ul>{evidence(m.ref_ids ?? [])}</ul>
                  {m.run_id && (
                    <button className="btn sm" onClick={() => setSelected(m.run_id)}>
                      Ход ответа
                    </button>
                  )}
                </article>
              ))}
            {cursor && (
              <Button
                size="sm"
                onClick={() =>
                  void assistantApi
                    .messages(projectId!, cursor)
                    .then(m => {
                      loadedHistory.current = true
                      setMessages(prev => [...prev, ...m.items.filter(x => !prev.some(y => x.id === y.id))])
                      setCursor(m.next_cursor)
                    })
                    .catch(e => setErr(errText(e)))
                }
              >
                Предыдущие сообщения
              </Button>
            )}
          </section>
          {run && (
            <section className="workspace-card" aria-label="Ход выполнения">
              <h2>{RUN_LABEL[run.status] ?? run.status}</h2>
              {(refreshing || run.stale || run.snapshot_revision !== view.snapshot.revision) && (
                <p role="status">Ответ основан на прежнем снимке. Текущее состояние изменилось.</p>
              )}
              <p>{run.summary}</p>
              {(run.uncertainties ?? []).length > 0 && (
                <>
                  <h3>Неопределённость</h3>
                  <ul>
                    {run.uncertainties.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted">
                Токены: {run.usage.input_tokens} / {run.usage.output_tokens}, стоимость:{' '}
                {run.usage.cost_usd === null ? 'неизвестна' : `$${run.usage.cost_usd}`}. Завершение ответа не
                означает приёмку продукта.
              </p>
              {(owner || run.initiator_id === user.id) &&
                ['queued', 'running', 'waiting_human'].includes(run.status) && (
                  <Button
                    disabled={busy}
                    onClick={() => void mutate(() => assistantApi.stop(projectId!, run, crypto.randomUUID()))}
                  >
                    Остановить ассистента
                  </Button>
                )}
              <p className="muted">Остановка не отменяет задачи проекта.</p>
              {actions.map(a => (
                <article key={a.id} className="assistant-action">
                  <h3>
                    {a.type} · {ACTION_LABEL[a.status] ?? a.status}
                  </h3>
                  <p>{a.guard.message}</p>
                  <p>
                    Правило: {a.guard.decision} · {a.guard.code}
                  </p>
                  {a.status === 'succeeded' && (
                    <p>
                      Принято системой: {a.result?.resource_status ?? 'результат подтверждён'}. Сама задача
                      может продолжать выполняться.
                    </p>
                  )}
                  {a.status === 'unknown' && (
                    <p>Исполнение ещё не подтверждено. Повтор автоматически не отправляется.</p>
                  )}
                  <ul>{evidence(a.evidence_ids ?? [])}</ul>
                  {(a.result?.decision_url ?? a.result?.url) &&
                    projectEvidenceHref((a.result?.decision_url ?? a.result?.url)!, projectId!) && (
                      <a href={a.result?.decision_url ?? a.result?.url}>Открыть штатное решение</a>
                    )}
                </article>
              ))}
              {(run.followups ?? []).map((f, i) => (
                <p key={i}>
                  Неподдерживаемая операция: {f.type}. {f.reason}{' '}
                  {projectEvidenceHref(f.url, projectId!) && <a href={f.url}>Перейти</a>}
                </p>
              ))}
            </section>
          )}
          <details className="workspace-card">
            <summary>Факты текущего снимка</summary>
            {view.snapshot.facts.map(f => (
              <article key={f.id}>
                <b>{f.kind}</b>
                <pre>{JSON.stringify(f.value, null, 2)}</pre>
                <ul>{evidence(f.ref_ids)}</ul>
              </article>
            ))}
          </details>
          {owner && (
            <details className="workspace-card">
              <summary>Настройки ассистента</summary>
              <AssistantSettings
                value={config ?? view.config}
                onChange={setConfig}
                busy={busy}
                onSave={() => void mutate(() => assistantApi.configure(projectId!, config ?? view.config))}
              />
            </details>
          )}
        </>
      )}
    </div>
  )
}
function AssistantSettings({
  value,
  onChange,
  onSave,
  busy
}: {
  value: AssistantConfig
  onChange: (v: AssistantConfig) => void
  onSave: () => void
  busy: boolean
}) {
  const [catalog, setCatalog] = useState<ModelChoice[]>([]),
    [catalogError, setCatalogError] = useState('')
  useEffect(() => {
    let live = true
    void api
      .modelChoices()
      .then(x => {
        if (live) setCatalog(x.choices ?? [])
      })
      .catch(() => {
        if (live)
          setCatalogError(
            'Каталог подключений недоступен. Введите доступный ID, сервер проверит права и модель.'
          )
      })
    return () => {
      live = false
    }
  }, [])
  return (
    <div className="workspace-form">
      <label>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={e => onChange({ ...value, enabled: e.target.checked })}
        />{' '}
        Автоматическое восстановление по событиям
      </label>
      <p>
        Спонсор действий назначается сервером текущему владельцу. Отзыв прав останавливает новые действия.
      </p>
      <label>
        Подключение
        <input
          list="assistant-connections"
          value={value.connection_id ?? ''}
          onChange={e => onChange({ ...value, connection_id: e.target.value })}
        />
        <datalist id="assistant-connections">
          {[...new Set(catalog.map(c => c.connection_id))].map(id => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>
      <label>
        Модель
        <input
          list="assistant-models"
          value={value.model_id ?? ''}
          onChange={e => onChange({ ...value, model_id: e.target.value })}
        />
        <datalist id="assistant-models">
          {[...new Set(catalog.filter(c => c.connection_id === value.connection_id).map(c => c.model))].map(
            id => (
              <option key={id} value={id} />
            )
          )}
        </datalist>
      </label>
      {catalogError && <p>{catalogError}</p>}
      {(Object.keys(value.limits) as (keyof typeof value.limits)[]).map(k => (
        <label key={k}>
          {
            {
              max_run_actions: 'Действий за запуск (1–3)',
              max_run_seconds: 'Секунд на запуск (1–120)',
              max_input_tokens: 'Входных токенов',
              max_output_tokens: 'Выходных токенов',
              daily_tokens: 'Токенов в день',
              daily_cost_usd: 'Долларов в день, пусто без денежного лимита'
            }[k]
          }
          <input
            type="number"
            min={k === 'daily_cost_usd' ? 0.001 : 1}
            step={k === 'daily_cost_usd' ? 'any' : 1}
            max={k === 'max_run_actions' ? 3 : k === 'max_run_seconds' ? 120 : undefined}
            value={value.limits[k] ?? ''}
            onChange={e =>
              onChange({
                ...value,
                limits: {
                  ...value.limits,
                  [k]: e.target.value === '' && k === 'daily_cost_usd' ? null : Number(e.target.value)
                }
              })
            }
          />
        </label>
      ))}
      <Button busy={busy} onClick={onSave}>
        Сохранить настройки
      </Button>
    </div>
  )
}
