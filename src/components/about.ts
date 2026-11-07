// Ссылка на исходный код работающей версии rivetd (спека source-availability,
// api-contract open-source): версия и адрес берутся у rivetd через
// GET /api/v1/about, а не из сборки консоли. Адрес клиент не вычисляет.

export interface About {
  version: string
  // Полный SHA коммита сборки; пусто, если неизвестен.
  commit?: string
  source_url: string
  // Куда ведёт ссылка: тег, коммит или корень репозитория.
  source_ref_url: string
  license: string
}

// Подпись ссылки. Сборка без версии (dev) так и называется, а не
// притворяется версией.
export function sourceLabel(a: Pick<About, 'version'>): string {
  const v = (a.version ?? '').trim()
  return `Исходный код · ${!v || v === 'dev' ? 'сборка без версии' : v}`
}

// Адрес ссылки: только http(s). Адрес задаёт настройка установки
// (RIVET_SOURCE_URL), а javascript: в href исполнился бы по клику.
export function sourceHref(a: Pick<About, 'source_ref_url'>): string | null {
  try {
    const u = new URL(a.source_ref_url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

// Ответ API или null, если это не сведения о сборке.
export function parseAbout(data: unknown): About | null {
  const d = data as Partial<About> | null
  if (!d || typeof d !== 'object' || typeof d.version !== 'string' || typeof d.source_ref_url !== 'string') return null
  return {
    version: d.version,
    commit: typeof d.commit === 'string' ? d.commit : '',
    source_url: typeof d.source_url === 'string' ? d.source_url : '',
    source_ref_url: d.source_ref_url,
    license: typeof d.license === 'string' ? d.license : '',
  }
}

// Сведения о сборке без входа. Ошибка сети или старый rivetd (401, 404)
// дают null: ссылки нет, экран работает как прежде. Запрос идёт мимо общего
// клиента API: его 401 выкинул бы вошедшего пользователя на экран входа.
export async function fetchAbout(): Promise<About | null> {
  try {
    const resp = await fetch('/api/v1/about', { credentials: 'omit' })
    if (!resp.ok) return null
    return parseAbout(await resp.json())
  } catch {
    return null
  }
}
