import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, apiField, RIVET_AGENT, SECRETS_MODES, type AgentProfile, type Runner, type SecretsMode } from '../api/client'
import { DEFAULT_LIMITS, agentRunnerStats, fieldShown, limitsDraft, parseLimits, refKey, refLabel, refOf, type LimitsDraft } from '../components/agentLogic'
import { Button, Checkbox, Field, FormActions, FormNote, NumberInput, Select, errText } from '../components/form'
import { useStore } from '../store'

// Вкладка «Агент Rivet» (add-native-agent, спека web «Вкладка агента»): один
// встроенный агент Rivet. Агентский цикл ведёт сам runner, модель берётся
// из подключений. Правятся модель по умолчанию, режим секретов, лимиты
// сессии и включение; модели агента вычисляет сервер.

function fieldOf(e: unknown): { field?: string; message: string } {
  if (e instanceof ApiError) return { field: apiField(e), message: e.message }
  return { message: errText(e) }
}

// Поля формы агента: ошибка другого поля (id, name, adapter у validateAgent)
// показывается общей заметкой, а не теряется.
const AGENT_FIELDS = ['default_model', 'secrets', 'limits'] as const

export function AgentsTab() {
  // undefined — загрузка, null — профиля rivet в каталоге нет.
  const [agent, setAgent] = useState<AgentProfile | null | undefined>(undefined)
  const [runners, setRunners] = useState<Runner[]>([])
  const [loadErr, setLoadErr] = useState('')
  const refresh = useCallback(() => {
    api.systemAgents()
      .then(c => { setAgent((c.agents ?? []).find(a => a.id === RIVET_AGENT) ?? null); setLoadErr('') })
      .catch(e => setLoadErr(errText(e)))
    api.runners().then(r => setRunners(r ?? [])).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])

  if (loadErr) return <FormNote err={loadErr} />
  if (agent === undefined) return <div className="muted">Загрузка…</div>
  if (agent === null) return <div className="muted">Агента Rivet в каталоге нет: обновите rivetd до версии со встроенным агентом.</div>
  return <AgentCard agent={agent} runners={runners} onSaved={setAgent} />
}

