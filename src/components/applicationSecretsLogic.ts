import type { ApplicationSecretPatch } from '../api/client.ts'

export function secretPatch(name: string, value: string, publicEnv: Record<string,string> = {}): ApplicationSecretPatch {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || name.startsWith('RIVET_')) {
    throw new Error('Недопустимое или зарезервированное имя переменной')
  }
  if (Object.hasOwn(publicEnv, name)) throw new Error('Имя уже используется публичной переменной')
  if (!value || new TextEncoder().encode(value).length > 4096 || /[\0\r\n]/.test(value)) {
    throw new Error('Нужно непустое значение одной строкой до 4096 байт')
  }
  return { set: { [name]: value } }
}
