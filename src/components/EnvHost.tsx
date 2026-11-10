import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { api, errCode, type EnvConfig, type Environment, type HostAction, type InfraCatalog, type InfraConnection, type ProvisionConfig } from '../api/client'
import { Button, Checkbox, Field, FormNote, NumberInput, Select, TextArea, errText } from './form'
import {
  INFRA_PROVIDER_LABEL, activeOS, balanceShort, dcDriveTariffs, dcTariffs, fillFromCatalog, fmtDay, fmtMoney,
  fmtPeriodMoney, hostActions, hostErrorText, hostSource, hostStateColor, hostStateLabel, localVerifyUrl,
  nextVerifyUrl, normCatalog, paidProvider, paidSoon, provisionForSource, specLines, withDatacenter,
} from './hostLogic'

// Хост окружения от провайдера инфраструктуры (add-environment-provisioning,
// спека web «Хост окружения в консоли»): блок хоста на карточке окружения с
// решениями владельца и поля привязки в форме окружения.

// Справочник подключения: грузится один раз на подключение. Он нужен форме
// и подписям конфигурации в решении; доступен администратору установки.
function useCatalog(connection: string | undefined, enabled: boolean) {
  const [cat, setCat] = useState<{ conn: string; data?: InfraCatalog; err?: string } | null>(null)
  useEffect(() => {
    if (!enabled || !connection) return
    let live = true
    api.infraCatalog(connection)
      .then(c => { if (live) setCat({ conn: connection, data: normCatalog(c) }) })
      .catch(e => { if (live) setCat({ conn: connection, err: errText(e) }) })
    return () => { live = false }
  }, [connection, enabled])
  return cat && cat.conn === connection ? cat : null
}

// ─── блок хоста на карточке окружения ───────────────────────────────────

