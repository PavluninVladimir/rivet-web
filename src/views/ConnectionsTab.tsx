import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, apiField, CONNECTION_APIS, CONNECTION_KINDS, type ConnectionAPI, type ConnectionInput, type ConnectionKind, type ConnectionPreset, type ModelConnection, type ModelEntry, type PlannerView } from '../api/client'
import { fmtDate } from '../components/ui'
import { fieldShown, parseTokens, presetConnectionId, presetForSave, presetInUse } from '../components/agentLogic'
import { SideModal } from '../components/StepModal'
import { Button, Checkbox, Field, FormActions, FormNote, NumberInput, PasswordInput, Select, TextInput, errText } from '../components/form'
import { useActions } from './AppManagement'
import { InfraConnections } from './InfraConnections'

// Вкладка «Подключения» (add-model-connections, спека web «Вкладка
// подключений к моделям»): карточки подключений, окно подключения и окно
// списка моделей у правого края, выбор модели декомпозиции Epic. Пресеты
// провайдеров (add-native-agent) открывают то же окно с готовыми полями.
// Под подключениями моделей: раздел «Инфраструктура» с провайдерами
// хостов окружений (add-environment-provisioning).

const STATE_LABEL: Record<string, string> = { ok: 'в порядке', invalid: 'ключ отклонён', unchecked: 'не проверено' }
const stateColor = (s: string) => s === 'ok' ? 'var(--c-done)' : s === 'invalid' ? 'var(--c-block)' : 'var(--c-review)'
const kindLabel = (k: ConnectionKind) => CONNECTION_KINDS.find(x => x.id === k)?.label ?? k
const apiLabel = (a: ConnectionAPI) => a === 'anthropic' ? 'Anthropic API' : 'OpenAI-совместимый'
const usable = (c: ModelConnection) => c.enabled && c.state !== 'invalid'
const visibleModels = (c: ModelConnection) => c.models.filter(m => !m.hidden && !m.missing)

// Ошибка API у поля формы: сервер называет поле в теле ответа (рядом с
// конвертом error или внутри него).
function fieldOf(e: unknown): { field?: string; message: string } {
  if (e instanceof ApiError) return { field: apiField(e), message: e.message }
  return { message: errText(e) }
}

// Поля окна подключения: ошибка другого поля (preset у unknown_preset)
// показывается общей заметкой окна.
const CONN_FIELDS = ['id', 'name', 'kind', 'api', 'base_url', 'key', 'headers'] as const

type Modal = { kind: 'new'; preset?: ConnectionPreset } | { kind: 'edit'; id: string } | { kind: 'models'; id: string } | null

