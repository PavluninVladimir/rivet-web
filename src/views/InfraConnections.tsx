import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, apiField, errCode, type InfraConnection, type InfraConnectionInput } from '../api/client'
import { fmtDate } from '../components/ui'
import { SideModal } from '../components/StepModal'
import { Button, Field, FormActions, FormNote, PasswordInput, TextInput, errText, useBusy } from '../components/form'
import { INFRA_PROVIDER_LABEL, INFRA_STATE_LABEL, fmtMoney, inUseText, infraErrorText, infraRefs, infraStateColor, tokenPrefixText } from '../components/hostLogic'

// Раздел «Инфраструктура» вкладки «Подключения» (add-environment-provisioning,
// спека web «Подключения инфраструктуры в консоли»): подключения к
// провайдерам, у которых Rivet получает хосты окружений. Токен вводит
// администратор из сессии консоли, наружу он виден только префиксом.

// Текст отказа API: понятные подсказки по коду, ссылки окружений у in_use.
function failText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'in_use') return inUseText(e.message, infraRefs(e.data))
  return infraErrorText(errCode(e), errText(e))
}

// Итог проверки для заметки раздела: состояние, причина, баланс.
function checkNote(c: InfraConnection, verb: string): { ok?: string; err?: string } {
  const state = INFRA_STATE_LABEL[c.state] ?? c.state
  if (c.state === 'ok') return { ok: `подключение ${c.id} ${verb}: ${state}${c.balance ? ` · баланс ${fmtMoney(c.balance)}` : ''}` }
  return { err: `подключение ${c.id} ${verb}: ${state}${c.check_detail ? ` · ${c.check_detail}` : ''}` }
}

type Modal = { kind: 'new' } | { kind: 'edit'; id: string } | null

