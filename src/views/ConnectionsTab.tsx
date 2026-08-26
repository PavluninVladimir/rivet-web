import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, CONNECTION_APIS, CONNECTION_KINDS, type ConnectionAPI, type ConnectionInput, type ConnectionKind, type ModelConnection, type ModelEntry, type PlannerView } from '../api/client'
import { fmtDate } from '../components/ui'
import { SideModal } from '../components/StepModal'
import { Button, Checkbox, Field, FormActions, FormNote, NumberInput, PasswordInput, Select, TextInput, errText } from '../components/form'
import { useActions } from './AppManagement'

// Вкладка «Подключения» (add-model-connections, спека web «Вкладка
// подключений к моделям»): карточки подключений, окно подключения и окно
// списка моделей у правого края, выбор модели декомпозиции Epic.

const STATE_LABEL: Record<string, string> = { ok: 'в порядке', invalid: 'ключ отклонён', unchecked: 'не проверено' }
const stateColor = (s: string) => s === 'ok' ? 'var(--c-done)' : s === 'invalid' ? 'var(--c-block)' : 'var(--c-review)'
const kindLabel = (k: ConnectionKind) => CONNECTION_KINDS.find(x => x.id === k)?.label ?? k
const usable = (c: ModelConnection) => c.enabled && c.state !== 'invalid'
const visibleModels = (c: ModelConnection) => c.models.filter(m => !m.hidden && !m.missing)

// Ошибка API у поля формы: сервер называет поле в теле ответа.
function fieldOf(e: unknown): { field?: string; message: string } {
  if (e instanceof ApiError) {
    const d = e.data as { field?: string } | null
    return { field: d?.field, message: e.message }
  }
  return { message: errText(e) }
}

type Modal = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'models'; id: string } | null

