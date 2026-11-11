import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clock } from './overviewLogic.ts'
import { watchServerConnection } from './serverConnection.ts'

function fakeClock() {
  let time = 0, id = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock = {
    now: () => time,
    set: (fn, ms) => { pending.set(++id, { at: time + ms, fn }); return id },
    clear: key => { pending.delete(key as number) },
  }
  const advance = (ms: number) => {
    const end = time + ms
    for (;;) {
      const next = [...pending].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      time = next[1].at; pending.delete(next[0]); next[1].fn()
    }
    time = end
  }
  return { clock, advance, pending }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('без проекта: доступный API, разрыв и автоматическое восстановление', async () => {
  const { clock, advance } = fakeClock()
  const states: boolean[] = []
  let online = true
  const stop = watchServerConnection(async () => { if (!online) throw Error('offline') }, on => states.push(on), clock)
  await flush()
  online = false; advance(15000); await flush()
  online = true; advance(15000); await flush()
  assert.deepEqual(states, [true, false, true])
  stop()
})

test('таймаут завершает зависшую проверку; её поздний ответ не меняет состояние', async () => {
  const { clock, advance } = fakeClock()
  const states: boolean[] = [], signals: AbortSignal[] = []
  let resolve: () => void = () => {}
  let calls = 0
  const stop = watchServerConnection(signal => {
    signals.push(signal)
    return ++calls === 1 ? new Promise<void>(r => { resolve = r }) : Promise.resolve()
  }, on => states.push(on), clock)
  advance(5000)
  assert.equal(signals[0].aborted, true)
  assert.deepEqual(states, [false])
  resolve(); await flush()
  assert.deepEqual(states, [false])
  advance(15000); await flush()
  assert.deepEqual(states, [false, true])
  stop()
})

test('при смене проекта или размонтировании запрос и таймеры отменяются', async () => {
  const { clock, advance, pending } = fakeClock()
  const states: boolean[] = []
  let resolve: () => void = () => {}, signal: AbortSignal | undefined
  const stop = watchServerConnection(s => { signal = s; return new Promise<void>(r => { resolve = r }) }, on => states.push(on), clock)
  stop()
  assert.equal(signal?.aborted, true)
  assert.equal(pending.size, 0)
  resolve(); await flush(); advance(60000)
  assert.deepEqual(states, [])
})
