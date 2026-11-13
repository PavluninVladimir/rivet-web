import assert from 'node:assert/strict'
import test from 'node:test'
import { compareDesignModels, historyValue } from './designHistory.ts'
import { initialDesign } from './designModel.ts'

let next = 0
const fixture = () => initialDesign(() => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`)

test('undo removes a property: snapshots show its real previous value and absence', () => {
  const before = fixture(), after = structuredClone(before)
  before.screens[0].root.children[0].props.padding = 24
  const changes = compareDesignModels(before, after)
  assert.equal(changes.length, 1)
  assert.match(changes[0].path, /\/props\/padding$/)
  assert.equal(changes[0].before, 24)
  assert.equal(changes[0].before_present, true)
  assert.equal(changes[0].after_present, false)
  assert.equal(historyValue(changes[0].before_present, changes[0].before), '24')
  assert.equal(historyValue(changes[0].after_present, changes[0].after), 'Свойство или элемент отсутствует')
})

test('import replacement shows removed and added stable IDs without requiring PatchOps', () => {
  const before = fixture(), after = fixture()
  after.screens[0].root.children[0].props.text = '<script>imported text only</script>'
  const changes = compareDesignModels(before, after)
  const removed = changes.find(change => change.path === `/screens/@${before.screens[0].id}`)
  const added = changes.find(change => change.path === `/screens/@${after.screens[0].id}`)
  assert.ok(removed && added)
  assert.equal(removed.before_present, true)
  assert.equal(removed.after_present, false)
  assert.equal(added.before_present, false)
  assert.equal(added.after_present, true)
  assert.match(historyValue(added.after_present, added.after), /imported text only/)
  assert.deepEqual(before.screens[0].root.children[0].props.text, 'Новый продукт')
})

test('comparison distinguishes null, deletion and object-key ordering', () => {
  const before = fixture(), after = structuredClone(before)
  after.screens[0].root.props = Object.fromEntries(Object.entries(before.screens[0].root.props).reverse())
  assert.deepEqual(compareDesignModels(before, after), [])
  after.screens[0].root.props.padding = null
  const change = compareDesignModels(before, after).find(change => change.path.endsWith('/padding'))!
  assert.equal(change.after_present, true)
  assert.equal(historyValue(change.after_present, change.after), 'null')
})

test('inserting a node does not misreport unchanged siblings, but reorder is visible', () => {
  const before = fixture(), inserted = structuredClone(before)
  inserted.screens[0].root.children.unshift({ id: 'new', type: 'text', props: { text: 'Inserted' }, children: [] })
  const additions = compareDesignModels(before, inserted)
  assert.equal(additions.length, 1)
  assert.ok(additions[0].path.endsWith('/children/@new'))
  const reordered = structuredClone(before)
  reordered.screens[0].root.children.reverse()
  const order = compareDesignModels(before, reordered)
  assert.equal(order.length, 1)
  assert.ok(order[0].path.endsWith('/$order'))
  assert.deepEqual(order[0].before, before.screens[0].root.children.map(child => child.id))
  assert.deepEqual(order[0].after, reordered.screens[0].root.children.map(child => child.id))
})