export function InfraConnections() {
  const [list, setList] = useState<InfraConnection[]>([])
  // absent: бэкенд без провайдеров инфраструктуры (404): раздела нет.
  const [status, setStatus] = useState<'loading' | 'ok' | 'absent'>('loading')
  const [loadErr, setLoadErr] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok?: string; err?: string } | null>(null)
  const [busy, run] = useBusy()
  const refresh = useCallback(() => {
    api.infraConnections()
      .then(l => { setList(l ?? []); setStatus('ok'); setLoadErr('') })
      .catch(e => {
        if (e instanceof ApiError && e.status === 404) setStatus('absent')
        else setLoadErr(`подключения инфраструктуры не загрузились: ${errText(e)}`)
      })
  }, [])
  useEffect(refresh, [refresh])

  const act = (fn: () => Promise<{ ok?: string; err?: string } | void>) => () => run(async () => {
    setNote(null)
    try { const r = await fn(); if (r) setNote(r) } catch (e) { setNote({ err: failText(e) }) } finally { refresh() }
  })
  if (status === 'absent') return null
  const current = modal?.kind === 'edit' ? list.find(c => c.id === modal.id) : undefined

  return (
    <div className="dw-sec" data-infra-section>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Инфраструктура</h3>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="primary" disabled={status !== 'ok'} onClick={() => { setNote(null); setModal({ kind: 'new' }) }}>Подключить RUVDS</Button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Провайдеры, у которых Rivet получает хосты для окружений проектов. Сервер создаётся только после того, как владелец проекта подтвердит цену.
      </div>
      {loadErr && <div style={{ marginBottom: 8 }}><FormNote err={loadErr} /></div>}
      {note && (note.ok || note.err) && <div style={{ marginBottom: 8 }} data-infra-note><FormNote ok={note.ok} err={note.err} /></div>}
      {status === 'ok' && list.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Подключений к провайдерам нет.</div>}
      <div className="conn-list">
        {list.map(c => (
          <div key={c.id} className={'conn-card infra-card' + (c.enabled ? '' : ' off')} data-infra-connection={c.id} data-state={c.state}>
            <div className="head">
              <b>{c.name}</b><span className="mono muted">{c.id}</span>
              <span className="chip"><span className="n">{INFRA_PROVIDER_LABEL[c.provider] ?? c.provider}</span></span>
              {!c.enabled && <span className="chip"><span className="n">выключено</span></span>}
            </div>
            <div className="meta">
              <span>токен <span className="mono infra-token">{tokenPrefixText(c)}</span></span>
              <span className="infra-state">состояние <span style={{ color: infraStateColor(c.state) }}>{INFRA_STATE_LABEL[c.state] ?? c.state}</span>
                {c.check_detail && <> · {c.check_detail}</>}{c.checked_at && <> · {fmtDate(c.checked_at)}</>}</span>
              <span>баланс <span className="mono infra-balance">{c.balance ? fmtMoney(c.balance) : 'неизвестен'}</span></span>
              {c.updated_by && <span>изменил {c.updated_by}</span>}
            </div>
            <div className="actions">
              <Button size="sm" busy={busy} onClick={act(async () => checkNote((await api.checkInfraConnection(c.id)).connection, 'проверено'))}>Проверить</Button>
              <Button size="sm" onClick={() => { setNote(null); setModal({ kind: 'edit', id: c.id }) }}>Заменить токен</Button>
              <Button size="sm" variant="quiet" busy={busy} onClick={act(async () => {
                await api.putInfraConnection(c.id, { provider: c.provider, name: c.name, enabled: !c.enabled })
                return { ok: c.enabled ? `подключение ${c.id} выключено` : `подключение ${c.id} включено` }
              })}>{c.enabled ? 'Выключить' : 'Включить'}</Button>
              {confirmDel === c.id
                ? <Button size="sm" variant="danger" busy={busy} onClick={act(async () => {
                    setConfirmDel(null)
                    await api.deleteInfraConnection(c.id)
                    return { ok: `подключение ${c.id} удалено` }
                  })}>Удалить?</Button>
                : <Button size="sm" variant="danger" onClick={() => setConfirmDel(c.id)}>Удалить</Button>}
            </div>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        Токен хранится зашифрованным и повторно не показывается. При сохранении подключение проверяется запросом баланса. Адрес API провайдера задаёт конфигурация установки.
      </div>

      {modal?.kind === 'new' && <InfraModal taken={list.map(c => c.id)} onClose={() => setModal(null)} onSaved={r => { setNote(r); refresh() }} />}
      {modal?.kind === 'edit' && current && <InfraModal conn={current} onClose={() => setModal(null)} onSaved={r => { setNote(r); refresh() }} />}
    </div>
  )
}

// Поля окна, у которых ошибка показывается под полем; остальные (provider)
//: общей заметкой окна.
const INFRA_FIELDS = ['id', 'name', 'token']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

// Окно подключения RUVDS: новое (идентификатор, название, токен) или
// замена токена и названия существующего.
function InfraModal({ conn, taken = [], onClose, onSaved }: {
  conn?: InfraConnection; taken?: string[]; onClose: () => void; onSaved: (r: { ok?: string; err?: string }) => void
}) {
  const [id, setId] = useState(conn?.id ?? (taken.includes('ruvds') ? '' : 'ruvds'))
  const [name, setName] = useState(conn?.name ?? 'RUVDS')
  const [token, setToken] = useState('')
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => err?.field === f ? err.message : undefined
  const idErr = !conn && id && !ID_RE.test(id) ? 'латиница, цифры, дефис'
    : !conn && taken.includes(id) ? 'подключение с таким идентификатором уже есть' : fe('id')
  const canSave = !!id && !!name.trim() && (!!conn || !!token.trim()) && !idErr && !busy

  const save = async () => {
    setErr(null); setBusy(true)
    try {
      const input: InfraConnectionInput = { provider: conn?.provider ?? 'ruvds', name: name.trim(), enabled: conn?.enabled ?? true }
      if (token.trim()) input.token = token.trim()
      const r = await api.putInfraConnection(id, input)
      onSaved(checkNote(r.connection, conn ? 'сохранено' : 'создано'))
      onClose()
    } catch (e) {
      const field = apiField(e)
      setErr({ field, message: failText(e) })
    } finally { setBusy(false) }
  }
  return (
    <SideModal titleId="infra-modal-title" onClose={onClose} title={conn ? <>Подключение <span className="mono">{conn.id}</span></> : 'Подключение RUVDS'}>
      {err && !(err.field && INFRA_FIELDS.includes(err.field)) && <FormNote err={err.message} />}
      <div className="f-grid">
        <Field label="Идентификатор" error={idErr} hint="латиница, цифры, дефис; не меняется">
          {ids => <TextInput ids={ids} name="infra.id" mono placeholder="ruvds" value={id} disabled={!!conn} autoFocus={!conn} onChange={e => setId(e.target.value)} />}
        </Field>
        <Field label="Название" error={fe('name')}>
          {ids => <TextInput ids={ids} name="infra.name" placeholder="RUVDS" value={name} onChange={e => setName(e.target.value)} />}
        </Field>
      </div>
      <Field label={conn?.has_token ? 'Новый токен' : 'Токен'} optional={!!conn?.has_token} error={fe('token')}
        hint={conn?.has_token ? `сохранён токен ${tokenPrefixText(conn)}; пусто: оставить прежний` : 'токен API из панели RUVDS: права read, write и remove'}>
        {ids => <PasswordInput ids={ids} name="infra.token" placeholder="Токен RUVDS" autoComplete="off" value={token} autoFocus={!!conn}
          onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canSave) void save() }} />}
      </Field>
      <FormActions>
        <Button variant="quiet" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} busyLabel="проверка…" disabled={!canSave} onClick={save}>{conn ? 'Сохранить' : 'Создать и проверить'}</Button>
      </FormActions>
    </SideModal>
  )
}