export function ConnectionsTab() {
  const [list, setList] = useState<ModelConnection[]>([])
  const [planner, setPlanner] = useState<PlannerView | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const refresh = useCallback(() => {
    api.connections().then(setList).catch(() => {})
    api.planner().then(setPlanner).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)
  const current = modal && modal.kind !== 'new' ? list.find(c => c.id === modal.id) : undefined

  return (
    <>
      {banner}
      <PlannerBlock list={list} planner={planner} onSaved={refresh} />

      <div className="dw-sec">
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Подключения</h3>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={() => setModal({ kind: 'new' })}>Новое подключение</Button>
        </div>
        {list.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Подключений нет. Добавьте вендора, агрегатор или локальный сервер моделей.</div>}
        <div className="conn-list">
          {list.map(c => {
            const shown = visibleModels(c)
            const hidden = c.models.length - shown.length
            return (
              <div key={c.id} className={'conn-card' + (c.enabled ? '' : ' off')} data-connection={c.id}>
                <div className="head">
                  <b>{c.name}</b><span className="mono muted">{c.id}</span>
                  <span className="chip"><span className="n">{kindLabel(c.kind)}</span></span>
                  <span className="chip"><span className="n">{c.api === 'anthropic' ? 'Anthropic API' : 'OpenAI-совместимый'}</span></span>
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

      {modal?.kind === 'new' && <ConnectionModal onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === 'edit' && current && <ConnectionModal conn={current} onClose={() => setModal(null)} onSaved={refresh} />}
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

function ConnectionModal({ conn, onClose, onSaved }: { conn?: ModelConnection; onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState(conn?.id ?? '')
  const [name, setName] = useState(conn?.name ?? '')
  const [kind, setKind] = useState<ConnectionKind>(conn?.kind ?? 'vendor')
  const [apiKind, setApiKind] = useState<ConnectionAPI>(conn?.api ?? 'openai')
  const [baseURL, setBaseURL] = useState(conn?.base_url ?? '')
  const [key, setKey] = useState('')
  const [dropKey, setDropKey] = useState(false)
  const [enabled, setEnabled] = useState(conn?.enabled ?? true)
  const [headers, setHeaders] = useState<HeaderDraft[]>((conn?.headers ?? []).map(h => ({ name: h.name, value: h.value ?? '', secret: h.secret, keep: h.secret })))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => err?.field === f ? err.message : undefined
  const idErr = !conn && id && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ? 'латиница, цифры, дефис' : fe('id')
  const apiDef = CONNECTION_APIS.find(a => a.id === apiKind)
  const canSave = !!id && !!name.trim() && !!baseURL.trim() && !idErr && !busy

  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const input: ConnectionInput = {
        name: name.trim(), kind, api: apiKind, base_url: baseURL.trim(), enabled,
        headers: headers.filter(h => h.name.trim()).map(h => ({ name: h.name.trim(), secret: h.secret, ...(h.secret && h.keep && !h.value ? {} : { value: h.value }) })),
      }
      if (key) input.key = key
      else if (dropKey) input.key = ''
      await api.putConnection(id, input)
      onSaved(); onClose()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  return (
    <SideModal titleId="conn-modal-title" onClose={onClose} title={conn ? <>Подключение <span className="mono">{conn.id}</span></> : 'Новое подключение'}>
      {err && !err.field && <FormNote err={err.message} />}
      <div className="f-grid">
        <Field label="Идентификатор" error={idErr} hint="латиница, цифры, дефис; не меняется">
          {ids => <TextInput ids={ids} mono placeholder="openrouter" value={id} disabled={!!conn} autoFocus={!conn} onChange={e => setId(e.target.value)} />}
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
      <Field label={conn?.has_key ? 'Новый ключ' : 'Ключ'} optional={kind === 'local' || !!conn?.has_key} error={fe('key')}
        hint={conn?.has_key ? `сохранён ключ ${conn.key_prefix}…; пусто — оставить прежний` : 'у локального сервера ключ необязателен'}>
        {ids => <PasswordInput ids={ids} placeholder="API-ключ" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); if (e.target.value) setDropKey(false) }} />}
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

interface ModelDraft { id: string; label: string; input: string; output: string; ctx: string; source: 'discovered' | 'manual'; hidden: boolean; missing: boolean }

function ModelsModal({ conn, onClose, onSaved }: { conn: ModelConnection; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<ModelDraft[]>(conn.models.map(m => ({
    id: m.id, label: m.label, input: usd(m.input_price), output: usd(m.output_price), ctx: m.context_window ? String(m.context_window) : '',
    source: m.source, hidden: m.hidden, missing: m.missing,
  })))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const up = (i: number, p: Partial<ModelDraft>) => setRows(rows.map((r, j) => j === i ? { ...r, ...p } : r))
  const fe = (i: number, f: string) => err?.field === `models[${i}].${f}` ? err.message : undefined
  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const models: ModelEntry[] = rows.map(r => ({
        id: r.id.trim(), label: r.label.trim() || r.id.trim(), source: r.source, hidden: r.hidden, missing: r.missing,
        input_price: micro(r.input), output_price: micro(r.output), context_window: r.ctx.trim() ? Number(r.ctx) : undefined,
      }))
      await api.putConnectionModels(conn.id, models)
      onSaved(); onClose()
    } catch (e) { setErr(fieldOf(e)) } finally { setBusy(false) }
  }
  return (
    <SideModal titleId="models-modal-title" onClose={onClose} title={<>Модели подключения <span className="mono">{conn.id}</span></>}>
      {err && !err.field && <FormNote err={err.message} />}
      <div className="muted" style={{ fontSize: 12 }}>
        Обнаруженные модели приходят кнопкой «Обновить список», у них правятся подпись, цены и скрытие. Ручные записи живут до удаления. Цены в долларах за миллион токенов.
      </div>
      <div className="model-rows">
        <div className="model-row hdr"><span>идентификатор</span><span>подпись</span><span>вход $</span><span>выход $</span><span>контекст</span><span>скрыта</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className={'model-row' + (r.missing ? ' missing' : '')} data-model={r.id}>
            <div>
              <TextInput size="sm" mono aria-label="идентификатор модели" value={r.id} disabled={r.source === 'discovered'} onChange={e => up(i, { id: e.target.value })} />
              {fe(i, 'id') && <div className="f-error">{fe(i, 'id')}</div>}
              <div className="src">{r.source === 'discovered' ? (r.missing ? 'пропала у провайдера' : 'обнаружена') : 'вручную'}</div>
            </div>
            <TextInput size="sm" aria-label="подпись" value={r.label} onChange={e => up(i, { label: e.target.value })} />
            <NumberInput className="f-sm" aria-label="цена входа" min={0} step="0.01" width={76} value={r.input} onChange={e => up(i, { input: e.target.value })} aria-invalid={fe(i, 'input_price') ? true : undefined} />
            <NumberInput className="f-sm" aria-label="цена выхода" min={0} step="0.01" width={76} value={r.output} onChange={e => up(i, { output: e.target.value })} aria-invalid={fe(i, 'output_price') ? true : undefined} />
            <NumberInput className="f-sm" aria-label="окно контекста" min={0} width={84} value={r.ctx} onChange={e => up(i, { ctx: e.target.value })} />
            <Checkbox checked={r.hidden} onChange={on => up(i, { hidden: on })} label="" />
            {r.source === 'manual'
              ? <Button variant="quiet" size="sm" aria-label="убрать модель" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>
              : <span />}
          </div>
        ))}
      </div>
      <div><Button size="sm" onClick={() => setRows([...rows, { id: '', label: '', input: '', output: '', ctx: '', source: 'manual', hidden: false, missing: false }])}>+ модель вручную</Button></div>
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} disabled={busy || rows.some(r => !r.id.trim())} onClick={save}>Сохранить</Button>
      </FormActions>
    </SideModal>
  )
}
