import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, PLACEHOLDERS, SECRETS_MODES, type AgentInput, type AgentModelRef, type AgentProfile, type EnvVar, type ExternalAgent, type ModelConnection, type SecretsMode } from '../api/client'
import { SideModal } from '../components/StepModal'
import { Button, Checkbox, Field, FormActions, FormNote, Select, TagsInput, TextArea, TextInput, errText } from '../components/form'
import { useActions } from './AppManagement'

// Вкладка «Агенты» (add-agent-profiles, спека web «Вкладка агентов»):
// карточки профилей, окно профиля у правого края: адаптер, команда,
// привязки моделей из подключений, модель по умолчанию, шаблон окружения,
// режим доставки секретов.

function fieldOf(e: unknown): { field?: string; message: string } {
  if (e instanceof ApiError) {
    const d = e.data as { field?: string } | null
    return { field: d?.field, message: e.message }
  }
  return { message: errText(e) }
}
const refKey = (m: AgentModelRef) => `${m.connection_id}/${m.model}`
const sameRef = (a: AgentModelRef | null | undefined, b: AgentModelRef) => !!a && a.connection_id === b.connection_id && a.model === b.model

export function AgentsTab() {
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [external, setExternal] = useState<ExternalAgent[]>([])
  const [connections, setConnections] = useState<ModelConnection[]>([])
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; id: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const refresh = useCallback(() => {
    api.systemAgents().then(c => { setAgents(c.agents ?? []); setExternal(c.external ?? []) }).catch(() => {})
    api.connections().then(setConnections).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)
  const current = modal?.kind === 'edit' ? agents.find(a => a.id === modal.id) : undefined

  return (
    <>
      {banner}
      <div className="dw-sec">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Агенты</h3>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={() => setModal({ kind: 'new' })}>Новый агент</Button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Профиль агента связывает адаптер и команду запуска с моделями из подключений. Runner объявляет агента, модели и окружение приходят из профиля при назначении.
        </div>
        <div className="conn-list">
          {agents.map(a => (
            <div key={a.id} className={'conn-card' + (a.enabled ? '' : ' off')} data-agent={a.id}>
              <div className="head">
                <b>{a.name}</b><span className="mono muted">{a.id}</span>
                <span className="chip"><span className="n">{a.adapter === 'claude-code' ? 'нативный Claude Code' : 'обёртка'}</span></span>
                {a.preset && <span className="chip"><span className="n">предустановлен</span></span>}
                {!a.enabled && <span className="chip"><span className="n">отключён</span></span>}
                <span className="muted" style={{ fontSize: 11.5 }}>runner’ов: {a.runners}</span>
              </div>
              <div className="meta">
                {a.command && <span>команда <span className="mono">{a.command}</span></span>}
                <span>capabilities <span className="mono">{a.capabilities.join(', ') || '—'}</span></span>
                <span>секреты: {SECRETS_MODES.find(m => m.id === a.secrets)?.label ?? a.secrets}</span>
                <span>изменил {a.updated_by || '—'}</span>
              </div>
              <div className="models">
                <span>модели:</span>
                {a.models.length === 0 && <span className="muted">нет привязок, runner’ы работают на объявленных моделях</span>}
                {a.models.map(m => (
                  <span key={refKey(m)} className="chip" title={m.unavailable ? 'подключение отключено' : undefined}>
                    <span className="n mono" style={{ opacity: m.unavailable ? .5 : 1 }}>{refKey(m)}{sameRef(a.default_model, m) ? ' · по умолчанию' : ''}</span>
                  </span>
                ))}
              </div>
              <div className="actions">
                <Button size="sm" onClick={() => setModal({ kind: 'edit', id: a.id })}>Изменить</Button>
                <Button size="sm" variant="quiet" busy={busy} onClick={act(() => api.putAgent(a.id, {
                  name: a.name, adapter: a.adapter, command: a.command, capabilities: a.capabilities, models: a.models,
                  default_model: a.default_model, env: a.env, args: a.args, secrets: a.secrets, enabled: !a.enabled,
                }), a.enabled ? 'профиль отключён' : 'профиль включён')}>{a.enabled ? 'Отключить' : 'Включить'}</Button>
                {!a.preset && (confirmDel === a.id
                  ? <Button size="sm" variant="danger" busy={busy} onClick={act(async () => { await api.deleteAgent(a.id); setConfirmDel(null) }, 'профиль удалён')}>Удалить?</Button>
                  : <Button size="sm" variant="danger" onClick={() => setConfirmDel(a.id)}>Удалить</Button>)}
              </div>
            </div>
          ))}
        </div>
        {external.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Агенты вне каталога, объявленные runner’ами: работают на своих моделях и окружении хоста.</div>
            <div className="models">
              {external.map(e => <span key={e.id} className="chip" title={`runner’ов: ${e.runners}`}><span className="n mono">{e.id} · {e.models.join(', ') || 'без моделей'}</span></span>)}
            </div>
          </div>
        )}
      </div>
      {modal?.kind === 'new' && <AgentModal connections={connections} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === 'edit' && current && <AgentModal agent={current} connections={connections} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  )
}

const PRESET_ENV: Record<string, { env: EnvVar[]; args: string[]; command: string }> = {
  'claude-code': { env: [{ name: 'ANTHROPIC_API_KEY', value: '{{key}}' }, { name: 'ANTHROPIC_BASE_URL', value: '{{base_url}}' }], args: [], command: '' },
  wrap: { env: [{ name: 'OPENAI_API_KEY', value: '{{key}}' }, { name: 'OPENAI_BASE_URL', value: '{{base_url}}' }], args: ['--model', '{{model}}'], command: '' },
}

function AgentModal({ agent, connections, onClose, onSaved }: { agent?: AgentProfile; connections: ModelConnection[]; onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState(agent?.id ?? '')
  const [name, setName] = useState(agent?.name ?? '')
  const [adapter, setAdapter] = useState<'claude-code' | 'wrap'>(agent?.adapter ?? 'wrap')
  const [command, setCommand] = useState(agent?.command ?? '')
  const [caps, setCaps] = useState<string[]>(agent?.capabilities ?? ['coding'])
  const [models, setModels] = useState<AgentModelRef[]>(agent?.models.map(m => ({ connection_id: m.connection_id, model: m.model })) ?? [])
  const [def, setDef] = useState<AgentModelRef | null>(agent?.default_model ?? null)
  const [env, setEnv] = useState<EnvVar[]>(agent?.env ?? PRESET_ENV.wrap.env)
  const [args, setArgs] = useState(agent?.args?.join(' ') ?? '')
  const [secrets, setSecrets] = useState<SecretsMode>(agent?.secrets ?? 'secure')
  const [enabled, setEnabled] = useState(agent?.enabled ?? true)
  const [pickConn, setPickConn] = useState('')
  const [pickModel, setPickModel] = useState('')
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => err?.field === f ? err.message : undefined
  const idErr = !agent && id && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ? 'латиница, цифры, дефис' : fe('id')
  const usable = connections.filter(c => c.enabled && c.state !== 'invalid')
  const pickable = usable.find(c => c.id === pickConn)?.models.filter(m => !m.hidden && !m.missing) ?? []
  const addModel = () => {
    if (!pickConn || !pickModel) return
    const ref = { connection_id: pickConn, model: pickModel }
    if (models.some(m => sameRef(m, ref))) return
    const next = [...models, ref]
    setModels(next)
    if (!def) setDef(ref)
    setPickModel('')
  }
  const removeModel = (m: AgentModelRef) => {
    const next = models.filter(x => !sameRef(x, m))
    setModels(next)
    if (sameRef(def, m)) setDef(next[0] ?? null)
  }
  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const input: AgentInput = {
        name: name.trim(), adapter, command: command.trim(), capabilities: caps, models, default_model: def,
        env: env.filter(e => e.name.trim()).map(e => ({ name: e.name.trim(), value: e.value })),
        args: args.trim() ? args.trim().split(/\s+/) : [], secrets, enabled,
      }
      await api.putAgent(id, input)
      onSaved(); onClose()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  const canSave = !!id && !!name.trim() && !idErr && !busy
  return (
    <SideModal titleId="agent-modal-title" onClose={onClose} title={agent ? <>Агент <span className="mono">{agent.id}</span></> : 'Новый агент'}>
      {err && !err.field && <FormNote err={err.message} />}
      <div className="f-grid">
        <Field label="Идентификатор" error={idErr} hint="runner объявляет его флагом -agent">
          {ids => <TextInput ids={ids} mono placeholder="my-agent" value={id} disabled={!!agent} autoFocus={!agent} onChange={e => setId(e.target.value)} />}
        </Field>
        <Field label="Название" error={fe('name')}>
          {ids => <TextInput ids={ids} placeholder="Мой агент" value={name} autoFocus={!!agent} onChange={e => setName(e.target.value)} />}
        </Field>
      </div>
      <div className="f-grid">
        <Field label="Адаптер" error={fe('adapter')} hint={adapter === 'claude-code' ? 'нативные хуки Claude Code, полная глубина данных' : 'любой CLI-агент в PTY, минимальная глубина'}>
          {ids => <Select ids={ids} value={adapter} onChange={e => {
            const a = e.target.value as 'claude-code' | 'wrap'
            setAdapter(a)
            if (!agent) { setEnv(PRESET_ENV[a].env); setArgs(PRESET_ENV[a].args.join(' ')) }
          }}>
            <option value="wrap">обёртка (wrap)</option>
            <option value="claude-code">нативный Claude Code</option>
          </Select>}
        </Field>
        <Field label="Режим секретов" error={fe('secrets')} hint={SECRETS_MODES.find(m => m.id === secrets)?.hint}>
          {ids => <Select ids={ids} value={secrets} onChange={e => setSecrets(e.target.value as SecretsMode)}>
            {SECRETS_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>}
        </Field>
      </div>
      {adapter === 'wrap' && (
        <Field label="Команда запуска" error={fe('command')} hint="промпт лежит в файле $RIVET_PROMPT_FILE; пусто — команда из флага -cmd runner’а">
          {ids => <TextInput ids={ids} mono placeholder='codex exec "$(cat "$RIVET_PROMPT_FILE")"' value={command} onChange={e => setCommand(e.target.value)} />}
        </Field>
      )}
      <Field label="Capabilities" optional hint="дополняют capabilities runner’а" error={fe('capabilities')}>
        {ids => <TagsInput ids={ids} value={caps} onChange={setCaps} placeholder="coding, review" />}
      </Field>

      <Field label="Модели" hint="привязки из подключений; первая или отмеченная — по умолчанию" error={fe('models') ?? fe('default_model')}>
        {() => <div className="f-form" style={{ gap: 6 }}>
          {models.map((m, i) => (
            <div key={refKey(m)} className="hdr-row" data-binding={refKey(m)} style={{ alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 12 }}>{refKey(m)}</span>
              <label className="f-check" style={{ flex: 'none' }}>
                <input type="radio" name="default-model" checked={sameRef(def, m)} onChange={() => setDef(m)} aria-label={`по умолчанию ${refKey(m)}`} />
                <span className="muted" style={{ fontSize: 12 }}>по умолчанию</span>
              </label>
              {fe(`models[${i}]`) && <span className="f-error">{fe(`models[${i}]`)}</span>}
              <Button variant="quiet" size="sm" aria-label={`убрать ${refKey(m)}`} onClick={() => removeModel(m)}>✕</Button>
            </div>
          ))}
          <div className="hdr-row">
            <Select size="sm" aria-label="подключение" value={pickConn} onChange={e => { setPickConn(e.target.value); setPickModel('') }}>
              <option value="">подключение…</option>
              {usable.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            </Select>
            <Select size="sm" aria-label="модель подключения" value={pickModel} disabled={!pickConn} onChange={e => setPickModel(e.target.value)}>
              <option value="">модель…</option>
              {pickable.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
            </Select>
            <Button size="sm" disabled={!pickConn || !pickModel} onClick={addModel} style={{ flex: 'none' }}>+ привязать</Button>
          </div>
        </div>}
      </Field>

      <Field label="Окружение агента" hint={`подстановки: ${PLACEHOLDERS.join(' ')}`} error={fe('env')}>
        {() => <div className="f-form" style={{ gap: 6 }}>
          {env.map((v, i) => (
            <div key={i} className="hdr-row">
              <TextInput size="sm" mono placeholder="ANTHROPIC_API_KEY" aria-label="имя переменной" value={v.name} aria-invalid={fe(`env[${i}].name`) ? true : undefined}
                onChange={e => setEnv(env.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <TextInput size="sm" mono placeholder="{{key}}" aria-label="значение переменной" value={v.value} aria-invalid={fe(`env[${i}].value`) ? true : undefined}
                onChange={e => setEnv(env.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              <Button variant="quiet" size="sm" aria-label="убрать переменную" style={{ flex: 'none' }} onClick={() => setEnv(env.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
          {env.map((_, i) => (fe(`env[${i}].name`) || fe(`env[${i}].value`)) ? <div key={'e' + i} className="f-error" role="alert">{fe(`env[${i}].name`) ?? fe(`env[${i}].value`)}</div> : null)}
          <div><Button size="sm" onClick={() => setEnv([...env, { name: '', value: '' }])}>+ переменная</Button></div>
        </div>}
      </Field>
      <Field label="Аргументы агента" optional hint="через пробел, с подстановками; у нативного адаптера добавляются к claude" error={fe('args') ?? (err?.field?.startsWith('args[') ? err.message : undefined)}>
        {ids => <TextArea ids={ids} className="mono" rows={1} placeholder="--model {{model}}" value={args} onChange={e => setArgs(e.target.value)} />}
      </Field>
      <Checkbox checked={enabled} onChange={setEnabled} label="включён" />
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} disabled={!canSave} onClick={save}>{agent ? 'Сохранить' : 'Создать'}</Button>
      </FormActions>
    </SideModal>
  )
}
