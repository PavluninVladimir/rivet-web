import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from './form'
import { appendPage, mergeHead, type Page } from './pagedList'

// usePaged — список страницами по курсору before. key — проект и фильтр:
// его смена начинает список заново. Перечитывание (reload, события)
// применяет только последний ответ и сливает первую страницу с показанным
// списком. «Ещё» отбрасывается только при смене key, а не при
// перечитывании.
export function usePaged<T extends { id: string }>(
  key: string,
  fetchPage: (before?: string) => Promise<Page<T>> | null,
  after: (a: T, b: T) => boolean,
  tick: number,
) {
  const [page, setPage] = useState<Page<T>>({ rows: [], next: null })
  const [err, setErr] = useState('')
  const gen = useRef(0)
  const listKey = useRef<string | null>(null)
  const seq = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const afterRef = useRef(after)
  afterRef.current = after
  useEffect(() => { gen.current++ }, [key])

  const reload = useCallback(() => {
    const p = fetchRef.current()
    if (!p) return
    const n = ++seq.current
    p.then(head => {
      if (n !== seq.current) return
      const fresh = listKey.current !== key
      listKey.current = key
      setPage(prev => fresh ? head : mergeHead(prev, head, afterRef.current))
      setErr('')
    }).catch(e => { if (n === seq.current) setErr(errText(e)) })
  }, [key])
  useEffect(reload, [reload, tick])

  const more = () => {
    const before = page.next
    if (!before) return
    const p = fetchRef.current(before)
    if (!p) return
    const g = gen.current
    p.then(r => {
      if (g !== gen.current || listKey.current !== key) return // сменился проект или фильтр
      // Перечитывание между запросом и ответом не мешает: строки, уже
      // попавшие в голову, appendPage не повторяет.
      setPage(prev => appendPage(prev, r))
    }).catch(e => { if (g === gen.current) setErr(errText(e)) })
  }
  return { rows: page.rows, next: page.next, err, reload, more }
}
