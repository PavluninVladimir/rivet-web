import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { diagramKind } from './archModel'
import { ChunkNotice, ErrorBoundary, isChunkError, reloadForChunk } from './ErrorBoundary'

// Отрисовка Mermaid (add-architecture-c4, design «Консоль»): библиотека
// грузится динамическим импортом только там, где есть схемы, и не
// раздувает основной бандл, встроенный в rivetd. Тема строится из
// CSS-токенов консоли: Mermaid не разбирает oklch, поэтому токены
// приводятся к rgb через пиксель canvas. Если схему нарисовать не удалось,
// вместо неё показывается исходный текст с причиной.

type MermaidAPI = typeof import('mermaid').default

let loader: Promise<MermaidAPI> | null = null
let seq = 0
// Готовые SVG по исходному тексту: переключение вкладок и уровней не
// перерисовывает схему заново.
const cache = new Map<string, string>()
const CACHE_MAX = 80

let probe: { el: HTMLElement; ctx: CanvasRenderingContext2D } | null = null

// Цвет CSS (oklch, color-mix, var()) в #rrggbb: браузер вычисляет цвет
// элемента, canvas переводит его в sRGB.
function cssHex(value: string, fallback: string): string {
  try {
    if (!probe) {
      const el = document.createElement('span')
      el.style.display = 'none'
      document.body.appendChild(el)
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return fallback
      probe = { el, ctx }
    }
    probe.el.style.color = ''
    probe.el.style.color = value
    const resolved = getComputedStyle(probe.el).color
    if (!resolved) return fallback
    const { ctx } = probe
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = resolved
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) return fallback
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return fallback
  }
}

function themeConfig() {
  const t = (name: string, fb: string) => cssHex(`var(${name})`, fb)
  const mix = (a: string, pct: number, b: string, fb: string) => cssHex(`color-mix(in oklch, var(${a}) ${pct}%, var(${b}))`, fb)
  const bg = t('--bg', '#14161a'), surface = t('--surface', '#1a1d22'), raised = t('--raised', '#272a30')
  const fg = t('--fg', '#e6e8eb'), muted = t('--muted', '#8d939c'), border = t('--border', '#2c3038')
  const accent = t('--accent', '#4f9cf0'), review = t('--c-review', '#d7b24c')
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'

  // C4: внутренние элементы — оттенки акцента от людей к компонентам,
  // внешние — приглушённые. Текст узлов Mermaid рисует белым.
  const inner = (pct: number) => mix('--accent', pct, '--bg', accent)
  const outer = (pct: number) => mix('--muted', pct, '--bg', muted)
  const c4: Record<string, string | boolean | number> = { useMaxWidth: true, wrap: true }
  const kinds: [string, string, string][] = [
    ['person', inner(46), accent], ['system', inner(38), accent], ['container', inner(28), accent], ['component', inner(18), accent],
    ['external_person', outer(34), muted], ['external_system', outer(28), muted], ['external_container', outer(22), muted], ['external_component', outer(16), muted],
  ]
  for (const [k, bgc, bd] of kinds) {
    c4[`${k}_bg_color`] = bgc
    c4[`${k}_border_color`] = bd
    if (!k.endsWith('person')) {
      c4[`${k}_db_bg_color`] = bgc; c4[`${k}_db_border_color`] = bd
      c4[`${k}_queue_bg_color`] = bgc; c4[`${k}_queue_border_color`] = bd
    }
  }
  for (const k of ['person', 'external_person', 'system', 'external_system', 'container', 'external_container', 'component', 'external_component']) {
    c4[`${k}FontFamily`] = font
  }
  for (const k of ['message', 'boundary']) c4[`${k}FontFamily`] = font

  return {
    // Ключи, которые директива %%{init}%% и front matter config: в тексте
    // схемы не могут переопределить. Имена элементов приходят из описания
    // в репозитории: без этого списка themeCSS из имени попадает в <style>
    // схемы (внешний запрос при просмотре, спрятанные подписи).
    secure: [
      'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'dompurifyConfig',
      'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'darkMode', 'look', 'htmlLabels',
      'c4', 'sequence', 'er', 'flowchart', 'markdownAutoWrap', 'arrowMarkerAbsolute',
    ],
    // Подписи ER и flowchart — HTML: strict чистит их DOMPurify, но по
    // умолчанию он оставляет <img src> и style, а это внешний запрос при
    // просмотре схемы. Запрещаем всё, что грузит ресурсы или задаёт стиль.
    dompurifyConfig: {
      FORBID_TAGS: ['style', 'img', 'image', 'svg', 'math', 'video', 'audio', 'source', 'picture', 'iframe', 'object', 'embed',
        'link', 'meta', 'form', 'input'],
      FORBID_ATTR: ['style', 'src', 'srcset', 'href', 'xlink:href', 'background', 'poster'],
    },
    startOnLoad: false,
    securityLevel: 'strict' as const,
    suppressErrorRendering: true,
    theme: 'base' as const,
    darkMode: true,
    fontFamily: font,
    themeVariables: {
      darkMode: true, background: bg, fontFamily: font, fontSize: '13px',
      primaryColor: raised, primaryTextColor: fg, primaryBorderColor: muted,
      secondaryColor: surface, tertiaryColor: surface, lineColor: muted, textColor: fg,
      mainBkg: raised, nodeBorder: muted, clusterBkg: surface, clusterBorder: border,
      titleColor: fg, edgeLabelBackground: surface,
      // sequence
      actorBkg: inner(28), actorBorder: accent, actorTextColor: fg, actorLineColor: muted,
      signalColor: fg, signalTextColor: fg, labelBoxBkgColor: surface, labelBoxBorderColor: muted,
      labelTextColor: fg, loopTextColor: fg, noteBkgColor: mix('--c-review', 18, '--bg', review),
      noteTextColor: fg, noteBorderColor: review, activationBkgColor: raised, activationBorderColor: muted,
      sequenceNumberColor: bg,
      // er
      attributeBackgroundColorOdd: surface, attributeBackgroundColorEven: raised,
    },
    c4,
    er: { useMaxWidth: true },
    sequence: { useMaxWidth: true, mirrorActors: false, wrap: true },
  }
}

