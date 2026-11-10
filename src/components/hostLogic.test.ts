import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EnvHost, InfraCatalog } from '../api/client.ts'
import {
  HOST_STATE_LABEL, balanceShort, canDeleteHost, cleanProvision, dcDriveTariffs, dcTariffs, fillFromCatalog, fmtMoney,
  fmtPeriodMoney, hostActions, hostErrorText, hostSource, hostStateLabel, hostTerminal, inUseText, infraErrorText, infraRefs,
  localVerifyUrl, nextVerifyUrl, normCatalog, paidSoon, provisionForSource, specLabel, specLines, tokenPrefixText, withDatacenter,
} from './hostLogic.ts'

// Пробелы разрядов у toLocaleString: неразрывные: сравниваем обычными.
const sp = (s: string) => s.replace(/\s/g, ' ')

function host(p: Partial<EnvHost>): EnvHost {
  return {
    id: 'h1', provider: 'ruvds', state: 'ready', live: true, spec: { provider: 'ruvds' }, address: '', server_id: '',
    quote: null, balance: null, approved_by: '', approved_at: null, requested_by: 'admin', waiting_payment: false,
    paid_till: null, cost: null, cost_checked_at: null, attempts: 0, needs_retry: false, remove_volumes: false,
    delete_requested_by: '', detail: '', failure: '', compose_project: '', port: 0, created_at: '', updated_at: '',
    ...p,
  }
}

const catalog: InfraCatalog = normCatalog({
  datacenters: [
    { id: 1, name: 'Rucloud: Россия, Королёв', tariffs: [14, 15], drive_tariffs: [1, 3] },
    { id: 2, name: 'Zurich', tariffs: [15, 16], drive_tariffs: [3] },
  ],
  tariffs: [
    { id: 14, name: 'Regular', cpu_price: 79, ram_price: 195, active: true },
    { id: 15, name: 'Turbo', cpu_price: 120, ram_price: 240, active: true },
    { id: 16, name: 'Old', cpu_price: 50, ram_price: 100, active: false },
  ],
  drive_tariffs: [{ id: 1, name: 'HDD', price: 5.5, active: true }, { id: 3, name: 'SSD', price: 12, active: true }],
  os: [{ id: 50, name: 'Ubuntu 20.04', type: 'linux', active: false, ssh_keys: true }, { id: 52, name: 'Ubuntu 24.04', type: 'linux', active: true, ssh_keys: true }],
  payment_periods: [{ id: 2, label: '1 месяц' }, { id: 3, label: '3 месяца' }],
})

test('подписи всех состояний хоста', () => {
  const states = ['quoting', 'awaiting_approval', 'approved', 'creating', 'bootstrapping', 'ready',
    'delete_requested', 'deleting', 'deleted', 'rejected', 'failed']
  for (const s of states) assert.ok(HOST_STATE_LABEL[s], s)
  assert.equal(hostStateLabel(host({ state: 'quoting' })), 'считаем цену')
  assert.equal(hostStateLabel(host({ state: 'awaiting_approval' })), 'ждёт решения')
  assert.equal(hostStateLabel(host({ state: 'ready' })), 'готов')
  assert.equal(hostStateLabel(host({ state: 'delete_requested' })), 'ждёт решения об удалении')
  assert.equal(hostStateLabel(host({ state: 'failed' })), 'провал')
  // Сервер ждёт оплаты и шаг ждёт повтора: видно в подписи.
  assert.equal(hostStateLabel(host({ state: 'creating', waiting_payment: true })), 'создаётся · ждёт оплаты')
  assert.equal(hostStateLabel(host({ state: 'creating' })), 'создаётся')
  assert.equal(hostStateLabel(host({ state: 'bootstrapping', needs_retry: true })), 'настройка хоста · ждёт повтора')
  // Неизвестное состояние нового бэкенда показывается как есть.
  assert.equal(hostStateLabel(host({ state: 'migrating' })), 'migrating')
  assert.ok(hostTerminal('deleted') && hostTerminal('rejected') && hostTerminal('failed'))
  assert.ok(!hostTerminal('ready'))
})

test('дата оплаты подсвечивается меньше чем за трое суток', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  assert.equal(paidSoon('2026-11-20T12:00:00Z', now), false)
  assert.equal(paidSoon('2026-11-13T12:00:01Z', now), false, 'ровно трое суток с секундой: ещё нет')
  assert.equal(paidSoon('2026-11-13T11:59:59Z', now), true)
  assert.equal(paidSoon('2026-11-09T12:00:00Z', now), true, 'оплата уже кончилась')
  assert.equal(paidSoon(null, now), false)
  assert.equal(paidSoon('не дата', now), false)
})

