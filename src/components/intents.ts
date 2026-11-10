import { useEffect } from 'react'

// Одноразовые намерения между экранами (fix-web-console-tails): палитра
// просит открыть форму нового Epic'а, а список Epic'ов забирает просьбу при
// монтировании или по событию, если он уже открыт. Нового адреса и экрана
// нет. Просьба живёт недолго: если экран так и не открылся, она не всплывёт
// позже при обычном переходе.

const TTL_MS = 5000
const bus = new EventTarget()
let newEpicAt = 0

export function requestNewEpic(): void {
  newEpicAt = Date.now()
  bus.dispatchEvent(new Event('new-epic'))
}

function takeNewEpic(): boolean {
  const fresh = newEpicAt > 0 && Date.now() - newEpicAt < TTL_MS
  newEpicAt = 0
  return fresh
}

export function useNewEpicRequest(open: () => void): void {
  useEffect(() => {
    const take = () => { if (takeNewEpic()) open() }
    take()
    bus.addEventListener('new-epic', take)
    return () => bus.removeEventListener('new-epic', take)
  }, [open])
}
