import { useCallback, useEffect, useState } from 'react'
import { api, apiCurrent, apiField, apiRefs, ROLE_CAPABILITIES, ROLE_COLORS, type AgentRole, type AgentRoleInput, type ModelChoice, type RoleRef } from '../api/client'
import { SideModal } from '../components/StepModal'
import { RoleChip } from '../components/RoleChip'
import { mergeDraft, refText, roleColorVar } from '../components/roleLabels'
import { Button, Checkbox, Field, FormActions, FormNote, Select, TextArea, TextInput, errText } from '../components/form'
import { useStore } from '../store'
import { useActions } from './AppManagement'

// Вкладка «Шаблоны ролей» (add-agent-roles, спека web «Команда и шаблоны
// ролей в разделе управления»): из шаблонов собирается команда агентов.
// Создание — POST (занятый идентификатор — 409 role_exists), изменение —
// PUT с updated_at: чужую правку (409 stale) форма сливает со своими
// полями, общие поля требуют подтверждения. Встроенный шаблон только
// отключается; отказ из-за ссылок показывает их перечень.

// Поля шаблона, которые правит форма; модель — «подключение/модель».
// Агент один (агент Rivet, add-native-agent): поле agent форма не
// показывает и сохраняет как было.
type RoleFields = {
  title: string; description: string; instruction: string; color: string; capability: string
  agent: string; model: string; enabled: boolean
}
const FIELD_LABEL: Record<keyof RoleFields, string> = {
  title: 'название', description: 'зона ответственности', instruction: 'инструкция', color: 'цвет',
  capability: 'capability', agent: 'агент', model: 'модель', enabled: 'включение',
}
const fieldsOf = (r: AgentRole): RoleFields => ({
  title: r.title, description: r.description, instruction: r.instruction, color: r.color,
  capability: r.capability, agent: r.agent ?? '', model: r.model ? `${r.connection_id}/${r.model}` : '', enabled: r.enabled,
})

// Тело PUT. Сервер трактует отсутствие модели как сброс, поэтому текущая
// модель уходит всегда. Исключение — Тимлид: его модель — модель
// планировщика, она уходит, только если её поменяли.
function bodyOf(f: RoleFields, base: AgentRole, updatedAt: string): AgentRoleInput {
  const [conn, ...rest] = f.model ? f.model.split('/') : ['']
  const modelChanged = f.model !== fieldsOf(base).model
  const sendModel = base.id !== 'lead' || modelChanged
  return {
    title: f.title, description: f.description, instruction: f.instruction, color: f.color, capability: f.capability,
    agent: base.control_plane ? '' : f.agent, enabled: f.enabled, updated_at: updatedAt,
    ...(sendModel && f.model ? { connection_id: conn, model: rest.join('/') } : {}),
  }
}

type SaveResult = { saved: AgentRole } | { conflicts: (keyof RoleFields)[]; current: AgentRole }
// Сохранение изменения шаблона от версии base с разбором 409 stale: свои
// правки (относительно base) накладываются на актуальную версию; без общих
// полей — повтор поверх неё, с общими — решает администратор (force —
// записать свои значения). Подтверждение действует только для версии
// current: новая чужая правка до повтора показывает конфликты заново.
async function saveRole(base: AgentRole, draft: RoleFields, force = false, current?: AgentRole, depth = 0): Promise<SaveResult> {
  let fields = draft
  let target = base
  if (current) {
    const m = mergeDraft(fieldsOf(base), fieldsOf(current), draft, [['agent', 'model']])
    if (m.conflicts.length && !force) return { conflicts: m.conflicts, current }
    fields = m.fields
    target = current
  }
  try {
    return { saved: await api.updateRole(base.id, bodyOf(fields, target, target.updated_at)) }
  } catch (e) {
    const cur = apiCurrent<AgentRole>(e)
    if (!cur || depth >= 3) throw e
    return saveRole(base, draft, false, cur, depth + 1)
  }
}