export function ConnectionsTab() {
  const [list, setList] = useState<ModelConnection[]>([])
  // Список подключений загружен: без него карточки пресетов не показываются,
  // иначе пресет занял бы идентификатор существующего подключения и PUT
  // (upsert) перезаписал бы его.
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [planner, setPlanner] = useState<PlannerView | null>(null)
  // Пресеты провайдеров; старый бэкенд их не отдаёт — блока нет.
  const [presets, setPresets] = useState<ConnectionPreset[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  // Итог сохранения из окна подключения: проверка и полученные модели.
  const [saved, setSaved] = useState<{ ok?: string; err?: string } | null>(null)
  const refresh = useCallback(() => {
    api.connections()
      .then(l => { setList(l ?? []); setLoaded(true); setLoadErr('') })
      .catch(e => setLoadErr(`список подключений не загрузился: ${errText(e)}`))
    api.planner().then(setPlanner).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  // models у пресета без своего списка мог прийти null (старый бэкенд):
  // нормализуем один раз, дальше код читает массив.
  useEffect(() => {
    api.connectionPresets()
      .then(r => setPresets((r?.presets ?? []).map(p => ({ ...p, models: p.models ?? [] }))))
      .catch(() => setPresets([]))
  }, [])
  const { act, banner, busy } = useActions(refresh)
  const current = modal && modal.kind !== 'new' ? list.find(c => c.id === modal.id) : undefined

  return (
    <>
      {banner}
      {loadErr && <div style={{ marginBottom: 8 }}><FormNote err={loadErr} /></div>}
      {saved && (saved.ok || saved.err) && <div style={{ marginBottom: 8 }} data-connection-saved><FormNote ok={saved.ok} err={saved.err} /></div>}
      <PlannerBlock list={list} planner={planner} onSaved={refresh} />

      <div className="dw-sec">
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Подключения</h3>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" disabled={!loaded} onClick={() => { setSaved(null); setModal({ kind: 'new' }) }}>Новое подключение</Button>
        </div>
        {loaded && presets.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Готовые провайдеры: адрес и тип API уже заполнены, останется ключ.</div>
            <div className="preset-grid">
              {presets.map(p => {
                const used = presetInUse(p, list)
                return (
                  <button key={p.id} type="button" className="preset-card" data-preset={p.id} onClick={() => { setSaved(null); setModal({ kind: 'new', preset: p }) }}>
                    <span className="head">
                      <b>{p.name}</b>
                      <span className="chip"><span className="n">{kindLabel(p.kind)}</span></span>
                      {used && <span className="chip"><span className="n">подключено</span></span>}
                    </span>
                    <span className="mono muted url">{p.base_url}</span>
                    <span className="muted">{apiLabel(p.api)} · {p.need_key ? 'нужен ключ' : 'без ключа'}{p.models.length > 0 ? ` · моделей в пресете: ${p.models.length}` : ''}</span>
                    {p.hint && <span className="muted hint">{p.hint}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {loaded && list.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Подключений нет. Выберите провайдера выше или добавьте вендора, агрегатор или локальный сервер моделей вручную.</div>}
        <div className="conn-list">
          {list.map(c => {
            const shown = visibleModels(c)
            const hidden = c.models.length - shown.length
            return (
              <div key={c.id} className={'conn-card' + (c.enabled ? '' : ' off')} data-connection={c.id}>
                <div className="head">
                  <b>{c.name}</b><span className="mono muted">{c.id}</span>
                  <span className="chip"><span className="n">{kindLabel(c.kind)}</span></span>
                  <span className="chip"><span className="n">{apiLabel(c.api)}</span></span>
                  {!c.enabled && <span className="chip"><span className="n">отключено</span></span>}
                  {planner?.source === 'catalog' && planner.connection_id === c.id && <span className="chip"><span className="n">декомпозиция</span></span>}
                </div>
                <div className="meta">
                  <span>адрес <span className="mono">{c.base_url}</span></span>
                  <span>ключ <span className="mono">{c.has_key ? `${c.key_prefix || '••••'}…` : 'нет'}</span></span>
                  <span>состояние <span style={{ color: stateColor(c.state) }}>{STATE_LABEL[c.state] ?? c.state}</span>
                    {c.check_detail && <> · {c.check_detail}</>}{c.checked_at && <> · {fmtDate(c.checked_at)}</>}</span>
                  <span>изменил {c.updated_by}</span>
                </div>
                <div className="models">
                  <span>моделей: {shown.length}{hidden > 0 && ` (+${hidden} скрытых или пропавших)`}</span>
                  {shown.slice(0, 6).map(m => <span key={m.id} className="chip"><span className="n mono">{m.id}</span></span>)}
                  {shown.length > 6 && <span>ещё {shown.length - 6}</span>}
                </div>
                <div className="actions">
                  <Button size="sm" busy={busy} onClick={act(() => api.checkConnection(c.id), 'подключение проверено')}>Проверить</Button>
                  <Button size="sm" busy={busy} onClick={act(async () => {
                    const r = await api.discoverModels(c.id)
                    return r
                  }, 'список моделей обновлён')}>Обновить список</Button>
                  <Button size="sm" onClick={() => setModal({ kind: 'models', id: c.id })}>Модели…</Button>
                  <Button size="sm" onClick={() => setModal({ kind: 'edit', id: c.id })}>Изменить</Button>
                  <Button size="sm" variant="quiet" busy={busy} onClick={act(() => api.putConnection(c.id, {
                    name: c.name, kind: c.kind, api: c.api, base_url: c.base_url, enabled: !c.enabled,
                  }), c.enabled ? 'подключение отключено' : 'подключение включено')}>{c.enabled ? 'Отключить' : 'Включить'}</Button>
                  {confirmDel === c.id
                    ? <Button size="sm" variant="danger" busy={busy} onClick={act(async () => { await api.deleteConnection(c.id); setConfirmDel(null) }, 'подключение удалено')}>Удалить?</Button>
                    : <Button size="sm" variant="danger" onClick={() => setConfirmDel(c.id)}>Удалить</Button>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Ключи и секретные заголовки хранятся зашифрованными и повторно не показываются. При сохранении подключение проверяется запросом списка моделей.
        </div>
      </div>

      <InfraConnections />

      {modal?.kind === 'new' && <ConnectionModal preset={modal.preset} taken={list.map(c => c.id)} onClose={() => setModal(null)} onSaved={r => { setSaved(r); refresh() }} />}
      {modal?.kind === 'edit' && current && <ConnectionModal conn={current} onClose={() => setModal(null)} onSaved={r => { setSaved(r); refresh() }} />}
      {modal?.kind === 'models' && current && <ModelsModal conn={current} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  )
}

// ─── модель декомпозиции ─────────────────────────────────────────────────

function PlannerBlock({ list, planner, onSaved }: { list: ModelConnection[]; planner: PlannerView | null; onSaved: () => void }) {
  const [connId, setConnId] = useState('')
  const [model, setModel] = useState('')
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Форма следует за сервером, пока человек её не трогал: фоновые
  // обновления вкладки не затирают несохранённый выбор.
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty) return
    if (planner?.source === 'catalog') { setConnId(planner.connection_id ?? ''); setModel(planner.model ?? '') }
    else { setConnId(''); setModel('') }
  }, [planner, dirty])
  const options = list.filter(usable).filter(c => visibleModels(c).length > 0)
  const conn = list.find(c => c.id === connId)
  const models = conn ? visibleModels(conn) : []
  const save = async (pm: { connection_id?: string; model?: string }) => {
    setErr(null); setNote(''); setBusy(true)
    try {
      const r = await api.putPlanner(pm)
      setNote(r.source === 'catalog' ? `декомпозиция идёт моделью ${r.connection_id}/${r.model}` : 'модель декомпозиции сброшена на окружение установки')
      setDirty(false)
      onSaved()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  const sourceText = planner?.source === 'catalog'
    ? <>из каталога: <span className="mono">{planner.connection_id}/{planner.model}</span>{planner.state === 'invalid' && <span style={{ color: 'var(--c-block)' }}> · недоступна: {planner.detail}</span>}</>
    : planner?.source === 'env' ? <>из окружения установки (<span className="mono">{planner.connection_id}</span>, {planner.model}); выберите модель из каталога, чтобы управлять ею из консоли</>
      : 'не настроена: декомпозиция Epic отвечает отказом «модель не настроена»'
  return (
    <div className="dw-sec">
      <h3>Модель для декомпозиции Epic</h3>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Сейчас {sourceText}.</div>
      <div className="f-grid" style={{ gridTemplateColumns: '1fr 1fr auto auto', alignItems: 'end' }}>
        <Field label="Подключение" error={err?.field === 'connection_id' ? err.message : undefined}>
          {ids => <Select ids={ids} value={connId} onChange={e => { setConnId(e.target.value); setModel(''); setDirty(true) }}>
            <option value="">выберите подключение</option>
            {options.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
          </Select>}
        </Field>
        <Field label="Модель" error={err?.field === 'model' ? err.message : undefined}>
          {ids => <Select ids={ids} value={model} disabled={!conn} onChange={e => { setModel(e.target.value); setDirty(true) }}>
            <option value="">выберите модель</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.label !== m.id ? `${m.label} · ${m.id}` : m.id}</option>)}
          </Select>}
        </Field>
        <Button variant="primary" busy={busy} disabled={!connId || !model} onClick={() => save({ connection_id: connId, model })}>Сохранить</Button>
        <Button variant="quiet" busy={busy} disabled={planner?.source !== 'catalog'} onClick={() => save({})}>Сбросить на окружение</Button>
      </div>
      {(err && !err.field) || note ? <div style={{ marginTop: 6 }}><FormNote err={err && !err.field ? err.message : undefined} ok={note || undefined} /></div> : null}
    </div>
  )
}

// ─── окно подключения ────────────────────────────────────────────────────

interface HeaderDraft { name: string; value: string; secret: boolean; keep: boolean }

// Итог сохранения подключения для заметки вкладки: состояние проверки и
// результат запроса списка моделей.
type SaveResult = { ok?: string; err?: string }

// Сохранённое подключение в порядке, а моделей у него нет (новое или
// исправленный ключ): список моделей запрашивается сразу, а не ждёт кнопки
// «Обновить список» (спека web «Пресеты провайдеров в консоли»).
// preset — пресет ушёл серверу в PUT. Тогда список уже запросил сам сервер
// и вернул подключение с моделями, второй запрос только удвоил бы ожидание
// у медленного провайдера. Если провайдер список не отдал, у подключения
// остаются модели пресета: их сохраняет сервер с source preset.
async function afterSave(saved: ModelConnection, isNew: boolean, preset: ConnectionPreset | undefined): Promise<SaveResult> {
  const c = { ...saved, models: saved.models ?? [] }
  const state = STATE_LABEL[c.state] ?? c.state
  const presetModels = c.models.filter(m => m.source === 'preset').map(m => m.id)
  if (c.state !== 'ok') {
    return { err: `подключение ${c.id} сохранено: ${state}${c.check_detail ? ` · ${c.check_detail}` : ''}`
      + (preset && presetModels.length ? `. Используются модели пресета: ${presetModels.join(', ')}` : '') }
  }
  if (!isNew && c.models.length > 0) return { ok: `подключение ${c.id} сохранено и проверено` }
  if (preset && visibleModels(c).length > 0) {
    return { ok: `подключение ${c.id} в порядке · моделей получено от провайдера: ${visibleModels(c).length}` }
  }
  try {
    const r = await api.discoverModels(c.id)
    const n = visibleModels(r.connection).length
    return { ok: `подключение ${c.id} в порядке · моделей получено от провайдера: ${n}${r.added.length ? ` (новых ${r.added.length})` : ''}` }
  } catch (e) {
    const models = presetModels.length ? presetModels : preset?.models.map(m => m.id) ?? []
    return {
      err: `подключение ${c.id} в порядке, но список моделей провайдер не отдал: ${errText(e)}`
        + (models.length ? `. Используются модели пресета: ${models.join(', ')}` : '. Добавьте модели вручную в окне «Модели…»'),
    }
  }
}

// preset — новое подключение по пресету провайдера: поля заполнены из
// него, сервер получает идентификатор пресета, если адрес и тип API — его
// (модели пресета на случай, если провайдер список не отдаёт).
function ConnectionModal({ conn, preset, taken = [], onClose, onSaved }: {
  conn?: ModelConnection; preset?: ConnectionPreset; taken?: string[]; onClose: () => void; onSaved: (r: SaveResult) => void
}) {
  const [id, setId] = useState(conn?.id ?? (preset ? presetConnectionId(preset, taken) : ''))
  const [name, setName] = useState(conn?.name ?? preset?.name ?? '')
  const [kind, setKind] = useState<ConnectionKind>(conn?.kind ?? preset?.kind ?? 'vendor')
  const [apiKind, setApiKind] = useState<ConnectionAPI>(conn?.api ?? preset?.api ?? 'openai')
  const [baseURL, setBaseURL] = useState(conn?.base_url ?? preset?.base_url ?? '')
  const [key, setKey] = useState('')
  const [dropKey, setDropKey] = useState(false)
  const [enabled, setEnabled] = useState(conn?.enabled ?? true)
  const [headers, setHeaders] = useState<HeaderDraft[]>((conn?.headers ?? []).map(h => ({ name: h.name, value: h.value ?? '', secret: h.secret, keep: h.secret })))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => err?.field && fieldShown(err.field, [f]) ? err.message : undefined
  const idErr = !conn && id && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ? 'латиница, цифры, дефис'
    : !conn && taken.includes(id) ? 'подключение с таким идентификатором уже есть' : fe('id')
  // Ключ не нужен локальному серверу и провайдеру пресета без ключа.
  const keyOptional = kind === 'local' || !!conn?.has_key || (!!preset && !preset.need_key)
  const apiDef = CONNECTION_APIS.find(a => a.id === apiKind)
  const canSave = !!id && !!name.trim() && !!baseURL.trim() && !idErr && !busy
  // Модели пресета не приклеиваются к другому адресу или типу API.
  const presetId = preset ? presetForSave(preset, { api: apiKind, base_url: baseURL }) : undefined
  const presetDropped = !!preset && preset.models.length > 0 && !presetId

  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const input: ConnectionInput = {
        name: name.trim(), kind, api: apiKind, base_url: baseURL.trim(), enabled,
        headers: headers.filter(h => h.name.trim()).map(h => ({ name: h.name.trim(), secret: h.secret, ...(h.secret && h.keep && !h.value ? {} : { value: h.value }) })),
      }
      if (key) input.key = key
      else if (dropKey) input.key = ''
      if (presetId) input.preset = presetId
      const saved = await api.putConnection(id, input)
      const result = await afterSave(saved, !conn, presetId ? preset : undefined)
      onSaved(result); onClose()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  return (
    <SideModal titleId="conn-modal-title" onClose={onClose} title={conn ? <>Подключение <span className="mono">{conn.id}</span></> : preset ? `Подключение ${preset.name}` : 'Новое подключение'}>
      {err && !fieldShown(err.field, CONN_FIELDS) && <FormNote err={err.message} />}
      {preset && (
        <div className="muted" style={{ fontSize: 12 }} data-preset-hint>
          Пресет <b>{preset.name}</b>{preset.hint ? `: ${preset.hint}` : ''}.
          {' '}При сохранении Rivet запросит у провайдера список моделей.
          {preset.models.length > 0 && !presetDropped && <> Если провайдер его не отдаёт, останутся модели пресета: <span className="mono">{preset.models.map(m => m.id).join(', ')}</span>.</>}
          {presetDropped && <> Адрес или тип API отличаются от пресета: модели пресета не сохранятся, только полученные от провайдера.</>}
        </div>
      )}
      <div className="f-grid">
        <Field label="Идентификатор" error={idErr} hint="латиница, цифры, дефис; не меняется">
          {ids => <TextInput ids={ids} mono placeholder="openrouter" value={id} disabled={!!conn} autoFocus={!conn && !preset} onChange={e => setId(e.target.value)} />}
        </Field>
        <Field label="Название" error={fe('name')}>
          {ids => <TextInput ids={ids} placeholder="OpenRouter" value={name} autoFocus={!!conn} onChange={e => setName(e.target.value)} />}
        </Field>
      </div>
      <div className="f-grid">
        <Field label="Вид" error={fe('kind')}>
          {ids => <Select ids={ids} value={kind} onChange={e => setKind(e.target.value as ConnectionKind)}>
            {CONNECTION_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>}
        </Field>
        <Field label="Тип API" error={fe('api')} hint={apiDef?.hint}>
          {ids => <Select ids={ids} value={apiKind} onChange={e => {
            const a = e.target.value as ConnectionAPI
            setApiKind(a)
            // Автозаполненный адрес прежнего типа не остаётся у нового.
            if (!baseURL || baseURL === 'https://api.anthropic.com') setBaseURL(a === 'anthropic' ? 'https://api.anthropic.com' : '')
          }}>
            {CONNECTION_APIS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>}
        </Field>
      </div>
      <Field label="Base URL" error={fe('base_url')} hint={apiKind === 'openai' ? 'вместе с префиксом версии, если провайдер его требует: https://openrouter.ai/api/v1, http://localhost:1234/v1' : undefined}>
        {ids => <TextInput ids={ids} mono placeholder={apiKind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} value={baseURL} onChange={e => setBaseURL(e.target.value)} />}
      </Field>
      <Field label={conn?.has_key ? 'Новый ключ' : 'Ключ'} optional={keyOptional} error={fe('key')}
        hint={conn?.has_key ? `сохранён ключ ${conn.key_prefix}…; пусто — оставить прежний` : preset && !preset.need_key ? 'этому провайдеру ключ не нужен' : 'у локального сервера ключ необязателен'}>
        {ids => <PasswordInput ids={ids} placeholder="API-ключ" autoComplete="off" value={key} autoFocus={!!preset && preset.need_key} onChange={e => { setKey(e.target.value); if (e.target.value) setDropKey(false) }} />}
      </Field>
      {conn?.has_key && !key && <Checkbox checked={dropKey} onChange={setDropKey} label="удалить сохранённый ключ" />}

      <Field label="Дополнительные заголовки" optional hint="секретное значение хранится зашифрованным и не показывается">
        {() => <div className="f-form" style={{ gap: 6 }}>
          {headers.map((h, i) => (
            <div key={i} className="hdr-row">
              <TextInput size="sm" mono placeholder="X-Title" aria-label="имя заголовка" value={h.name} onChange={e => setHeaders(headers.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              {h.secret
                ? <PasswordInput className="f-sm" placeholder={h.keep ? 'сохранено, пусто — оставить' : 'значение'} aria-label="значение заголовка" autoComplete="off" value={h.value} onChange={e => setHeaders(headers.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                : <TextInput size="sm" placeholder="значение" aria-label="значение заголовка" value={h.value} onChange={e => setHeaders(headers.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />}
              <Checkbox checked={h.secret} onChange={on => setHeaders(headers.map((x, j) => j === i ? { ...x, secret: on } : x))} label="секрет" />
              <Button variant="quiet" size="sm" aria-label="убрать заголовок" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
          {fe('headers') && <div className="f-error" role="alert">{fe('headers')}</div>}
          <div><Button size="sm" onClick={() => setHeaders([...headers, { name: '', value: '', secret: false, keep: false }])}>+ заголовок</Button></div>
        </div>}
      </Field>
      <Checkbox checked={enabled} onChange={setEnabled} label="включено" />
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} busyLabel="проверка…" disabled={!canSave} onClick={save}>{conn ? 'Сохранить' : 'Создать и проверить'}</Button>
      </FormActions>
    </SideModal>
  )
}

// ─── окно списка моделей ─────────────────────────────────────────────────

const usd = (micro?: number) => micro === undefined || micro === null ? '' : String(micro / 1_000_000)
const micro = (s: string) => s.trim() === '' ? undefined : Math.round(Number(s) * 1_000_000)

interface ModelDraft {
  id: string; label: string; input: string; output: string; cached: string
  ctx: string; maxOut: string; modelMax: string
  source: ModelEntry['source']; hidden: boolean; missing: boolean
}
const tokens = (n?: number) => n ? String(n) : ''
// Поля модели в токенах: окно контекста, предел ответа на ход и предельный
// выход модели (add-native-agent). Пусто — умолчание агентского цикла.
const TOKEN_FIELDS = [['ctx', 'context_window'], ['maxOut', 'max_output_tokens'], ['modelMax', 'model_max_output']] as const
function draftErrors(r: ModelDraft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, f] of TOKEN_FIELDS) { const e = parseTokens(r[k]).error; if (e) out[f] = e }
  for (const [k, f] of [['input', 'input_price'], ['output', 'output_price'], ['cached', 'cached_input_price']] as const) {
    if (r[k].trim() !== '' && !(Number(r[k]) >= 0)) out[f] = 'цена — число не меньше нуля'
  }
  const maxOut = parseTokens(r.maxOut).value, modelMax = parseTokens(r.modelMax).value, ctx = parseTokens(r.ctx).value
  if (maxOut && modelMax && maxOut > modelMax) out.max_output_tokens = 'больше предела выхода модели'
  else if (maxOut && ctx && maxOut >= ctx) out.max_output_tokens = 'не меньше окна контекста'
  return out
}
const SOURCE_LABEL: Record<string, string> = { discovered: 'обнаружена', preset: 'из пресета', manual: 'вручную' }
// Поля строки модели, у которых ошибка показывается своей строкой.
const ROW_ERROR_FIELDS = ['id', 'input_price', 'output_price', 'cached_input_price', 'context_window', 'max_output_tokens', 'model_max_output'] as const
const FIELD_LABEL: Record<string, string> = {
  input_price: 'цена входа', output_price: 'цена выхода', cached_input_price: 'цена кешированного входа',
  context_window: 'окно контекста', max_output_tokens: 'ответ на ход', model_max_output: 'предел модели',
}

function ModelsModal({ conn, onClose, onSaved }: { conn: ModelConnection; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<ModelDraft[]>(conn.models.map(m => ({
    id: m.id, label: m.label, input: usd(m.input_price), output: usd(m.output_price), cached: usd(m.cached_input_price),
    ctx: tokens(m.context_window), maxOut: tokens(m.max_output_tokens), modelMax: tokens(m.model_max_output),
    source: m.source, hidden: m.hidden, missing: m.missing,
  })))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const up = (i: number, p: Partial<ModelDraft>) => setRows(rows.map((r, j) => j === i ? { ...r, ...p } : r))
  const local = rows.map(draftErrors)
  // Ошибка поля: своя проверка формы или ответ сервера по models[i].<поле>.
  const fe = (i: number, f: string) => local[i][f] ?? (err?.field === `models[${i}].${f}` ? err.message : undefined)
  // Ошибка сервера по полю строки, которого строка не рисует (label,
  // сама запись), — под строкой; не по строке — общей заметкой окна.
  const rowErr = (i: number) => {
    const f = err?.field
    if (!f || !fieldShown(f, [`models[${i}]`])) return undefined
    const sub = f.slice(`models[${i}]`.length).replace(/^\./, '')
    return (ROW_ERROR_FIELDS as readonly string[]).includes(sub) ? undefined : err.message
  }
  const general = err && !rows.some((_, i) => fieldShown(err.field, [`models[${i}]`]))
  const invalid = local.some(e => Object.keys(e).length > 0)
  const save = async () => {
    if (invalid) return
    setErr(null); setBusy(true)
    try {
      const models: ModelEntry[] = rows.map(r => ({
        id: r.id.trim(), label: r.label.trim() || r.id.trim(), source: r.source, hidden: r.hidden, missing: r.missing,
        input_price: micro(r.input), output_price: micro(r.output), cached_input_price: micro(r.cached),
        context_window: parseTokens(r.ctx).value, max_output_tokens: parseTokens(r.maxOut).value, model_max_output: parseTokens(r.modelMax).value,
      }))
      await api.putConnectionModels(conn.id, models)
      onSaved(); onClose()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  return (
    <SideModal titleId="models-modal-title" onClose={onClose} title={<>Модели подключения <span className="mono">{conn.id}</span></>}>
      {general && <FormNote err={err.message} />}
      <div className="muted" style={{ fontSize: 12 }}>
        Обнаруженные модели приходят кнопкой «Обновить список», у них правятся подпись, цены, пределы и скрытие. Ручные записи живут до удаления.
        Цены в долларах за миллион токенов, кешированный вход без цены считается по цене входа. Окно и пределы в токенах, пусто — умолчания агента Rivet
        (ответ на ход 8192 токена).
      </div>
      <div className="model-rows">
        <div className="model-row hdr"><span>идентификатор</span><span>подпись</span><span>вход $</span><span>выход $</span><span>контекст</span><span>скрыта</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className={'model-row' + (r.missing ? ' missing' : '')} data-model={r.id}>
            <div>
              <TextInput size="sm" mono aria-label="идентификатор модели" value={r.id} disabled={r.source === 'discovered'} onChange={e => up(i, { id: e.target.value })} />
              {fe(i, 'id') && <div className="f-error">{fe(i, 'id')}</div>}
              <div className="src">{r.source === 'discovered' && r.missing ? 'пропала у провайдера' : SOURCE_LABEL[r.source] ?? r.source}</div>
            </div>
            <TextInput size="sm" aria-label="подпись" value={r.label} onChange={e => up(i, { label: e.target.value })} />
            <NumberInput className="f-sm" aria-label="цена входа" min={0} step="0.01" width={76} value={r.input} onChange={e => up(i, { input: e.target.value })} aria-invalid={fe(i, 'input_price') ? true : undefined} />
            <NumberInput className="f-sm" aria-label="цена выхода" min={0} step="0.01" width={76} value={r.output} onChange={e => up(i, { output: e.target.value })} aria-invalid={fe(i, 'output_price') ? true : undefined} />
            <NumberInput className="f-sm" aria-label="окно контекста" min={1} step={1} width={84} value={r.ctx} onChange={e => up(i, { ctx: e.target.value })} aria-invalid={fe(i, 'context_window') ? true : undefined} />
            <Checkbox checked={r.hidden} onChange={on => up(i, { hidden: on })} label="" />
            {r.source !== 'discovered'
              ? <Button variant="quiet" size="sm" aria-label="убрать модель" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>
              : <span />}
            <div className="model-extra">
              <label>кеш-вход $
                <NumberInput className="f-sm" aria-label="цена кешированного входа" min={0} step="0.01" width={76} placeholder={r.input || 'как вход'} value={r.cached}
                  onChange={e => up(i, { cached: e.target.value })} aria-invalid={fe(i, 'cached_input_price') ? true : undefined} />
              </label>
              <label title="предел ответа модели на один ход агента">ответ на ход
                <NumberInput className="f-sm" aria-label="предел ответа на ход" min={1} step={1} width={84} placeholder="8192" value={r.maxOut}
                  onChange={e => up(i, { maxOut: e.target.value })} aria-invalid={fe(i, 'max_output_tokens') ? true : undefined} />
              </label>
              <label title="предельный выход модели: потолок, до которого агент увеличивает ответ, если вызов инструмента обрезан">предел модели
                <NumberInput className="f-sm" aria-label="предельный выход модели" min={1} step={1} width={84} value={r.modelMax}
                  onChange={e => up(i, { modelMax: e.target.value })} aria-invalid={fe(i, 'model_max_output') ? true : undefined} />
              </label>
              {ROW_ERROR_FIELDS.filter(f => f !== 'id').map(f => fe(i, f)
                ? <span key={f} className="f-error" role="alert">{FIELD_LABEL[f]}: {fe(i, f)}</span> : null)}
              {rowErr(i) && <span className="f-error" role="alert">{rowErr(i)}</span>}
            </div>
          </div>
        ))}
      </div>
      <div><Button size="sm" onClick={() => setRows([...rows, { id: '', label: '', input: '', output: '', cached: '', ctx: '', maxOut: '', modelMax: '', source: 'manual', hidden: false, missing: false }])}>+ модель вручную</Button></div>
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} disabled={busy || invalid || rows.some(r => !r.id.trim())} onClick={save}>Сохранить</Button>
      </FormActions>
    </SideModal>
  )
}
