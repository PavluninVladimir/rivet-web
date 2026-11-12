import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secretPatch } from './applicationSecretsLogic.ts'

test('секрет сохраняется отдельно, с точным значением, без публичных переменных', () => {
  assert.deepEqual(secretPatch('ADMIN_PASSWORD', ' value with spaces ', { PORT: '8080' }), { set: { ADMIN_PASSWORD: ' value with spaces ' } })
})

test('пустое значение, коллизия, зарезервированное имя и перенос строки запрещены', () => {
  for (const [name, value] of [['A',''], ['RIVET_TOKEN','test'], ['A-B','test'], ['A','x\ny'], ['A','x\0y'], ['A','я'.repeat(2049)], ['a'.repeat(129),'test']]) {
    assert.throws(() => secretPatch(name, value))
  }
  assert.throws(() => secretPatch('PORT', 'secret', { PORT: '8080' }))
  assert.throws(() => secretPatch('constructor', 'secret', { constructor: 'public' }))
})
