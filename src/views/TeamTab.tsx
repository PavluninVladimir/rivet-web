import { useCallback, useEffect, useState } from 'react'
import { api, apiField, type AgentRole, type ModelChoice, type TeamAgent } from '../api/client'
import { SideModal } from '../components/StepModal'
import { RoleChip } from '../components/RoleChip'
import { AGENT_FIELD_LABEL, agentFields, leadTriple, modelOptions, saveAgent, type AgentFields } from '../components/TeamPanel'
import { agentModelLabel, stepVerb, tripleKey, tripleOf } from '../components/roleLabels'
import { Button, Checkbox, Field, FormActions, FormNote, Select, TextArea, TextInput, errText } from '../components/form'
import { useStore } from '../store'
import { useActions } from './AppManagement'

// Вкладка «Команда» (add-agent-roles, спека web «Команда и шаблоны ролей в
// разделе управления»): агенты с именами, собранные из шаблонов ролей.
// Агента создают из шаблона, переименовывают, меняют модель, дописывают
// инструкцию, отключают и удаляют. Runner'ы — инфраструктура, они на
// странице Runner'ов.

// Идентификатор по имени: латиница для имён на кириллице.
const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}
function idFromName(name: string): string {
  return name.toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

export function TeamTab() {
  const { team, roles, roleOf, refreshTeam } = useStore()
  // Модель планировщика — модель шаблона lead (connection_id/model).
  const leadRole = roleOf('lead')
  const planner = leadRole?.model ? tripleKey({ agent: '', connection_id: leadRole.connection_id, model: leadRole.model }) : ''
  const [choices, setChoices] = useState<ModelChoice[]>([])
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; agent: TeamAgent } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const refresh = useCallback(() => {
    api.modelChoices().then(r => setChoices(r?.choices ?? [])).catch(() => {})
    refreshTeam()
  }, [refreshTeam])
  useEffect(refresh, [refresh])
  const { act, banner, busy } = useActions(refresh)

  const toggle = (a: TeamAgent) => act(async () => {
    const res = await saveAgent(a, { ...agentFields(a), enabled: !a.enabled })
    if ('conflicts' in res) throw new Error('агента только что изменил другой администратор: проверьте карточку и повторите')
  }, a.enabled ? 'агент отключён' : 'агент включён')

  return (
    <>
      {banner}
      <div className="dw-sec">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Команда агентов</h3>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" disabled={roles.filter(r => r.enabled).length === 0} onClick={() => setModal({ kind: 'new' })}>Новый агент</Button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Агент — участник команды с именем, ролью из шаблона и моделью. Параллельно работают столько агентов роли,
          сколько их в команде. Runner’ы, на которых идут сессии, — инфраструктура на странице Runner’ов.
        </div>
        {team.length === 0 && <div className="muted">Команда пуста или недоступна.</div>}
        <div className="conn-list">
          {team.map(a => {
            const role = roleOf(a.role_id)
            return (
              <div key={a.id} className={'conn-card' + (a.enabled ? '' : ' off')} data-team-card={a.id}>
                <div className="head">
                  <b>{a.name}</b><span className="mono muted">{a.id}</span>
                  <RoleChip role={role} roleId={a.role_id} title={a.role_title} small />
                  {!a.enabled && <span className="chip"><span className="n">отключён</span></span>}
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {!a.enabled ? '' : a.busy
                      ? <>{a.task_num ? `task-${a.task_num} · ` : ''}{stepVerb(a.step, a.step_entry)}{a.runner_name || a.runner_id ? ` · на ${a.runner_name || a.runner_id}` : ''}</>
                      : 'свободен'}
                  </span>
                </div>
                <div className="meta">
                  <span>модель <span className="mono">{a.role_id === 'lead' ? (a.model ? `${a.connection_id}/${a.model}` : 'из окружения')
                    : role?.control_plane && a.model ? `${a.connection_id}/${a.model}` : agentModelLabel(a, role)}</span></span>
                  {a.instruction_extra && <span>есть дополнение инструкции</span>}
                  <span>изменил {a.updated_by || '—'}</span>
                </div>
                <div className="actions">
                  <Button size="sm" onClick={() => setModal({ kind: 'edit', agent: a })}>Изменить</Button>
                  <Button size="sm" variant="quiet" busy={busy} onClick={toggle(a)}>{a.enabled ? 'Отключить' : 'Включить'}</Button>
                  {confirmDel === a.id
                    ? <Button size="sm" variant="danger" busy={busy} title={a.busy ? 'сессия агента доведётся до конца без него' : undefined}
                        onClick={act(async () => { setConfirmDel(null); await api.deleteTeamAgent(a.id) }, 'агент удалён')}>Удалить?</Button>
                    : <Button size="sm" variant="danger" onClick={() => setConfirmDel(a.id)}>Удалить</Button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {modal?.kind === 'new' && <AgentModal roles={roles} choices={choices} taken={team.map(a => a.id)} planner={planner} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === 'edit' && <AgentModal agent={modal.agent} roles={roles} choices={choices} taken={[]} planner={planner} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  )
}

function AgentModal({ agent, roles, choices, taken, planner, onClose, onSaved }: {
  agent?: TeamAgent; roles: AgentRole[]; choices: ModelChoice[]; taken: string[]; planner: string; onClose: () => void; onSaved: () => void
}) {
  const usable = roles.filter(r => r.enabled || r.id === agent?.role_id)
  const [id, setId] = useState(agent?.id ?? '')
  const [idTouched, setIdTouched] = useState(false)
  const [f, setF] = useState<AgentFields>(agent ? agentFields(agent)
    : { name: '', role_id: (usable.find(r => r.id === 'developer' && r.enabled) ?? usable.find(r => !r.control_plane && r.enabled) ?? usable[0])?.id ?? '',
        model: '', instruction_extra: '', enabled: true })
  const set = <K extends keyof AgentFields>(k: K, v: AgentFields[K]) => setF(x => ({ ...x, [k]: v }))
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [conflict, setConflict] = useState<{ fields: (keyof AgentFields)[]; current: TeamAgent } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (k: string) => err?.field === k ? err.message : undefined
  const role = roles.find(r => r.id === f.role_id)
  // Модель Тимлида — модель планировщика; шаблоны control plane — без профиля.
  const lead = f.role_id === 'lead'
  const opts = modelOptions(choices, !!role?.control_plane || lead)
  const curOpt = opts.find(o => o.key === f.model)
  const idErr = !agent && id
    ? (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ? 'латиница в нижнем регистре, цифры, дефис'
      : taken.includes(id) ? 'агент с таким идентификатором уже есть' : fe('id'))
    : fe('id')

  const save = async (force = false) => {
    setErr(null); setBusy(true)
    const draft = { ...f, name: f.name.trim() }
    try {
      if (!agent) {
        // Новый тимлид: пара модели уходит, только если выбрана не модель планировщика.
        const triple = draft.role_id === 'lead' ? leadTriple(draft.model, [planner]) : tripleOf(draft.model)
        await api.createTeamAgent({ id, name: draft.name, role_id: draft.role_id, instruction_extra: draft.instruction_extra, enabled: draft.enabled, ...triple })
      } else {
        const res = await saveAgent(agent, draft, { force, current: force ? conflict?.current : undefined, planner })
        if ('conflicts' in res) { setConflict({ fields: res.conflicts, current: res.current }); return }
      }
      onSaved(); onClose()
    } catch (e) { setErr({ field: apiField(e), message: errText(e) }) } finally { setBusy(false) }
  }
  const canSave = !!id && !!f.name.trim() && !!f.role_id && !idErr && !busy
  return (
    <SideModal titleId="agent-team-modal-title" onClose={onClose}
      title={agent ? <>Агент <span className="mono">{agent.id}</span></> : 'Новый агент команды'}>
      {err && !err.field && <FormNote err={err.message} />}
      {conflict && (
        <div className="budget-pause" data-agent-conflict>
          Эти поля другой администратор уже изменил по-своему: {conflict.fields.map(k => AGENT_FIELD_LABEL[k]).join(', ')}.
          «Сохранить поверх» запишет ваши значения, остальные поля останутся актуальными.
        </div>
      )}
      <div className="f-grid">
        <Field label="Имя" error={fe('name')} hint="как агент подписан в консоли">
          {ids => <TextInput ids={ids} placeholder="Ян" value={f.name} maxLength={40} autoFocus
            onChange={e => { set('name', e.target.value); if (!agent && !idTouched) setId(idFromName(e.target.value)) }} />}
        </Field>
        <Field label="Идентификатор" error={idErr} hint={agent ? undefined : 'латиница; по умолчанию из имени'}>
          {ids => <TextInput ids={ids} mono placeholder="yan" value={id} disabled={!!agent}
            onChange={e => { setId(e.target.value); setIdTouched(true) }} />}
        </Field>
      </div>
      <div className="f-grid">
        <Field label="Шаблон роли" error={fe('role_id')}>
          {ids => <Select ids={ids} value={f.role_id} onChange={e => {
            set('role_id', e.target.value)
            // У Тимлида модель — модель планировщика: подставляется текущая.
            set('model', e.target.value === 'lead' ? (agent?.role_id === 'lead' ? agentFields(agent).model : planner) : '')
          }}>
            {usable.map(r => <option key={r.id} value={r.id}>{r.title}{r.enabled ? '' : ' (отключён)'}</option>)}
          </Select>}
        </Field>
        <Field label={lead ? 'Модель планировщика' : 'Модель'} optional error={fe('model') ?? fe('connection_id') ?? fe('agent')}
          hint={lead ? 'общая с планировщиком; меняется, только если выбрать другую' : 'профиль / подключение / модель'}>
          {ids => <Select ids={ids} value={f.model} onChange={e => set('model', e.target.value)}>
            {!lead && <option value="">{role?.model ? `как в шаблоне (${role.model})` : 'как в шаблоне'}</option>}
            {lead && !f.model && <option value="">из окружения</option>}
            {f.model && !curOpt && <option value={f.model}>{tripleOf(f.model).model}</option>}
            {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>}
        </Field>
      </div>
      {curOpt?.offline && <div className="model-warn" role="status">нет online runner’а с профилем {tripleOf(f.model).agent}: задачи этого агента будут ждать</div>}
      {role?.instruction && (
        <Field label="Инструкция шаблона" hint="приходит агенту первой; меняется во вкладке «Шаблоны ролей»">
          {() => <div className="tmpl-instr">{role.instruction}</div>}
        </Field>
      )}
      <Field label="Дополнение инструкции" optional error={fe('instruction_extra')} hint="дописывается после инструкции шаблона только этому агенту">
        {ids => <TextArea ids={ids} rows={4} maxLength={4000} placeholder="Например: пиши комментарии по-русски" value={f.instruction_extra} onChange={e => set('instruction_extra', e.target.value)} />}
      </Field>
      <Checkbox checked={f.enabled} onChange={v => set('enabled', v)} label="включён" />
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        {conflict
          ? <Button variant="danger" busy={busy} disabled={!canSave} onClick={() => save(true)}>Сохранить поверх</Button>
          : <Button variant="primary" busy={busy} disabled={!canSave} onClick={() => save()}>{agent ? 'Сохранить' : 'Создать'}</Button>}
      </FormActions>
    </SideModal>
  )
}