test('тарифы и диски только выбранного дата-центра', () => {
  assert.deepEqual(dcTariffs(catalog, 1).map(t => t.id), [14, 15])
  // Недействующий тариф в списке дата-центра не предлагается.
  assert.deepEqual(dcTariffs(catalog, 2).map(t => t.id), [15])
  assert.deepEqual(dcTariffs(catalog, 99), [])
  assert.deepEqual(dcTariffs(catalog, undefined), [])
  assert.deepEqual(dcDriveTariffs(catalog, 1).map(t => t.id), [1, 3])
  assert.deepEqual(dcDriveTariffs(catalog, 2).map(t => t.id), [3])
})

test('смена дата-центра заменяет недоступные тарифы', () => {
  const p = { provider: 'ruvds', connection: 'ruvds', datacenter: 1, tariff_id: 14, drive_tariff_id: 1, cpu: 2 }
  assert.deepEqual(withDatacenter(catalog, p, 2), { ...p, datacenter: 2, tariff_id: 15, drive_tariff_id: 3 })
  // Тариф, который есть и в новом дата-центре, остаётся.
  assert.deepEqual(withDatacenter(catalog, { ...p, tariff_id: 15, drive_tariff_id: 3 }, 2), { ...p, datacenter: 2, tariff_id: 15, drive_tariff_id: 3 })
})

test('пустые поля привязки заполняются из справочника, выбранные не трогаются', () => {
  const filled = fillFromCatalog(catalog, { provider: 'ruvds', connection: 'ruvds' })
  assert.equal(filled.datacenter, 1)
  assert.equal(filled.tariff_id, 14)
  assert.equal(filled.drive_tariff_id, 1)
  assert.equal(filled.os_id, 52, 'первая действующая ОС')
  assert.equal(filled.payment_period, 2)
  const kept = fillFromCatalog(catalog, { provider: 'ruvds', datacenter: 2, tariff_id: 15, os_id: 52, payment_period: 3 })
  assert.equal(kept.datacenter, 2)
  assert.equal(kept.tariff_id, 15)
  assert.equal(kept.drive_tariff_id, 3)
  assert.equal(kept.payment_period, 3)
  // null вместо списков в ответе не роняет форму.
  assert.deepEqual(normCatalog({ datacenters: null as never, os: null as never }).datacenters, [])
})

test('конфигурация в решении: имена из справочника или идентификаторы', () => {
  const spec = { provider: 'ruvds', datacenter: 1, tariff_id: 14, os_id: 52, payment_period: 2, cpu: 2, ram: 4, drive: 20, drive_tariff_id: 3 }
  const quote = { amount: 320, currency: 'RUB', period: 2, period_label: '1 месяц' }
  assert.deepEqual(specLines(spec, catalog, quote), [
    ['дата-центр', 'Rucloud: Россия, Королёв'],
    ['тариф', 'Regular'],
    ['ресурсы', '2 CPU · 4 ГБ RAM · 20 ГБ диск (SSD)'],
    ['ОС', 'Ubuntu 24.04'],
    ['период оплаты', '1 месяц'],
  ])
  // Без справочника (участник не администратор): идентификаторы.
  assert.deepEqual(specLines(spec, null, null).map(([, v]) => v), ['#1', '#14', '2 CPU · 4 ГБ RAM · 20 ГБ диск', '#52', '#2'])
  // Снимок хоста spec_labels: названия на момент расчёта цены, без справочника.
  const labels = { datacenter: 'Королёв', tariff: 'Regular', os: 'Ubuntu 24.04', drive_tariff: 'SSD' }
  assert.deepEqual(specLines(spec, null, quote, labels).map(([, v]) => v),
    ['Королёв', 'Regular', '2 CPU · 4 ГБ RAM · 20 ГБ диск (SSD)', 'Ubuntu 24.04', '1 месяц'])
  // Неполный снимок: недостающее из справочника или идентификатором.
  assert.deepEqual(specLines(spec, null, quote, { os: 'Debian 12' }).map(([, v]) => v),
    ['#1', '#14', '2 CPU · 4 ГБ RAM · 20 ГБ диск', 'Debian 12', '1 месяц'])
  assert.deepEqual(specLines(spec, catalog, quote, {}).map(([, v]) => v)[0], 'Rucloud: Россия, Королёв')
})

