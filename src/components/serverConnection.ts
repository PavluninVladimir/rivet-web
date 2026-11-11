import type { Clock } from './overviewLogic.ts'

const clock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: id => clearTimeout(id as ReturnType<typeof setTimeout>),
}

// Проверяет связь установки, когда проектного SSE ещё нет.
export function watchServerConnection(
  probe: (signal: AbortSignal) => Promise<unknown>,
  onState: (connected: boolean) => void,
  timer: Clock = clock,
): () => void {
  let stopped = false
  let poll: unknown
  let deadline: unknown
  let controller: AbortController
  const check = () => {
    controller = new AbortController()
    let settled = false
    const finish = (connected: boolean) => {
      if (stopped || settled) return
      settled = true
      timer.clear(deadline)
      onState(connected)
      poll = timer.set(check, 15000)
    }
    deadline = timer.set(() => { finish(false); controller.abort() }, 5000)
    probe(controller.signal).then(() => finish(true), () => finish(false))
  }
  check()
  return () => {
    stopped = true
    timer.clear(poll)
    timer.clear(deadline)
    controller.abort()
  }
}
