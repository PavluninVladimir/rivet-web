import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAbout, parseAbout, sourceHref, sourceLabel } from './about.ts'

test('подпись: версия или «сборка без версии»', () => {
  assert.equal(sourceLabel({ version: 'v0.12.0' }), 'Исходный код · v0.12.0')
  assert.equal(sourceLabel({ version: 'dev' }), 'Исходный код · сборка без версии')
  assert.equal(sourceLabel({ version: '' }), 'Исходный код · сборка без версии')
  assert.equal(sourceLabel({ version: 'ad10d8e' }), 'Исходный код · ad10d8e')
})

test('адрес ссылки: только http(s), как пришёл от rivetd', () => {
  assert.equal(sourceHref({ source_ref_url: 'https://github.com/PavluninVladimir/rivet/tree/v0.12.0' }),
    'https://github.com/PavluninVladimir/rivet/tree/v0.12.0')
  assert.equal(sourceHref({ source_ref_url: 'http://git.example.org/acme/rivet' }), 'http://git.example.org/acme/rivet')
  assert.equal(sourceHref({ source_ref_url: 'javascript:alert(1)' }), null)
  assert.equal(sourceHref({ source_ref_url: 'не адрес' }), null)
})

test('разбор ответа', () => {
  const a = parseAbout({ version: 'dev', commit: '', source_url: 'https://x.example', source_ref_url: 'https://x.example', license: 'AGPL-3.0-only' })
  assert.equal(a?.version, 'dev')
  assert.equal(parseAbout(null), null)
  assert.equal(parseAbout({ error: { code: 'unauthorized' } }), null)
})

test('старый rivetd без /about и ошибка сети: null, без исключения', async () => {
  const orig = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401 })) as typeof fetch
    assert.equal(await fetchAbout(), null)
    globalThis.fetch = (async () => { throw new TypeError('сеть') }) as typeof fetch
    assert.equal(await fetchAbout(), null)
    globalThis.fetch = (async () => Response.json({ version: 'v1.0.0', source_ref_url: 'https://x.example/tree/v1.0.0', license: 'AGPL-3.0-only' })) as typeof fetch
    assert.equal((await fetchAbout())?.version, 'v1.0.0')
  } finally {
    globalThis.fetch = orig
  }
})