export function loadMermaid(): Promise<MermaidAPI> {
  if (!loader) {
    loader = import('mermaid').then(m => {
      const mm = m.default
      mm.initialize(themeConfig())
      return mm
    }).catch(e => { loader = null; throw e })
  }
  return loader
}

export async function renderMermaid(code: string): Promise<string> {
  const hit = cache.get(code)
  if (hit) return hit
  const mm = await loadMermaid()
  const id = `mmd-${++seq}`
  try {
    const { svg } = await mm.render(id, code)
    cache.set(code, svg)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
    return svg
  } finally {
    // При ошибке Mermaid оставляет временный узел в body.
    document.getElementById('d' + id)?.remove()
  }
}

// Mermaid C4 оставляет справа и сверху много пустого места, и схема
// ужимается по ширине до нечитаемого. viewBox подрезается по содержимому.
// Заголовок C4 Mermaid ставит высоко над схемой: он убирается, консоль
// показывает его сама (крошки, заголовок раздела).
function fitViewBox(s: SVGSVGElement, kind: string) {
  try {
    if (kind === 'c4') s.querySelectorAll(':scope > text').forEach(t => t.remove())
    const bb = s.getBBox()
    if (!bb.width || !bb.height) return
    const pad = 12
    const w = Math.ceil(bb.width + pad * 2), h = Math.ceil(bb.height + pad * 2)
    s.setAttribute('viewBox', `${Math.floor(bb.x - pad)} ${Math.floor(bb.y - pad)} ${w} ${h}`)
    s.style.maxWidth = `${w}px`
    s.setAttribute('data-natural-width', String(w))
  } catch { /* SVG без размеров (скрытый контейнер) остаётся как есть */ }
}

function reason(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'str' in e) return String((e as { str: unknown }).str)
  return String(e)
}

