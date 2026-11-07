import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addTags } from './tags.ts'

test('черновик без split даёт один тег, как раньше', () => {
  assert.deepEqual(addTags(['a'], ' src/**/*.go,, '), ['a', 'src/**/*.go'])
  assert.deepEqual(addTags(['a'], 'a'), ['a'])
  assert.deepEqual(addTags([], '   '), [])
})

test('вставка списка через запятую и пробелы даёт несколько тегов', () => {
  const split = /[\s,]+/
  assert.deepEqual(addTags([], 'local-worker, local-reviewer', split), ['local-worker', 'local-reviewer'])
  assert.deepEqual(addTags(['local-worker'], ' local-worker,,ri-b\nri-c ', split), ['local-worker', 'ri-b', 'ri-c'])
  assert.deepEqual(addTags([], ',', split), [])
})