export function HostBlock({ env, isOwner, isAdmin, onChanged }: {
  env: Environment; isOwner: boolean; isAdmin: boolean; onChanged: () => void
}) {
  const host = env.host ?? null
  const bound = !!env.config.provision
  const [busy, setBusy] = useState<HostAction | null>(null)
  const [err, setErr] = useState('')
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const provider = host?.provider ?? env.config.provision?.provider ?? ''
  const paid = paidProvider(provider)
  // Названия дата-центра, тарифа и ОС для решения о создании: из снимка
  // хоста (spec_labels), а если его нет, администратору: из справочника.
  const decision = host?.state === 'awaiting_approval'
  const needCatalog = decision && paid && !(host?.spec_labels && Object.keys(host.spec_labels).length > 0)
  const cat = useCatalog(host?.spec?.connection, isAdmin && needCatalog)
  if (!host && !bound) return null

  const actions = hostActions(host, { owner: isOwner, bound })
  const has = (a: HostAction) => actions.includes(a)
  const run = (a: HostAction, body?: { amount?: number; remove_volumes?: boolean }) => async () => {
    if (busy) return
    setErr(''); setBusy(a)
    try {
      await api.hostAction(env.id, a, body)
      if (a === 'delete') setRemoveVolumes(false)
    } catch (e) {
      setErr(hostErrorText(errCode(e), errText(e)))
    } finally {
      setBusy(null)
      // Ответ или отказ (цена изменилась, состояние сменилось): карточка
      // перечитывает окружения, не дожидаясь события.
      onChanged()
    }
  }
  const btn = (a: HostAction, label: string, variant: 'primary' | 'default' | 'quiet' | 'danger' = 'default', body?: { amount?: number; remove_volumes?: boolean }) => (
    <Button size="sm" variant={variant} busy={busy === a} disabled={!!busy && busy !== a} onClick={run(a, body)}>{label}</Button>
  )

  const state = host?.state ?? 'none'
  const failed = state === 'failed' || !!host?.needs_retry
  return (
    <div className="env-host" data-host-state={state} data-host-provider={provider}>
      <div className="env-host-row">
        <span className="env-host-dot" style={{ background: host ? hostStateColor(host.state) : 'var(--muted)' }} aria-hidden="true" />
        <span className="env-host-label muted">хост</span>
        <span className="env-host-state" style={{ color: host ? hostStateColor(host.state) : undefined }}>
          {host ? hostStateLabel(host) : 'хоста нет'}
        </span>
        <span className="mono muted">{INFRA_PROVIDER_LABEL[provider] ?? provider}</span>
        {host?.address && <span className="env-host-address mono">{host.address}</span>}
      </div>

      {host && paid && (host.cost || host.paid_till) && (
        <div className="env-host-meta">
          {host.cost && <span className="env-host-cost">продление <span className="mono">{fmtPeriodMoney(host.cost)}</span></span>}
          {host.paid_till && <PaidTill iso={host.paid_till} />}
        </div>
      )}
      {host && !paid && (host.compose_project || host.port > 0) && (
        <div className="env-host-meta">
          {host.compose_project && <span>compose-проект <span className="mono env-host-compose">{host.compose_project}</span></span>}
          {host.port > 0 && <span>порт <span className="mono env-host-port">{host.port}</span></span>}
        </div>
      )}
      {host && paid && host.approved_by && (state === 'approved' || state === 'creating' || state === 'bootstrapping') && (
        <div className="env-host-meta"><span>создание подтвердил {host.approved_by}</span></div>
      )}
      {host?.detail && <div className={'env-host-detail' + (failed ? ' fail' : '')}>{host.detail}</div>}

      {host && state === 'awaiting_approval' && (
        <div className="env-host-decision" data-decision="create">
          <div className="env-host-decision-head">Создать сервер {INFRA_PROVIDER_LABEL[provider] ?? provider} для окружения {env.name}?</div>
          <dl className="env-host-spec">
            {specLines(host.spec ?? { provider }, cat?.data ?? null, host.quote, host.spec_labels).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          <div className="env-host-price">
            цена <b className="env-host-quote">{host.quote ? fmtPeriodMoney(host.quote) : 'ещё не посчитана'}</b>
            {' · '}баланс <b className="env-host-balance">{fmtMoney(host.balance)}</b>
          </div>
          {balanceShort(host.quote, host.balance) && (
            <div className="env-host-warn">На балансе меньше цены: после подтверждения создание остановится. Пополните баланс у провайдера.</div>
          )}
          {isOwner
            ? <div className="env-host-actions">
                {has('approve') && btn('approve', 'Подтвердить', 'primary', { amount: host.quote?.amount })}
                {has('reject') && btn('reject', 'Отклонить')}
              </div>
            : <div className="muted">Решение принимает владелец проекта.</div>}
        </div>
      )}

      {host && state === 'delete_requested' && (
        <div className="env-host-decision danger" data-decision="delete">
          <div className="env-host-decision-head">
            {paid
              ? `Удалить сервер ${INFRA_PROVIDER_LABEL[provider] ?? provider}${host.server_id ? ` ${host.server_id}` : ''}${host.address ? ` (${host.address})` : ''}?`
              : `Удалить локальное окружение${host.compose_project ? ` ${host.compose_project}` : ''} вместе с томами?`}
          </div>
          <div className="env-host-warn">
            Удаление необратимо: {paid ? 'сервер и данные на нём пропадут.' : 'тома с данными compose-проекта пропадут.'}
          </div>
          {paid && host.paid_till && <div>Оплачено до {fmtDay(host.paid_till)}.</div>}
          {host.delete_requested_by && <div className="muted">Удаление запросил {host.delete_requested_by}.</div>}
          {isOwner
            ? <div className="env-host-actions">
                {has('confirm-delete') && btn('confirm-delete', 'Подтвердить удаление', 'danger')}
                {has('cancel-delete') && btn('cancel-delete', 'Отменить', 'quiet')}
              </div>
            : <div className="muted">Решение принимает владелец проекта.</div>}
        </div>
      )}

      {(has('retry') || has('delete') || has('request') || has('refresh')) && (
        <div className="env-host-actions">
          {has('retry') && btn('retry', 'Повторить', 'primary')}
          {has('refresh') && btn('refresh', 'Обновить')}
          {has('request') && btn('request', host ? 'Запросить снова' : 'Запросить хост')}
          {has('delete') && !paid && (
            <Checkbox checked={removeVolumes} disabled={!!busy} onChange={setRemoveVolumes} label="удалить тома с данными" />
          )}
          {has('delete') && btn('delete', 'Удалить хост', 'danger', { remove_volumes: !paid && removeVolumes })}
        </div>
      )}
      {err && <FormNote err={err} />}
    </div>
  )
}

function PaidTill({ iso }: { iso: string }) {
  const soon = paidSoon(iso)
  return (
    <span className={'env-host-paid' + (soon ? ' soon' : '')} data-soon={soon ? 'true' : undefined}
      title={soon ? 'до конца оплаты меньше трёх суток: продлите сервер в панели провайдера' : undefined}>
      оплачено до <span className="mono">{fmtDay(iso)}</span>{soon && ' · скоро конец оплаты'}
    </span>
  )
}

// ─── поля привязки в форме окружения ────────────────────────────────────

// Поля Linux-хоста: откуда хост и параметры выбранного провайдера. Пока у
// окружения живой хост, привязку менять нельзя (сервер ответит 409),
// команды доставки и проверки остаются доступны.
export function ProvisionFields({ env, cfg, setCfg, connections, error }: {
  env: Environment | null
  cfg: EnvConfig
  setCfg: Dispatch<SetStateAction<EnvConfig>>
  connections: InfraConnection[]
  error: (field: string) => string | undefined
}) {
  const p = cfg.provision
  const src = hostSource(p)
  const locked = !!env?.host?.live
  const lockHint = locked ? 'У окружения есть хост: чтобы сменить привязку, сначала удалите хост.' : undefined
  const hostPort = env?.host?.port ?? 0
  const ruvds = p && p.provider !== 'local' ? p : undefined
  const cat = useCatalog(ruvds?.connection, !!ruvds)

  // Справочник пришёл: пустые поля заполняются первыми значениями.
  useEffect(() => {
    if (locked || !cat?.data) return
    const data = cat.data
    setCfg(c => c.provision && c.provision.provider !== 'local' && c.provision.connection === cat.conn
      ? { ...c, provision: fillFromCatalog(data, c.provision) } : c)
  }, [cat, locked, setCfg])

  const setProv = (patch: Partial<ProvisionConfig>) => setCfg(c => c.provision ? { ...c, provision: { ...c.provision, ...patch } } : c)
  const effPort = (port: number | undefined) => port || hostPort

  const onSource = (next: string) => setCfg(c => {
    const prov = provisionForSource(next, c.provision)
    // Локальный хост: Verify по умолчанию проверяет адрес на машине runner'а.
    const verify = prov?.provider === 'local' ? nextVerifyUrl(c.verify_url, 0, effPort(prov.port)) : c.verify_url
    return { ...c, provision: prov, verify_url: verify }
  })
  const onPort = (port: number) => setCfg(c => c.provision
    ? { ...c, provision: { ...c.provision, port }, verify_url: nextVerifyUrl(c.verify_url, effPort(c.provision.port), effPort(port)) }
    : c)

  // Подключения провайдеров: включённые плюс текущее (выключенное или
  // удалённое значение формы не теряет).
  const options = connections.filter(c => c.provider === 'ruvds' && (c.enabled || `${c.provider}:${c.id}` === src))
  const currentMissing = !!ruvds && !options.some(c => `${c.provider}:${c.id}` === src)
  const num = (v: string) => v === '' ? undefined : Number(v)

  return (
    <>
      <Field label="Хост" hint={lockHint ?? (src === 'address' ? undefined : sourceHint(src))}
        error={error('config.provision') ?? error('config.provision.provider') ?? error('config.provision.connection')}>
        {ids => <Select ids={ids} name="host_source" value={src} disabled={locked} onChange={e => onSource(e.target.value)}>
          <option value="address">Свой адрес</option>
          <option value="local">Локально на машине runner'а</option>
          {options.map(c => (
            <option key={c.id} value={`${c.provider}:${c.id}`}>
              RUVDS: {c.name} ({c.id}){!c.enabled ? ' · выключено' : c.state === 'invalid' ? ' · токен отклонён' : ''}
            </option>
          ))}
          {currentMissing && <option value={src}>RUVDS: {ruvds?.connection} · подключения нет</option>}
        </Select>}
      </Field>
      {src === 'address' && connections.length === 0 && (
        <div className="provision-note">Хост может создавать Rivet: подключение RUVDS добавляет администратор на вкладке «Подключения» раздела управления.</div>
      )}

      {p?.provider === 'local' && (
        <fieldset className="f-group provision-fields" data-provision="local">
          <legend>Локальный хост</legend>
          <Field label="Порт хоста" hint={locked ? lockHint : '0: назначит Rivet из диапазона 20000–29999'} error={error('config.provision.port')}>
            {ids => <NumberInput ids={ids} name="provision.port" min={0} max={65535} width={110} disabled={locked}
              value={p.port ?? 0} onChange={e => onPort(Number(e.target.value) || 0)} />}
          </Field>
          <div className="provision-note">
            Команды доставки выполняются на машине deploy-runner'а в рабочей копии репозитория. Rivet передаёт им
            {' '}<code>COMPOSE_PROJECT_NAME</code> (имя compose-проекта окружения) и <code>RIVET_HOST_PORT</code> (порт хоста):
            {' '}опубликуйте сервис в compose-файле на <code>{'${RIVET_HOST_PORT}'}</code>. Verify по умолчанию
            {' '}<code>{effPort(p.port) > 0 ? localVerifyUrl(effPort(p.port)) : 'http://127.0.0.1:<порт>/'}</code>. Чтобы публикация попала на нужную машину,
            {' '}укажите ниже capability её runner'а.
          </div>
        </fieldset>
      )}

      {ruvds && (
        <fieldset className="f-group provision-fields" data-provision="ruvds">
          <legend>Сервер RUVDS</legend>
          {locked && <div className="provision-note">{lockHint}</div>}
          {cat?.err && <FormNote err={`справочники провайдера не загрузились: ${cat.err}`} />}
          {!cat && <div className="provision-note">загрузка справочников…</div>}
          <RuvdsFields p={ruvds} cat={cat?.data ?? null} locked={locked} error={error} setProv={setProv}
            onDatacenter={dc => setCfg(c => c.provision && cat?.data ? { ...c, provision: withDatacenter(cat.data, c.provision, dc) } : c)} num={num} />
        </fieldset>
      )}
    </>
  )
}

function sourceHint(src: string): string {
  if (src === 'local') return "хост: машина deploy-runner'а: docker compose без SSH и без денег"
  return 'сервер создаётся только после того, как владелец проекта подтвердит цену в карточке окружения'
}

function RuvdsFields({ p, cat, locked, error, setProv, onDatacenter, num }: {
  p: ProvisionConfig
  cat: InfraCatalog | null
  locked: boolean
  error: (field: string) => string | undefined
  setProv: (patch: Partial<ProvisionConfig>) => void
  onDatacenter: (dc: number | undefined) => void
  num: (v: string) => number | undefined
}) {
  const tariffs = cat ? dcTariffs(cat, p.datacenter) : []
  const drives = cat ? dcDriveTariffs(cat, p.datacenter) : []
  const os = cat ? activeOS(cat) : []
  const periods = (cat?.payment_periods ?? []).map(x => ({ id: x.id, name: x.label }))
  const pick = (label: string, name: string, field: string, value: number | undefined, items: { id: number; name: string }[], onChange: (v: number | undefined) => void) => (
    <Field label={label} error={error(`config.provision.${field}`)}>
      {ids => <Select ids={ids} name={name} value={value ?? ''} disabled={locked || !cat} onChange={e => onChange(num(e.target.value))}>
        <option value="">{cat ? 'выберите' : '—'}</option>
        {value !== undefined && !items.some(i => i.id === value) && <option value={value}>#{value}{cat ? ' (нет в справочнике)' : ''}</option>}
        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>}
    </Field>
  )
  const count = (label: string, name: string, field: 'cpu' | 'ram' | 'drive', min: number) => (
    <Field label={label} error={error(`config.provision.${field}`)}>
      {ids => <NumberInput ids={ids} name={name} min={min} width={110} disabled={locked} value={p[field] ?? ''}
        onChange={e => setProv({ [field]: num(e.target.value) })} />}
    </Field>
  )
  return (
    <>
      <div className="f-grid">
        {pick('Дата-центр', 'provision.datacenter', 'datacenter', p.datacenter, cat?.datacenters ?? [], onDatacenter)}
        {pick('Тариф сервера', 'provision.tariff_id', 'tariff_id', p.tariff_id, tariffs, v => setProv({ tariff_id: v }))}
        {pick('Операционная система', 'provision.os_id', 'os_id', p.os_id, os, v => setProv({ os_id: v }))}
        {pick('Тариф диска', 'provision.drive_tariff_id', 'drive_tariff_id', p.drive_tariff_id, drives, v => setProv({ drive_tariff_id: v }))}
      </div>
      <div className="f-grid provision-counts">
        {count('Процессоры', 'provision.cpu', 'cpu', 1)}
        {count('Память, ГБ', 'provision.ram', 'ram', 1)}
        {count('Диск, ГБ', 'provision.drive', 'drive', 1)}
        {pick('Период оплаты', 'provision.payment_period', 'payment_period', p.payment_period, periods, v => setProv({ payment_period: v }))}
      </div>
      <Field label="Публичный SSH-ключ deploy-runner'а" error={error('config.provision.ssh_public_key')}
        hint="содержимое ~/.ssh/<ключ>.pub с машины deploy-runner'а; приватный ключ остаётся там, логин на сервере root">
        {ids => <TextArea ids={ids} name="provision.ssh_public_key" className="mono" rows={2} disabled={locked}
          placeholder="ssh-ed25519 AAAA… deploy@runner" value={p.ssh_public_key ?? ''} onChange={e => setProv({ ssh_public_key: e.target.value })} />}
      </Field>
      <Field label="Скрипт первичной настройки" optional error={error('config.provision.bootstrap_cmd')}
        hint="выполняется на новом сервере один раз; пусто: скрипт по умолчанию ставит Docker">
        {ids => <TextArea ids={ids} name="provision.bootstrap_cmd" className="mono" rows={2} disabled={locked}
          placeholder="set -e; command -v docker || curl -fsSL https://get.docker.com | sh" value={p.bootstrap_cmd ?? ''}
          onChange={e => setProv({ bootstrap_cmd: e.target.value })} />}
      </Field>
      <div className="provision-note">
        После сохранения Rivet посчитает цену и попросит владельца проекта подтвердить создание сервера в карточке окружения.
        {' '}Денег без подтверждения Rivet не тратит.
      </div>
    </>
  )
}
