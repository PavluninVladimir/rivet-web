import type { Event } from '../api/client.ts'

// Задача ждёт подтверждения merge (fix-pr-without-test-step): последнее
// из событий шага — вход в merge (task.review_passed), после него задача
// не уходила на другой шаг и не завершилась. Кнопка merge нужна и без PR:
// если хостинг не создал PR при входе в merge, бэкенд создаёт его при
// подтверждении человеком.
export function awaitingMerge(timeline: Event[]): boolean {
  let waiting = false
  for (const e of timeline) {
    if (e.Type === 'task.review_passed') waiting = true
    else if (e.Type === 'task.status' || e.Type === 'task.step') waiting = false
  }
  return waiting
}
