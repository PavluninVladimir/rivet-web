import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantApi } from './assistant.ts'
import { designApi } from './design.ts'
import { ApiError, subscribe, type Event } from './client.ts'
import { planRefresh } from '../components/eventBatch.ts'
test('assistant intent keeps stable idempotency key and never calls a grant endpoint', async () => {
  const fetch = globalThis.fetch,
    calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return Response.json({ message: {}, run: {} })
  }
  try {
    await assistantApi.send('p', 'Восстанови', 'recover', 'rev1', 'same-key')
    await assistantApi.send('p', 'Восстанови', 'recover', 'rev1', 'same-key')
    assert.equal(calls.length, 2)
    for (const c of calls) {
      assert.equal(c.url, '/api/v1/projects/p/assistant/messages')
      assert.equal((c.init?.headers as Record<string, string>)['Idempotency-Key'], 'same-key')
      assert.deepEqual(JSON.parse(String(c.init?.body)), {
        text: 'Восстанови',
        intent: 'recover',
        expected_snapshot_revision: 'rev1'
      })
    }
  } finally {
    globalThis.fetch = fetch
  }
})
test('design preview and save preserve expected revision and typed scope', async () => {
  const fetch = globalThis.fetch,
    calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return Response.json({})
  }
  try {
    const ops = [
      {
        op: 'set_property' as const,
        element_id: 'button',
        property: 'padding',
        value: 24,
        scope: 'instance' as const
      }
    ]
    await designApi.diff('p', 'd', 7, ops)
    await designApi.patch('p', 'd', 7, ops, 'key')
    assert.match(calls[0].url, /preview-diff$/)
    assert.equal(calls[1].init?.method, 'PATCH')
    assert.equal((calls[1].init?.headers as Record<string, string>)['Idempotency-Key'], 'key')
    for (const c of calls)
      assert.deepEqual(JSON.parse(String(c.init?.body)), { expected_revision: 7, operations: ops })
  } finally {
    globalThis.fetch = fetch
  }
})
test('additive top-level error envelope retains machine-readable conflict code', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json(
      { code: 'revision_conflict', message: 'Версия изменилась', current_revision: 8 },
      { status: 409 }
    )
  try {
    await assert.rejects(
      () => designApi.patch('p', 'd', 7, [], 'key'),
      e =>
        e instanceof ApiError &&
        e.status === 409 &&
        e.code === 'revision_conflict' &&
        e.message === 'Версия изменилась'
    )
  } finally {
    globalThis.fetch = fetch
  }
})
test('workspace events and reconnect invalidate current project without effects', () => {
  const original = globalThis.EventSource,
    listeners = new Map<string, (e: MessageEvent) => void>(),
    seen: Event[] = [],
    states: boolean[] = []
  let source: { onopen: (() => void) | null } | undefined
  class FakeSource {
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      source = this
    }
    addEventListener(name: string, fn: (e: MessageEvent) => void) {
      listeners.set(name, fn)
    }
    close() {}
  }
  globalThis.EventSource = FakeSource as unknown as typeof EventSource
  try {
    const close = subscribe('p', { onEvent: e => seen.push(e), onState: connected => states.push(connected) })
    for (const [i, type] of [
      'assistant.run.updated',
      'assistant.action.updated',
      'assistant.message.created',
      'assistant.snapshot.invalidated',
      'design.document.updated',
      'design.thread.updated',
      'design.handoff.created'
    ].entries()) {
      assert.ok(listeners.has(type))
      listeners.get(type)!({
        data: JSON.stringify({ ID: i + 1, ProjectID: 'p', Type: type })
      } as MessageEvent)
    }
    source!.onopen!()
    source!.onopen!()
    assert.deepEqual(states, [true, true])
    assert.equal(planRefresh(seen, () => false).project.length, 7)
    close()
  } finally {
    globalThis.EventSource = original
  }
})
