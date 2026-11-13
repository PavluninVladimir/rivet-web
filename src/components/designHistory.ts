import type { DesignModel } from '../api/design'

export interface ModelChange {
  path: string
  before_present: boolean
  after_present: boolean
  before?: unknown
  after?: unknown
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const segment = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')

// Revision snapshots, rather than a PatchOp list, are authoritative here.
// Stable IDs keep inserted/replaced elements distinguishable from an index
// shift; order itself is recorded separately because it changes the design.
export function compareDesignModels(before: DesignModel, after: DesignModel): ModelChange[] {
  const changes: ModelChange[] = []
  const visit = (left: unknown, right: unknown, path: string, hasLeft = true, hasRight = true): void => {
    if (!hasLeft || !hasRight) {
      changes.push({ path, before_present: hasLeft, after_present: hasRight, ...(hasLeft ? { before: left } : {}), ...(hasRight ? { after: right } : {}) })
      return
    }
    if (Object.is(left, right)) return
    if (Array.isArray(left) && Array.isArray(right)) {
      const stable = [...left, ...right].every(item => object(item) && typeof item.id === 'string')
      const leftIds = stable ? left.map(item => (item as { id: string }).id) : []
      const rightIds = stable ? right.map(item => (item as { id: string }).id) : []
      if (stable && new Set(leftIds).size === left.length && new Set(rightIds).size === right.length) {
        const l = new Map(left.map(item => [(item as { id: string }).id, item]))
        const r = new Map(right.map(item => [(item as { id: string }).id, item]))
        for (const id of [...new Set([...leftIds, ...rightIds])].sort()) visit(l.get(id), r.get(id), `${path}/@${segment(id)}`, l.has(id), r.has(id))
        const common = new Set(leftIds.filter(id => r.has(id)))
        const oldOrder = leftIds.filter(id => common.has(id)), newOrder = rightIds.filter(id => common.has(id))
        if (oldOrder.some((id, index) => newOrder[index] !== id)) changes.push({ path: `${path}/$order`, before_present: true, after_present: true, before: oldOrder, after: newOrder })
      } else {
        for (let index = 0; index < Math.max(left.length, right.length); index++) visit(left[index], right[index], `${path}/${index}`, index < left.length, index < right.length)
      }
      return
    }
    if (object(left) && object(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) visit(left[key], right[key], `${path}/${segment(key)}`, own(left, key), own(right, key))
      return
    }
    changes.push({ path: path || '/', before_present: true, after_present: true, before: left, after: right })
  }
  visit(before, after, '')
  return changes
}

export function historyValue(present: boolean, value: unknown): string {
  return present ? JSON.stringify(value, null, 2) : 'Свойство или элемент отсутствует'
}
