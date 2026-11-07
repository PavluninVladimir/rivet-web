import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindingGroups, planeFromStatus, runnerCommand } from './runnerTokens.ts'

test('привязки группируются по происхождению в постоянном порядке', () => {
  const at = '2026-11-07T10:00:00Z'
  const groups = bindingGroups([
    { runner_id: 'local-reviewer', source: 'migration', bound_at: at },
    { runner_id: 'w1', source: 'issue', bound_at: at },
    { runner_id: 'local-worker', source: 'migration', bound_at: at },
  ])
  assert.deepEqual(groups.map(g => [g.label, g.ids]), [
    ['выпущен для', ['w1']],
    ['перенесено при обновлении', ['local-reviewer', 'local-worker']],
  ])
  assert.deepEqual(bindingGroups([]), [])
  // Бэкенд до привязок: поля нет.
  assert.deepEqual(bindingGroups(undefined), [])
})

test('адрес протокола из состояния установки', () => {
  assert.deepEqual(planeFromStatus({ grpc_addr: ':8090' }, 'rivet.local'), { addr: 'rivet.local:8090', tls: false, clientCert: false })
  assert.deepEqual(planeFromStatus({ grpc_addr: '[::]:9443', tls: true, client_cert: true }, 'h'), { addr: 'h:9443', tls: true, clientCert: true })
  assert.deepEqual(planeFromStatus({ grpc_addr: '10.0.0.5:8090', tls: true }, 'h'), { addr: '10.0.0.5:8090', tls: true, clientCert: false })
  assert.equal(planeFromStatus(undefined, 'h'), null)
})

test('команда запуска несёт идентификатор и флаги сертификата', () => {
  const plain = runnerCommand({ addr: 'h:8090', tls: false, clientCert: false }, 'office-1')
  assert.match(plain, /-plane h:8090 -id office-1 -agent rivet/)
  assert.doesNotMatch(plain, /-tls/)
  assert.match(runnerCommand({ addr: 'h:8090', tls: false, clientCert: false }, ' '), /-id <идентификатор>/)
  const mtls = runnerCommand({ addr: 'h:8090', tls: true, clientCert: true }, 'office-1')
  assert.match(mtls, /-tls -tls-cert office-1\.pem -tls-key office-1-key\.pem -id office-1/)
})
