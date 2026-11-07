import { useEffect, useState } from 'react'
import { fetchAbout, sourceHref, sourceLabel, type About } from './about'

// Сведения о сборке rivetd для ссылки «Исходный код · версия» (спека
// source-availability, AGPL §13). null, пока ответа нет или если rivetd
// его не дал: тогда ссылки нет вовсе, вместе с её разделом.
export function useAbout(): About | null {
  const [about, setAbout] = useState<About | null>(null)
  useEffect(() => {
    let alive = true
    void fetchAbout().then(a => { if (alive) setAbout(a && sourceHref(a) ? a : null) })
    return () => { alive = false }
  }, [])
  return about
}

// Ссылка под формой входа и в профиле. Вторичный текст на токенах консоли,
// без нового экрана.
export function SourceAnchor({ about }: { about: About }) {
  const href = sourceHref(about)
  if (!href) return null
  const commit = about.commit ? ` · коммит ${about.commit.slice(0, 12)}` : ''
  return (
    <a className="source-link" href={href} target="_blank" rel="noopener noreferrer"
      title={`Лицензия ${about.license || 'AGPL-3.0-only'}${commit}`}>
      {sourceLabel(about)}
    </a>
  )
}

// SourceLink: ссылка со своим запросом сведений о сборке (страница входа).
export function SourceLink() {
  const about = useAbout()
  return about ? <SourceAnchor about={about} /> : null
}