test('подпись значения справочника: снимок, справочник, идентификатор', () => {
  const list = [{ id: 14, name: 'Regular' }]
  // Снимок важнее справочника: решение показывает то, за что считали цену.
  assert.equal(specLabel(14, 'Regular (снимок)', list), 'Regular (снимок)')
  assert.equal(specLabel(14, undefined, list), 'Regular')
  assert.equal(specLabel(14, '  ', list), 'Regular', 'пустая подпись снимка не считается')
  assert.equal(specLabel(15, undefined, list), '#15')
  assert.equal(specLabel(15, undefined, undefined), '#15')
  assert.equal(specLabel(undefined, 'что-то', list), '—')
})

test('деньги, баланс и цена за период', () => {
  assert.equal(sp(fmtMoney({ amount: 320, currency: 'RUB' })), '320 ₽')
  assert.equal(sp(fmtMoney({ amount: 1000.5, currency: 'RUB' })), '1 000,5 ₽')
  assert.equal(sp(fmtMoney({ amount: 12, currency: 'USD' })), '12 USD')
  assert.equal(fmtMoney(null), '—')
  assert.equal(sp(fmtPeriodMoney({ amount: 320, currency: 'RUB', period: 2, period_label: '1 месяц' })), '320 ₽ за 1 месяц')
  assert.equal(balanceShort({ amount: 320, currency: 'RUB' }, { amount: 100, currency: 'RUB' }), true)
  assert.equal(balanceShort({ amount: 320, currency: 'RUB' }, { amount: 1000, currency: 'RUB' }), false)
  assert.equal(balanceShort({ amount: 320, currency: 'RUB' }, null), false, 'баланс неизвестен: не пугаем')
})

test('действия с хостом: владелец, участник, состояния', () => {
  const owner = { owner: true, bound: true }
  const member = { owner: false, bound: true }
  const quote = { amount: 320, currency: 'RUB', period: 2, period_label: '1 месяц' }
  assert.deepEqual(hostActions(host({ state: 'awaiting_approval', quote }), owner), ['approve', 'reject'])
  // Цены ещё нет: подтверждать нечего.
  assert.deepEqual(hostActions(host({ state: 'awaiting_approval' }), owner), ['reject'])
  assert.deepEqual(hostActions(host({ state: 'awaiting_approval', quote }), member), [])
  assert.deepEqual(hostActions(host({ state: 'delete_requested' }), owner), ['confirm-delete', 'cancel-delete'])
  assert.deepEqual(hostActions(host({ state: 'delete_requested' }), member), [])
  // Готовый RUVDS: удаление владельцу, обновление стоимости любому участнику.
  assert.deepEqual(hostActions(host({ state: 'ready' }), owner), ['delete', 'refresh'])
  assert.deepEqual(hostActions(host({ state: 'ready' }), member), ['refresh'])
  assert.deepEqual(hostActions(host({ state: 'ready', provider: 'local' }), owner), ['delete'])
  assert.deepEqual(hostActions(host({ state: 'bootstrapping', needs_retry: true }), owner), ['retry', 'delete'])
  // Конечное состояние: запросить снова.
  for (const state of ['deleted', 'rejected', 'failed']) {
    assert.deepEqual(hostActions(host({ state, live: false }), owner), ['request'], state)
    assert.deepEqual(hostActions(host({ state, live: false }), member), [], state)
  }
  // Привязки нет, хоста нет: действий нет; привязка без хоста: запросить.
  assert.deepEqual(hostActions(null, { owner: true, bound: false }), [])
  assert.deepEqual(hostActions(null, owner), ['request'])
})

test('удаление доступно у готового, настраиваемого и созданного сервера', () => {
  assert.ok(canDeleteHost(host({ state: 'ready' })))
  assert.ok(canDeleteHost(host({ state: 'bootstrapping' })))
  assert.ok(canDeleteHost(host({ state: 'creating', server_id: '6732' })))
  assert.ok(!canDeleteHost(host({ state: 'creating' })), 'сервер у провайдера ещё неизвестен')
  assert.ok(!canDeleteHost(host({ state: 'awaiting_approval' })))
  assert.ok(!canDeleteHost(host({ state: 'deleted', live: false })))
})

