// Разбор Markdown release notes и описаний инцидентов (add-sdlc-cycle):
// заголовки, списки, блоки кода с ограждением, абзацы и строчная
// разметка (ссылки, жирный, код). Без HTML: текст рендерится React-ом,
// поэтому разметка из ответа модели не может внедрить элементы.

export type Inline = { t: 'text' | 'code' | 'bold'; v: string } | { t: 'link'; v: string; href: string }
export type Block =
  | { t: 'h'; level: 1 | 2 | 3; text: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'code'; text: string }
  | { t: 'p'; text: Inline[] }

const SAFE_URL = /^(https?:\/\/|#\/)/

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'bold', v: m[2] })
    else if (SAFE_URL.test(m[4])) out.push({ t: 'link', v: m[3], href: m[4] })
    else out.push({ t: 'text', v: m[3] })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^(`{3,})/)
    if (fence) {
      flush()
      const close = fence[1]
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith(close); i++) body.push(lines[i])
      out.push({ t: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flush()
      out.push({ t: 'h', level: h[1].length as 1 | 2 | 3, text: parseInline(h[2]) })
      continue
    }
    const li = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/)
    if (li) {
      flush()
      const kind = li[1] ? 'ol' : 'ul'
      const prev = out[out.length - 1]
      if (prev && prev.t === kind) prev.items.push(parseInline(li[2]))
      else out.push({ t: kind, items: [parseInline(li[2])] })
      continue
    }
    if (!line.trim() || /^<\/?(details|summary)/.test(line.trim())) { flush(); continue }
    para.push(line.trim())
  }
  flush()
  return out
}