// Текст узла для подписи: строки tspan через пробел, иначе они слипаются
// («Менеджер попродажам»).
function nodeText(n: Element): string {
  const parts = [...n.querySelectorAll('tspan')].map(t => t.textContent ?? '')
  return (parts.length ? parts.join(' ') : n.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// chunk — не загрузился чанк Mermaid (после обновления rivetd старых
// хэшей нет): вместо исходника подсказка перезагрузить страницу.
export function MermaidError({ code, why, chunk }: { code: string; why: string; chunk?: boolean }) {
  if (chunk) return <ChunkNotice what="схему" />
  return (
    <div className="mmd-error" role="alert">
      <div className="mmd-error-head">Схему не удалось отрисовать: <span className="mono">{why}</span></div>
      <pre className="mmd-src">{code}</pre>
    </div>
  )
}

// nodeSelector — какие узлы SVG кликабельны; onNodeClick получает узел.
// decorate вызывается после вставки SVG и при смене decorateKey (выбранный
// элемент), чтобы подсветить узел без перерисовки схемы.
// focusSelector — какие из кликабельных узлов получают фокус с клавиатуры
// (у участника sequence кликабельны и прямоугольник, и подпись, а фокус
// нужен один). По умолчанию — все узлы nodeSelector.
type MermaidProps = {
  code: string
  zoomable?: boolean
  focusSelector?: string
  className?: string
  label?: string
  nodeSelector?: string
  onNodeClick?: (node: Element, svg: SVGSVGElement) => void
  decorate?: (svg: SVGSVGElement) => void
  decorateKey?: string
}

// Сбой подсветки или разметки узлов не роняет экран: схема показывается
// исходным текстом с причиной.
export function Mermaid(p: MermaidProps) {
  return (
    <ErrorBoundary resetKey={p.code} fallback={e => <MermaidError code={p.code} why={reason(e)} chunk={isChunkError(e)} />}>
      <MermaidView {...p} />
    </ErrorBoundary>
  )
}

function MermaidView({ code, className, label, nodeSelector, focusSelector, onNodeClick, decorate, decorateKey, zoomable = true }: MermaidProps) {
  const host = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(() => cache.get(code) ?? null)
  const [err, setErr] = useState('')
  const [chunkErr, setChunkErr] = useState(false)
  const [natural, setNatural] = useState(false)
  const decorateRef = useRef(decorate)
  decorateRef.current = decorate

  useEffect(() => {
    let alive = true
    setErr(''); setChunkErr(false)
    if (!code.trim()) { setSvg(null); return }
    renderMermaid(code).then(
      s => { if (alive) setSvg(s) },
      e => {
        if (!alive) return
        // Чанк схемы не загрузился после обновления rivetd: одна
        // автоматическая перезагрузка, при повторе — подсказка.
        if (isChunkError(e)) {
          if (reloadForChunk()) return
          setChunkErr(true)
        }
        setSvg(null); setErr(reason(e))
      },
    )
    return () => { alive = false }
  }, [code])

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    el.innerHTML = svg ?? ''
    const s = el.querySelector('svg')
    if (!s) return
    fitViewBox(s, diagramKind(code))
    if (!nodeSelector) return
    s.querySelectorAll(nodeSelector).forEach(n => n.classList.add('mmd-node'))
    // Узлы доступны с клавиатуры: Tab, Enter и пробел.
    s.querySelectorAll(focusSelector ?? nodeSelector).forEach(n => {
      n.setAttribute('tabindex', '0')
      n.setAttribute('role', 'button')
      if (!n.getAttribute('aria-label')) n.setAttribute('aria-label', nodeText(n).slice(0, 120))
    })
  }, [svg, nodeSelector, focusSelector])

  useLayoutEffect(() => {
    const s = host.current?.querySelector('svg')
    if (s) decorateRef.current?.(s)
  }, [svg, decorateKey])

  // 1:1 — натуральная ширина с прокруткой, иначе вписать по ширине.
  useLayoutEffect(() => {
    const s = host.current?.querySelector('svg')
    const w = s?.getAttribute('data-natural-width')
    if (!s || !w) return
    s.style.width = natural ? `${w}px` : ''
    s.style.maxWidth = natural ? 'none' : `${w}px`
  }, [svg, natural])

  if (err) return <MermaidError code={code} why={err} chunk={chunkErr} />
  const kind = diagramKind(code)
  return (
    <div className={`mmd-wrap mmd-${kind}` + (natural ? ' natural' : '') + (className ? ' ' + className : '')}>
      {!svg && <div className="mmd-loading muted">рисую схему…</div>}
      {svg && zoomable && (
        <button className="mmd-zoom" title={natural ? 'Вписать схему по ширине' : 'Показать в натуральную величину'}
          onClick={() => setNatural(n => !n)}>{natural ? 'по ширине' : '1:1'}</button>
      )}
      <div className="mmd" ref={host} role={nodeSelector ? 'group' : 'img'} aria-label={label}
        onClick={e => {
          if (!nodeSelector || !onNodeClick) return
          const s = host.current?.querySelector('svg')
          const n = (e.target as Element).closest(nodeSelector)
          if (s && n && s.contains(n)) onNodeClick(n, s)
        }}
        onKeyDown={e => {
          if (!nodeSelector || !onNodeClick || (e.key !== 'Enter' && e.key !== ' ')) return
          const s = host.current?.querySelector('svg')
          const n = (e.target as Element).closest(nodeSelector)
          if (s && n && s.contains(n)) { e.preventDefault(); onNodeClick(n, s) }
        }} />
    </div>
  )
}
