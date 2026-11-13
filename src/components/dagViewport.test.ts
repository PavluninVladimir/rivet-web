import assert from 'node:assert/strict'
import test from 'node:test'
import { fitDagViewport } from './dagViewport.ts'

test('collapsed canvas does not produce the negative scale that overlaps the toolbar', () => {
  for (const height of [0, 1, 12, 23, 24]) assert.equal(fitDagViewport(787, height, 520, 122), null)
  for (const width of [0, 1, 12, 23, 24]) assert.equal(fitDagViewport(width, 240, 520, 122), null)
})

test('measurable canvas fits nodes inside padding with a finite positive scale', () => {
  for (const [width, height] of [
    [787, 240],
    [787, 678],
    [25, 25],
    [390, 320]
  ]) {
    const view = fitDagViewport(width, height, 520, 122)!
    assert.ok(view && view.k > 0 && Number.isFinite(view.k))
    assert.ok(view.x >= 12 && view.y >= 12)
    assert.ok(view.x + 520 * view.k <= width - 12 + 1e-8)
    assert.ok(view.y + 122 * view.k <= height - 12 + 1e-8)
  }
})

test('invalid geometry cannot poison later pan/zoom transforms', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.equal(fitDagViewport(bad, 240, 520, 122), null)
    assert.equal(fitDagViewport(787, bad, 520, 122), null)
    assert.equal(fitDagViewport(787, 240, bad, 122), null)
    assert.equal(fitDagViewport(787, 240, 520, bad), null)
  }
})
