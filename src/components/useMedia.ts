import { useEffect, useState } from 'react'

// Совпадает ли медиазапрос сейчас; обновляется при изменении окна
// (поворот экрана, ресайз). Без matchMedia — false.
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(query)
    const fn = () => setOn(m.matches)
    fn()
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [query])
  return on
}
