// Browser regression for the CSP inherited by an opaque srcdoc frame.
// Run with Node's TypeScript support and Playwright available in the workspace:
// RIVET_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/design-preview-csp.browser.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  initialDesign,
  renderDesignPreview,
  DESIGN_PREVIEW_SCRIPT_HASH
} from '../src/components/designModel.ts'
const { chromium } = await import(process.env.RIVET_PLAYWRIGHT_MODULE || 'playwright')
const model = initialDesign(),
  element = model.screens[0].root.children[0]
element.props.text = "<img src=x onerror=\"parent.postMessage('attack','*')\">Safe text"
const preview = renderDesignPreview(model, model.screens[0].root, 'test-document', 7, 'test-channel', '')
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost'),
    blocked = url.searchParams.has('blocked'),
    tampered = url.searchParams.has('tampered')
  if (url.pathname === '/harness.js') {
    response.setHeader('Content-Type', 'application/javascript')
    response.end(
      `window.selections=[];window.addEventListener('message',function(event){var frame=document.getElementById('preview');var data=event.data;if(event.source===frame.contentWindow&&event.origin==='null'&&data&&data.type==='select'&&data.document_id==='test-document'&&data.channel_nonce==='test-channel'&&data.revision===7)window.selections.push(data.element_id)});document.getElementById('preview').srcdoc=${JSON.stringify(tampered ? preview.replace('<script>', '<script>/* changed byte */') : preview)};`
    )
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'${blocked ? '' : ` '${DESIGN_PREVIEW_SCRIPT_HASH}'`}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'`
  )
  response.end(
    `<iframe id="preview" title="Design preview" sandbox="allow-scripts"></iframe><script src="/harness.js${url.search}"></script>`
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address(),
  base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [suffix, expected] of [
    ['', 1],
    ['?blocked', 0],
    ['?tampered', 0]
  ]) {
    const violations = []
    page.on('console', function collect(message) {
      if (message.text().includes('Content Security Policy')) violations.push(message.text())
    })
    await page.goto(base + suffix)
    const frame = page.frameLocator('#preview')
    await frame.getByText(element.props.text, { exact: true }).click()
    if (expected) await page.waitForFunction(() => window.selections.length === 1)
    else await page.waitForFunction(() => document.getElementById('preview').contentWindow !== null)
    assert.deepEqual(await page.evaluate(() => window.selections), expected ? [element.id] : [])
    if (expected) assert.deepEqual(violations, [])
    else
      assert.ok(
        violations.some(message => message.includes('script-src')),
        'unreviewed inline code must remain blocked'
      )
    const child = page.frames().find(frame => frame !== page.mainFrame())
    assert.ok(child)
    assert.equal(
      await child.evaluate(() => {
        try {
          void parent.document.cookie
          return false
        } catch {
          return true
        }
      }),
      true
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS preview under production response CSP: trusted hash selects; missing hash/tampered script blocked; parent/session isolated'
  )
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