function AgentCard({ agent, runners, onSaved }: { agent: AgentProfile; runners: Runner[]; onSaved: (a: AgentProfile) => void }) {
  const { nav } = useStore()
  const [def, setDef] = useState(agent.default_model ? refKey(agent.default_model) : '')
  const [secrets, setSecrets] = useState<SecretsMode>(agent.secrets)
  const [enabled, setEnabled] = useState(agent.enabled)
  const [limits, setLimits] = useState<LimitsDraft>(limitsDraft(agent.limits))
  // Поля лимитов с вводом, который браузер не считает числом («-», «1e»):
  // value у них пустое, и без отметки это молча значило бы «по умолчанию».
  const [badInput, setBadInput] = useState<Partial<Record<keyof LimitsDraft, boolean>>>({})
  // Поколение полей лимитов: «Отменить правки» перемонтирует их. Нечисловой
  // ввод живёт только в DOM (value в состоянии пустое), и без перемонтирования
  // «-» осталось бы в поле после сброса.
  const [limitsGen, setLimitsGen] = useState(0)
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => err?.field && fieldShown(err.field, [f]) ? err.message : undefined

  const models = agent.models ?? []
  const available = models.filter(m => !m.unavailable)
  const parsed = parseLimits(limits)
  const base = limitsDraft(agent.limits)
  const anyBadInput = Object.values(badInput).some(Boolean)
  // Нечисловой ввод — тоже правка: его снимает «Отменить правки».
  const dirty = def !== (agent.default_model ? refKey(agent.default_model) : '') || secrets !== agent.secrets || enabled !== agent.enabled
    || limits.turns !== base.turns || limits.tokens !== base.tokens || limits.minutes !== base.minutes || anyBadInput
  const limitErr = (k: keyof LimitsDraft) => badInput[k] ? 'введите целое число больше нуля' : parsed.errors[k]
  const invalid = Object.keys(parsed.errors).length > 0 || anyBadInput
  const stats = agentRunnerStats(runners)
  const setLimit = (k: keyof LimitsDraft) => (v: string) => { setLimits(l => ({ ...l, [k]: v })); setNote('') }

  // Сервер заменяет модель по умолчанию и лимиты целиком: уходят все поля.
  const save = async () => {
    if (invalid) return
    setErr(null); setNote(''); setBusy(true)
    try {
      const saved = await api.putAgent({ name: agent.name, default_model: refOf(def), secrets, enabled, limits: parsed.limits })
      // Форма следует за ответом сервера: он нормализует лимиты и модель.
      setDef(saved.default_model ? refKey(saved.default_model) : ''); setSecrets(saved.secrets); setEnabled(saved.enabled)
      setLimits(limitsDraft(saved.limits))
      setNote('настройки агента сохранены')
      onSaved(saved)
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  const reset = () => {
    setDef(agent.default_model ? refKey(agent.default_model) : ''); setSecrets(agent.secrets); setEnabled(agent.enabled)
    setLimits(base); setBadInput({}); setLimitsGen(g => g + 1); setErr(null); setNote('')
  }

  const limitField = (k: keyof LimitsDraft, label: string, fallback: number | string) => (
    <Field label={label} optional error={limitErr(k)} hint={`пусто — ${typeof fallback === 'number' ? fallback.toLocaleString('ru-RU') : fallback}`}>
      {ids => <NumberInput ids={ids} min={1} step={1} width={140} placeholder={String(fallback)} value={limits[k]}
        onChange={e => { setBadInput(b => ({ ...b, [k]: e.target.validity.badInput })); setLimit(k)(e.target.value) }} />}
    </Field>
  )

  return (
    <div className="dw-sec">
      <div className={'conn-card' + (agent.enabled ? '' : ' off')} data-agent={agent.id}>
        <div className="head">
          <b>{agent.name}</b><span className="mono muted">{agent.id}</span>
          <span className="chip"><span className="n">встроенный</span></span>
          {!agent.enabled && <span className="chip"><span className="n">отключён</span></span>}
          <span className="muted" style={{ fontSize: 11.5 }} data-agent-runners>
            runner’ов: {stats.total || agent.runners}
            {stats.total > 0 && <> · в сети {stats.online} · в песочнице без сети {stats.isolated} из {stats.total}</>}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Агентский цикл ведёт сам runner: запрос к модели из подключений, инструменты и команды в рабочей копии задачи.
          Модели агента — все видимые модели включённых подключений.
        </div>
        <div className="meta">
          <span>capabilities <span className="mono">{agent.capabilities?.join(', ') || 'из runner’а'}</span></span>
          <span>изменил {agent.updated_by || '—'}</span>
        </div>
        <div className="models" data-agent-models>
          <span>модели:</span>
          {models.length === 0 && <span className="muted">нет: добавьте подключение к модели</span>}
          {models.map(m => (
            <span key={refKey(m)} className="chip" title={m.unavailable ? 'подключение отключено или модель скрыта' : undefined}>
              <span className="n mono" style={{ opacity: m.unavailable ? .5 : 1 }}>
                {refKey(m)}{agent.default_model && refKey(agent.default_model) === refKey(m) ? ' · по умолчанию' : ''}
              </span>
            </span>
          ))}
          {/* Список только для чтения: модели правятся в подключениях. */}
          <Button size="sm" variant="quiet" onClick={() => nav({ view: 'app-management', tab: 'connections' })}>Подключения →</Button>
        </div>
      </div>

      <div className="f-form" style={{ maxWidth: 760, marginTop: 12 }}>
        {err && !fieldShown(err.field, AGENT_FIELDS) && <FormNote err={err.message} />}
        <div className="f-grid">
          <Field label="Модель по умолчанию" optional error={fe('default_model')}
            hint="для ролей и участников без своей модели; пусто — модель назначения или runner’а">
            {ids => <Select ids={ids} value={def} onChange={e => { setDef(e.target.value); setNote('') }}>
              <option value="">не задана</option>
              {def && !available.some(m => refKey(m) === def) && <option value={def}>{refOf(def) ? refLabel(refOf(def)!) : def} (недоступна)</option>}
              {available.map(m => <option key={refKey(m)} value={refKey(m)}>{refLabel(m)}</option>)}
            </Select>}
          </Field>
          <Field label="Режим секретов" error={fe('secrets')} hint={SECRETS_MODES.find(m => m.id === secrets)?.hint}>
            {ids => <Select ids={ids} value={secrets} onChange={e => { setSecrets(e.target.value as SecretsMode); setNote('') }}>
              {SECRETS_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>}
          </Field>
        </div>
        <fieldset className="f-field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} data-agent-limits>
          <legend className="f-label" style={{ padding: 0, marginBottom: 4 }}>Лимиты сессии</legend>
          <div className="f-grid" key={limitsGen} style={{ gridTemplateColumns: 'repeat(3, auto)', justifyContent: 'start' }}>
            {limitField('turns', 'Ходов', DEFAULT_LIMITS.turns)}
            {limitField('tokens', 'Токенов', DEFAULT_LIMITS.tokens)}
            {limitField('minutes', 'Минут', DEFAULT_LIMITS.minutes || 'без ограничения')}
          </div>
          <div className="f-hint">сессия останавливается по первому сработавшему лимиту; токены — некешированный вход плюс выход</div>
          {fe('limits') && <div className="f-error" role="alert">{fe('limits')}</div>}
        </fieldset>
        <Checkbox checked={enabled} onChange={v => { setEnabled(v); setNote('') }} label="включён: runner’ы агента получают задачи" />
        <FormActions note={note ? <FormNote ok={note} /> : undefined}>
          <Button variant="quiet" disabled={!dirty || busy} onClick={reset}>Отменить правки</Button>
          <Button variant="primary" busy={busy} disabled={!dirty || invalid} onClick={save}>Сохранить</Button>
        </FormActions>
      </div>
    </div>
  )
}