test('источник хоста и привязка формы', () => {
  assert.equal(hostSource(undefined), 'address')
  assert.equal(hostSource({ provider: 'local', port: 0 }), 'local')
  assert.equal(hostSource({ provider: 'ruvds', connection: 'ruvds-main' }), 'ruvds:ruvds-main')
  assert.equal(provisionForSource('address', { provider: 'local' }), undefined)
  assert.deepEqual(provisionForSource('local', undefined), { provider: 'local', port: 0 })
  assert.deepEqual(provisionForSource('local', { provider: 'local', port: 20005 }), { provider: 'local', port: 20005 })
  assert.deepEqual(provisionForSource('ruvds:a', undefined), { provider: 'ruvds', connection: 'a', cpu: 2, ram: 2, drive: 20, ssh_public_key: '', bootstrap_cmd: '' })
  // Другое подключение того же провайдера: ресурсы и ключ остаются,
  // значения справочника сбрасываются.
  const prev = { provider: 'ruvds', connection: 'a', datacenter: 1, tariff_id: 14, cpu: 4, ram: 8, drive: 40, ssh_public_key: 'ssh-ed25519 AAAA k', bootstrap_cmd: 'true' }
  assert.deepEqual(provisionForSource('ruvds:b', prev), { provider: 'ruvds', connection: 'b', cpu: 4, ram: 8, drive: 40, ssh_public_key: 'ssh-ed25519 AAAA k', bootstrap_cmd: 'true' })
  assert.equal(provisionForSource('ruvds:a', prev), prev)
})

test('привязка уходит без полей чужого провайдера', () => {
  assert.deepEqual(cleanProvision({ provider: 'local', port: 20001, cpu: 2, connection: 'x' }), { provider: 'local', port: 20001 })
  assert.deepEqual(cleanProvision({ provider: 'local' }), { provider: 'local', port: 0 })
  const r = cleanProvision({ provider: 'ruvds', connection: 'ruvds', datacenter: 1, port: 5, ssh_public_key: '  ssh-ed25519 AAAA k \n' })
  assert.equal(r?.port, undefined)
  assert.equal(r?.ssh_public_key, 'ssh-ed25519 AAAA k')
  assert.equal(r?.bootstrap_cmd, '')
  assert.equal(cleanProvision(undefined), undefined)
})

test('Verify локального хоста по умолчанию следует за портом', () => {
  assert.equal(localVerifyUrl(20001), 'http://127.0.0.1:20001/')
  assert.equal(nextVerifyUrl('', 0, 20001), 'http://127.0.0.1:20001/')
  assert.equal(nextVerifyUrl(undefined, 0, 20001), 'http://127.0.0.1:20001/')
  assert.equal(nextVerifyUrl('http://127.0.0.1:20001/', 20001, 20002), 'http://127.0.0.1:20002/')
  // Свой URL человека не меняется.
  assert.equal(nextVerifyUrl('http://127.0.0.1:20001/health', 20001, 20002), 'http://127.0.0.1:20001/health')
  // Порт сброшен на «назначит Rivet»: подставленный URL убирается.
  assert.equal(nextVerifyUrl('http://127.0.0.1:20001/', 20001, 0), '')
  assert.equal(nextVerifyUrl(undefined, 0, 0), undefined)
})

test('подключение инфраструктуры: префикс токена и тексты отказов', () => {
  assert.equal(tokenPrefixText({ has_token: true, token_prefix: 'abcd1234…' }), 'abcd1234…')
  assert.equal(tokenPrefixText({ has_token: true, token_prefix: 'abcd1234' }), 'abcd1234…')
  assert.equal(tokenPrefixText({ has_token: false, token_prefix: '' }), 'нет')
  assert.match(infraErrorText('session_required', 'forbidden'), /сессии консоли/)
  assert.match(infraErrorText('no_secret_key', 'x'), /RIVET_SECRET_KEY/)
  assert.equal(infraErrorText('provider_error', 'RUVDS: 500'), 'RUVDS: 500')
  assert.match(hostErrorText('price_changed', 'x'), /Цена изменилась/)
  assert.match(hostErrorText('session_required', 'x'), /сессии консоли/)
  assert.equal(hostErrorText('', 'сначала удалите хост окружения'), 'сначала удалите хост окружения')
  const refs = infraRefs({ error: { code: 'in_use', refs: [{ kind: 'environment', id: 'e1', name: 'staging', project_id: 'p1' }, null] } })
  assert.deepEqual(refs, [{ kind: 'environment', id: 'e1', name: 'staging', project_id: 'p1' }])
  assert.deepEqual(infraRefs({ refs: [{ kind: 'environment', id: 'e2' }] }).map(r => r.id), ['e2'])
  assert.deepEqual(infraRefs(null), [])
  assert.match(inUseText('in use', refs), /staging/)
  assert.equal(inUseText('in use', []), 'in use')
})
