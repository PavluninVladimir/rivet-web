import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerLabel } from './providerLabel.ts'

test('название хостинга для человека', () => {
  assert.equal(providerLabel('github'), 'GitHub')
  assert.equal(providerLabel('gitlab'), 'GitLab')
  assert.equal(providerLabel('gitea'), 'Gitea / Forgejo')
  // Неизвестный провайдер (fake стенда) — как есть.
  assert.equal(providerLabel('fake'), 'fake')
})
