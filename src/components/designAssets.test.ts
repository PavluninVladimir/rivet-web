import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesignAsset } from '../api/design'
import { DESIGN_ASSET_FRESH_MS, designAssetIds, ScopedDesignAssetCache } from './designAssets.ts'
import { initialDesign } from './designModel.ts'

const asset = (id: string, url: string): DesignAsset => ({
  id,
  url,
  sha256: 'a'.repeat(64),
  mime: 'image/png',
  size_bytes: 100
})

test('fresh assets do not call the API for repeated edits; four-minute expiry gets a new capability', async () => {
  const cache = new ScopedDesignAssetCache()
  let time = 1000,
    calls = 0
  const fetch = async (_project: string, id: string) => asset(id, `/api/v1/design-assets/token-${++calls}`)
  const first = await cache.load('project', 'image', fetch, () => time)
  for (let edit = 0; edit < 100; edit++) {
    time++
    assert.equal(await cache.load('project', 'image', fetch, () => time), first)
  }
  assert.equal(calls, 1)
  time = 1000 + DESIGN_ASSET_FRESH_MS
  assert.equal(cache.read('project', 'image', time), undefined)
  const renewed = await cache.load('project', 'image', fetch, () => time)
  assert.notEqual(renewed.url, first.url)
  assert.equal(calls, 2)
})

test('asset UUIDs are isolated by project, including concurrent loads', async () => {
  const cache = new ScopedDesignAssetCache(),
    calls: string[] = []
  const fetch = async (project: string, id: string) => {
    calls.push(project)
    return asset(id, `/${project}/token`)
  }
  const [a, same, b] = await Promise.all([
    cache.load('a', 'same-image', fetch, () => 0),
    cache.load('a', 'same-image', fetch, () => 0),
    cache.load('b', 'same-image', fetch, () => 0)
  ])
  assert.equal(a, same)
  assert.equal(a.url, '/a/token')
  assert.equal(b.url, '/b/token')
  assert.deepEqual(calls, ['a', 'b'])
  assert.equal(cache.read('other', 'same-image', 1), undefined)
})

test('historical and pending models provide their own image IDs, not current saved IDs', () => {
  const current = initialDesign(),
    history = structuredClone(current),
    pending = structuredClone(current)
  history.screens[0].root.children.push({
    id: 'old-node',
    type: 'image',
    props: { asset_id: 'historical-image' },
    children: []
  })
  pending.components[0].root.props.asset_id = 'pending-image'
  assert.deepEqual(designAssetIds(current), [])
  assert.deepEqual(designAssetIds(history), ['historical-image'])
  assert.deepEqual(designAssetIds(pending), ['pending-image'])
  pending.overrides.push({ instance_id: 'instance', property: 'asset_id', value: 'override-image' })
  pending.components[0].variants.push({ state: 'hover', props: { asset_id: 'hover-image' } })
  assert.deepEqual(designAssetIds(pending), ['hover-image', 'override-image', 'pending-image'])
})

test('latency and clock reversal cannot make an expired capability fresh', async () => {
  const cache = new ScopedDesignAssetCache()
  let time = 1000
  const fetch = async (_project: string, id: string) => {
    time += DESIGN_ASSET_FRESH_MS + 1
    return asset(id, '/slow/token')
  }
  await cache.load('p', 'image', fetch, () => time)
  assert.equal(cache.read('p', 'image', time), undefined)
  assert.equal(cache.read('p', 'image', 999), undefined)
})

test('denied or malformed asset metadata is not cached and can be retried', async () => {
  const cache = new ScopedDesignAssetCache()
  await assert.rejects(() =>
    cache.load(
      'p',
      'image',
      async () => {
        throw new Error('403')
      },
      () => 0
    )
  )
  assert.equal(cache.read('p', 'image', 1), undefined)
  await assert.rejects(() =>
    cache.load(
      'p',
      'image',
      async () => asset('foreign', '/bad/token'),
      () => 1
    )
  )
  const valid = await cache.load(
    'p',
    'image',
    async () => asset('image', '/valid/token'),
    () => 2
  )
  assert.equal(cache.read('p', 'image', 3), valid)
})
