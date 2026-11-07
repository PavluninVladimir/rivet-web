// Логика вкладки «Runner'ы» раздела управления (add-runner-identity):
// привязки токенов к runner'ам и команда запуска runner'а. Чистые функции,
// чтобы проверять их без браузера.

import type { RunnerBinding, RunnerBindingSource } from '../api/client'

// Происхождение привязки токена к runner'у.
export const BINDING_LABEL: Record<RunnerBindingSource, string> = {
  issue: 'выпущен для',
  first_use: 'при первой регистрации',
  migration: 'перенесено при обновлении',
}

const ORDER: RunnerBindingSource[] = ['issue', 'first_use', 'migration']

// bindingGroups: привязки токена по происхождению в постоянном порядке.
// Неизвестное происхождение (новый бэкенд) идёт последним со своим именем.
export function bindingGroups(runners: RunnerBinding[] | undefined): { source: string; label: string; ids: string[] }[] {
  const by = new Map<string, string[]>()
  for (const b of runners ?? []) {
    const ids = by.get(b.source) ?? []
    ids.push(b.runner_id)
    by.set(b.source, ids)
  }
  const keys = [...by.keys()].sort((a, b) => rank(a) - rank(b))
  return keys.map(source => ({ source, label: BINDING_LABEL[source as RunnerBindingSource] ?? source, ids: by.get(source)! }))
}

function rank(source: string): number {
  const i = ORDER.indexOf(source as RunnerBindingSource)
  return i < 0 ? ORDER.length : i
}

// Протокол runner'ов из состояния установки.
export interface Plane { addr: string; tls: boolean; clientCert: boolean }

// planeFromStatus: адрес протокола для команды запуска. Вместо адреса
// прослушивания вида ":8090", "0.0.0.0:8090" или "[::]:8090" берётся хост
// консоли, порт идёт после последнего двоеточия. null, если адреса в состоянии
// нет.
export function planeFromStatus(d: { grpc_addr?: string; tls?: boolean; client_cert?: boolean } | undefined, hostname: string): Plane | null {
  if (!d?.grpc_addr) return null
  const i = d.grpc_addr.lastIndexOf(':')
  const host = i >= 0 ? d.grpc_addr.slice(0, i) : d.grpc_addr
  const port = i >= 0 ? d.grpc_addr.slice(i + 1) : ''
  const wildcard = host === '' || host === '0.0.0.0' || host === '[::]' || host === '::'
  const h = wildcard ? hostname : host
  return { addr: port ? `${h}:${port}` : d.grpc_addr, tls: !!d.tls, clientCert: !!d.client_cert }
}

// runnerCommand: команда запуска runner'а на хосте с рабочими копиями:
// идентификатор, для которого выпущен токен, и флаги клиентского
// сертификата, если установка требует mTLS.
export function runnerCommand(p: Plane, runnerID: string): string {
  const id = runnerID.trim() || '<идентификатор>'
  const tls = p.tls || p.clientCert ? ' -tls' : ''
  const cert = p.clientCert ? ` -tls-cert ${id}.pem -tls-key ${id}-key.pem` : ''
  return `RIVET_RUNNER_TOKEN_FILE=$HOME/.rivet/runner.token rivet-runner -plane ${p.addr}${tls}${cert} -id ${id} -agent rivet -caps coding`
}