export function RolesTab() {
  const { roles, refreshRoles } = useStore()
  const [choices, setChoices] = useState<ModelChoice[]>([])
  // Окно держит снимок шаблона: удаление шаблона другим администратором не
  // закрывает форму с черновиком, а сохранение сообщит об этом.
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; role: AgentRole } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [refs, setRefs] = useState<{ id: string; refs: RoleRef[] } | null>(null)
  const refresh = useCallback(() => {
    api.modelChoices().then(r => setChoices(r?.choices ?? [])).catch(() => {})
    refreshRoles()
  }, [refreshRoles])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)

  // Отключение и удаление с разбором отказа role_in_use: перечень ссылок
  // показывается под карточкой.
  const guarded = (id: string, fn: () => Promise<unknown>, msg: string) => act(async () => {
    setRefs(null)
    try { await fn() } catch (e) {
      const list = apiRefs(e)
      if (list.length) setRefs({ id, refs: list })
      throw e
    }
  }, msg)
  const toggle = (r: AgentRole) => guarded(r.id, async () => {
    const res = await saveRole(r, { ...fieldsOf(r), enabled: !r.enabled })
    if ('conflicts' in res) throw new Error('шаблон только что изменил другой администратор: проверьте карточку и повторите')
  }, r.enabled ? 'шаблон отключён' : 'шаблон включён')

  return (
    <>
      {banner}
      <div className="dw-sec">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Шаблоны ролей</h3>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" onClick={() => setModal({ kind: 'new' })}>Новый шаблон</Button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Шаблон задаёт, кем агент выступает: инструкция уходит агенту в каждом назначении, модель служит
          значением по умолчанию. Из шаблонов собирается команда агентов на вкладке «Команда».
        </div>
        {roles.length === 0 && <div className="muted">Шаблонов нет или каталог недоступен.</div>}
        <div className="conn-list">
          {roles.map(r => (
            <div key={r.id} className={'conn-card' + (r.enabled ? '' : ' off')} data-role-card={r.id}>
              <div className="head">
                <span className="role-swatch" style={{ ['--rc' as string]: roleColorVar(r.color) }} />
                <b>{r.title}</b><span className="mono muted">{r.id}</span>
                {r.builtin && <span className="chip"><span className="n">встроенный</span></span>}
                {r.control_plane && <span className="chip" title="выполняет control plane, участником шага быть не может"><span className="n">control plane</span></span>}
                {!r.enabled && <span className="chip"><span className="n">отключён</span></span>}
                <span className="muted" style={{ fontSize: 11.5 }}>агентов: {r.agents ?? 0}</span>
              </div>
              {r.description && <div style={{ fontSize: 12.5 }}>{r.description}</div>}
              <div className="meta">
                <span>capability <span className="mono">{r.capability || 'нет'}</span></span>
                <span>модель <span className="mono">{r.model ? `${r.connection_id}/${r.model}` : r.id === 'lead' ? 'из окружения' : 'по умолчанию агента'}</span></span>
                <span>изменил {r.updated_by || '—'}</span>
              </div>
              {r.instruction && <div className="role-instr" title={r.instruction}>{r.instruction}</div>}
              {refs?.id === r.id && (
                <div className="budget-pause" data-role-refs>Шаблон используется: {refs.refs.map(refText).join('; ')}</div>
              )}
              <div className="actions">
                <Button size="sm" onClick={() => setModal({ kind: 'edit', role: r })}>Изменить</Button>
                <Button size="sm" variant="quiet" busy={busy} onClick={toggle(r)}>{r.enabled ? 'Отключить' : 'Включить'}</Button>
                {r.builtin
                  ? <Button size="sm" variant="danger" disabled title="встроенный шаблон можно только отключить">Удалить</Button>
                  : confirmDel === r.id
                    ? <Button size="sm" variant="danger" busy={busy}
                        onClick={guarded(r.id, async () => { setConfirmDel(null); await api.deleteRole(r.id) }, 'шаблон удалён')}>Удалить?</Button>
                    : <Button size="sm" variant="danger" onClick={() => setConfirmDel(r.id)}>Удалить</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {modal?.kind === 'new' && <RoleModal choices={choices} taken={roles.map(r => r.id)} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === 'edit' && <RoleModal role={modal.role} choices={choices} taken={[]} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  )
}

function RoleModal({ role, choices, taken, onClose, onSaved }: {
  role?: AgentRole; choices: ModelChoice[]; taken: string[]; onClose: () => void; onSaved: () => void
}) {
  // Версия, от которой правит форма, — снимок на момент открытия: по нему
  // видно, какие поля менял администратор, а какие — другие.
  const init = role ? fieldsOf(role) : { title: '', description: '', instruction: '', color: 'blue', capability: 'coding', agent: '', model: '', enabled: true }
  const [id, setId] = useState(role?.id ?? '')
  const [f, setF] = useState<RoleFields>(init)
  const set = <K extends keyof RoleFields>(k: K, v: RoleFields[K]) => setF(x => ({ ...x, [k]: v }))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [refs, setRefs] = useState<RoleRef[]>([])
  const [conflict, setConflict] = useState<{ fields: (keyof RoleFields)[]; current: AgentRole } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (k: string) => err?.field === k ? err.message : undefined
  const cp = role?.control_plane ?? false
  // Модель Тимлида — модель планировщика.
  const lead = role?.id === 'lead'
  const idErr = !role && id
    ? (!/^[a-z][a-z0-9-]{1,31}$/.test(id) ? 'латиница в нижнем регистре, цифры, дефис; 2–32 символа'
      : taken.includes(id) ? 'шаблон с таким идентификатором уже есть' : fe('id'))
    : fe('id')
  // Модели шаблона — пары подключения и модели агента Rivet; у Тимлида —
  // модели планировщика из тех же подключений.
  const pairs = Array.from(new Set(choices.filter(c => cp || !f.agent || c.agent === f.agent).map(c => `${c.connection_id}/${c.model}`))).sort()

  const save = async (force = false) => {
    setErr(null); setRefs([]); setBusy(true)
    try {
      if (!role) {
        const [conn, ...rest] = f.model ? f.model.split('/') : ['']
        await api.createRole({
          id, title: f.title.trim(), description: f.description.trim(), instruction: f.instruction, color: f.color,
          capability: f.capability, agent: f.agent, enabled: f.enabled,
          ...(f.model ? { connection_id: conn, model: rest.join('/') } : {}),
        })
      } else {
        const draft = { ...f, title: f.title.trim(), description: f.description.trim() }
        const res = await saveRole(role, draft, force, force ? conflict?.current : undefined)
        if ('conflicts' in res) { setConflict({ fields: res.conflicts, current: res.current }); return }
      }
      onSaved(); onClose()
    } catch (e) {
      setErr({ field: apiField(e), message: errText(e) })
      setRefs(apiRefs(e))
    } finally { setBusy(false) }
  }
  const canSave = !!id && !!f.title.trim() && !!f.instruction.trim() && !idErr && !busy
  return (
    <SideModal titleId="role-modal-title" onClose={onClose}
      title={role ? <>Шаблон <span className="mono">{role.id}</span></> : 'Новый шаблон роли'}>
      {err && !err.field && <FormNote err={err.message} />}
      {refs.length > 0 && <div className="budget-pause">Шаблон используется: {refs.map(refText).join('; ')}</div>}
      {conflict && (
        <div className="budget-pause" data-role-conflict>
          Эти поля другой администратор уже изменил по-своему: {conflict.fields.map(k => FIELD_LABEL[k]).join(', ')}.
          «Сохранить поверх» запишет ваши значения, остальные поля останутся актуальными.
        </div>
      )}
      <div className="f-grid">
        <Field label="Идентификатор" error={idErr} hint="на него ссылаются участники процесса и агенты">
          {ids => <TextInput ids={ids} mono placeholder="security" value={id} disabled={!!role} autoFocus={!role} onChange={e => setId(e.target.value)} />}
        </Field>
        <Field label="Название" error={fe('title')}>
          {ids => <TextInput ids={ids} placeholder="Безопасник" value={f.title} autoFocus={!!role} maxLength={40} onChange={e => set('title', e.target.value)} />}
        </Field>
      </div>
      <Field label="Зона ответственности" error={fe('description')} hint="видна в консоли рядом с ролью">
        {ids => <TextArea ids={ids} rows={2} maxLength={500} placeholder="Ищет уязвимости в изменениях задачи" value={f.description} onChange={e => set('description', e.target.value)} />}
      </Field>
      <Field label="Инструкция агенту" error={fe('instruction')} hint="уходит агенту перед заданием стадии; маркеры вердикта и политика проекта добавляются системой">
        {ids => <TextArea ids={ids} rows={8} maxLength={8000} value={f.instruction} onChange={e => set('instruction', e.target.value)} />}
      </Field>
      <div className="f-grid">
        <Field label="Цвет" error={fe('color')}>
          {ids => <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="role-swatch" style={{ ['--rc' as string]: roleColorVar(f.color) }} />
            <Select ids={ids} value={f.color} onChange={e => set('color', e.target.value)}>
              {ROLE_COLORS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </div>}
        </Field>
        <Field label="Capability" error={fe('capability')} hint={cp ? 'шаблон выполняет control plane, runner не нужен' : 'runner для роли нужен с этой capability'}>
          {ids => <Select ids={ids} value={cp ? '' : f.capability} disabled={cp} onChange={e => set('capability', e.target.value)}>
            {cp && <option value="">нет</option>}
            {ROLE_CAPABILITIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>}
        </Field>
      </div>
      <div className="f-grid">
        <Field label={lead ? 'Модель планировщика' : 'Модель по умолчанию'} optional error={fe('model') ?? fe('connection_id') ?? fe('agent')}
          hint={lead ? 'меняется, только если выбрать другую' : cp ? 'подключение / модель' : 'подключение / модель агента Rivet'}>
          {ids => <Select ids={ids} value={f.model} onChange={e => set('model', e.target.value)}>
            {/* У Тимлида пустой выбор ничего не меняет: он есть, только
                пока планировщик и правда работает на модели из окружения. */}
            {(!lead || !fieldsOf(role!).model) && <option value="">{lead ? 'из окружения' : 'по умолчанию агента'}</option>}
            {f.model && !pairs.includes(f.model) && <option value={f.model}>{f.model}</option>}
            {pairs.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>}
        </Field>
      </div>
      <Checkbox checked={f.enabled} onChange={v => set('enabled', v)} label="включён" />
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        В консоли: <RoleChip role={{ ...(role ?? {}), id: id || 'role', title: f.title || 'Роль', color: f.color, description: f.description } as AgentRole} name="Имя" small />
      </div>
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        {conflict
          ? <Button variant="danger" busy={busy} disabled={!canSave} onClick={() => save(true)}>Сохранить поверх</Button>
          : <Button variant="primary" busy={busy} disabled={!canSave} onClick={() => save()}>{role ? 'Сохранить' : 'Создать'}</Button>}
      </FormActions>
    </SideModal>
  )
}
