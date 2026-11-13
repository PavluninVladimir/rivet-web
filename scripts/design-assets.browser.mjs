// Builds are served with the production CSP. All API responses and images are
// synthetic, so this regression requires neither a model nor a running backend.
// npm run build
// RIVET_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/design-assets.browser.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initialDesign, DESIGN_PREVIEW_SCRIPT_HASH } from '../src/components/designModel.ts'
const { chromium } = await import(process.env.RIVET_PLAYWRIGHT_MODULE || 'playwright')
const project = '11111111-1111-4111-8111-111111111111'
const documentId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const assetId = '44444444-4444-4444-8444-444444444444'
const imageNode = '55555555-5555-4555-8555-555555555555'
const now = '2026-11-13T13:00:00Z'
const modelWithImage = initialDesign()
modelWithImage.screens[0].root.children.push({
  id: imageNode,
  type: 'image',
  props: { asset_id: assetId, text: 'Тестовое изображение', width: 20, height: 20 },
  children: []
})
const modelWithoutImage = structuredClone(modelWithImage)
modelWithoutImage.screens[0].root.children.pop()
let currentRevision = 1
let capability = 0
const metadataReads = [],
  contentReads = [],
  documentReads = [],
  mutations = []
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!path.startsWith(root + sep)) {
    response.writeHead(404).end()
    return
  }
  try {
    const content = await readFile(path)
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[extname(path)] ||
        'application/octet-stream'
    )
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' '${DESIGN_PREVIEW_SCRIPT_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
    )
    response.end(content)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.addCookies([{ name: 'rivet-synthetic-session', value: 'private-test-cookie', url: base }])
const page = await context.newPage(),
  errors = []
page.on('pageerror', error => errors.push(error.message))
await page.clock.install()
await page.addInitScript(() => {
  window.EventSource = class {
    constructor() {
      setTimeout(() => this.onopen?.(), 10)
    }
    addEventListener() {}
    close() {}
  }
})
const doc = revision => ({
  id: documentId,
  project_id: project,
  name: 'Изображения',
  revision,
  content_sha: String(revision).repeat(64),
  created_by: actor,
  updated_at: now,
  base: null
})
await page.route('**/api/v1/**', async route => {
  const request = route.request(),
    url = new URL(request.url()),
    path = url.pathname.replace('/api/v1', '')
  if (request.method() !== 'GET') mutations.push(path)
  if (path.startsWith('/design-assets/')) {
    contentReads.push({
      path,
      cookie: request.headers().cookie ?? '',
      origin: request.headers().origin ?? ''
    })
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64'
      )
    })
    return
  }
  let body = []
  if (path === '/auth/me')
    body = {
      id: actor,
      login: 'owner',
      name: 'Владелец',
      admin: true,
      disabled: false,
      must_change_password: false,
      created_at: now
    }
  else if (path === '/projects') body = [{ ID: project, Name: 'Изображения дизайна' }]
  else if (path.endsWith('/members')) body = [{ login: 'owner', name: 'Владелец', role: 'owner' }]
  else if (path.endsWith('/overview')) body = {}
  else if (path.endsWith('/load-testing')) body = { environments: [] }
  else if (path === '/roles') body = { roles: [] }
  else if (path === '/team') body = { agents: [] }
  else if (path.endsWith('/design/documents')) body = { items: [doc(currentRevision)], next_cursor: null }
  else if (path.endsWith('/design/documents/' + documentId)) {
    const revision = Number(url.searchParams.get('revision') ?? currentRevision)
    documentReads.push(revision)
    body = { document: doc(revision), model: revision === 1 ? modelWithImage : modelWithoutImage }
  } else if (path.endsWith('/revisions'))
    body = {
      items: Array.from({ length: currentRevision }, (_, index) => currentRevision - index).map(revision => ({
        revision,
        parent_revision: revision === 1 ? null : revision - 1,
        content_sha: String(revision).repeat(64),
        actor_id: actor,
        created_at: now,
        diff: { base_revision: revision - 1, operations: [], affected_element_ids: [], conflicts: [] }
      })),
      next_cursor: null
    }
  else if (path.endsWith('/threads')) body = { items: [], next_cursor: null }
  else if (path.endsWith('/design/assets/' + assetId)) {
    metadataReads.push({ path, capability: ++capability })
    body = {
      id: assetId,
      sha256: 'a'.repeat(64),
      mime: 'image/png',
      size_bytes: 68,
      url: base + '/api/v1/design-assets/capability-' + capability
    }
  }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(`${base}/#/p/${project}/design`)
  const image = page
    .frameLocator('iframe[title="Изолированный предпросмотр дизайна"]')
    .getByRole('img', { name: 'Тестовое изображение' })
  await image.waitFor()
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow !== null)
  assert.equal(metadataReads.length, 1)
  await page.getByRole('button', { name: 'Новый продукт', exact: true }).click()
  await page.getByLabel('Текст', { exact: true }).fill('Локальный черновик')
  const initialUrl = await image.getAttribute('src'),
    readsBeforeIdle = documentReads.length
  await page.clock.fastForward(5 * 60 * 1000 + 1000)
  await page.waitForFunction(() => document.querySelector('.design-inspector input') !== null)
  await image.waitFor()
  await page
    .frameLocator('iframe[title="Изолированный предпросмотр дизайна"]')
    .locator('img[src*="capability-2"]')
    .waitFor()
  assert.notEqual(await image.getAttribute('src'), initialUrl)
  assert.equal(await image.evaluate(image => image.naturalWidth), 1)

  assert.ok(metadataReads.length >= 2, 'idle expiry refreshes metadata without editing the document')
  assert.equal(documentReads.length, readsBeforeIdle, 'asset TTL must not reload saved documents')
  assert.equal(await page.getByLabel('Текст', { exact: true }).inputValue(), 'Локальный черновик')
  const freshReads = metadataReads.length
  for (const value of ['Локальный черновик а', 'Локальный черновик аб', 'Локальный черновик абв'])
    await page.getByLabel('Текст', { exact: true }).fill(value)
  assert.equal(metadataReads.length, freshReads, 'fresh cache is reused while typing')
  // Current revision no longer contains the image; history still needs its URL.
  await page.evaluate(() => sessionStorage.clear())
  currentRevision = 2
  await page.reload()
  await page.getByRole('heading', { name: 'Свойства', exact: true }).waitFor()
  assert.equal(await image.count(), 0)
  const readsBeforeHistory = metadataReads.length
  await page.getByRole('button', { name: 'Просмотр', exact: true }).nth(1).click()
  await image.waitFor()
  assert.equal(metadataReads.length, readsBeforeHistory + 1)
  assert.ok((await image.getAttribute('src')).includes('capability-'))
  assert.equal(await image.evaluate(image => image.naturalWidth), 1)
  assert.deepEqual(mutations, [])
  assert.ok(contentReads.length > 0)
  assert.ok(
    contentReads.every(request => request.cookie === ''),
    'opaque preview image loads send no session cookie'
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS design images: idle >5min refresh, draft retained, no document reload, fresh edits no API, historical deleted image restored, no mutation/model calls, no preview credentials'
  )
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
