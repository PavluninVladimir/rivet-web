// Безопасный разбор Markdown для HLD и тел ADR (add-architecture-c4,
// add-architecture-erd-sequence-adr): блоки и строчная разметка в дерево
// без HTML. Теги в тексте остаются текстом, HTML-комментарии убираются,
// ссылки проверяет отрисовка. Без React, чтобы проверяться юнит-тестом.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: { depth: number; c: Inline[] }[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' }

// Регэкспы блоков применяются к обрезанной строке и не содержат соседних
// \s* по краям: иначе разбор длинной строки пробелов квадратичен.
const FENCE = /^(```|~~~)[ \t]*([\w+-]*)$/
// Заголовок без ленивых квантификаторов и хвоста «\s*#*\s*$»: такой
// регэксп перебирает разбиения кубически и вешает вкладку на строке из
// тысяч пробелов. Завершающие «#» снимаются кодом.
const HEADING = /^(#{1,6})[ \t]+(.*)$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const HR = /^([-*_])(?:[ \t]*\1){2,}$/
const TABLE_SEP = /^\|?[ \t]*:?-{2,}:?(?:[ \t]*\|[ \t]*:?-{2,}:?)*[ \t]*\|?$/
const fenceOf = (line: string) => FENCE.exec(line.trim())

// Ячейки строки таблицы: разделитель — неэкранированная «|».
function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (s[i] === '|') { out.push(cur.trim()); cur = ''; continue }
    cur += s[i]
  }
  out.push(cur.trim())
  return out
}

// Убирает HTML-комментарии вне блоков кода: в HLD это пометка генератора.
function stripComments(lines: string[]): string[] {
  const out: string[] = []
  let fence = false, comment = false
  for (const raw of lines) {
    if (!comment && fenceOf(raw)) { fence = !fence; out.push(raw); continue }
    if (fence) { out.push(raw); continue }
    let line = raw, kept = ''
    while (line) {
      if (comment) {
        const end = line.indexOf('-->')
        if (end < 0) { line = ''; break }
        comment = false; line = line.slice(end + 3)
      } else {
        const start = line.indexOf('<!--')
        if (start < 0) { kept += line; break }
        kept += line.slice(0, start); comment = true; line = line.slice(start + 4)
      }
    }
    // Строка, где был только комментарий, не рвёт абзац пустой строкой.
    if (kept.trim() || raw.trim() === '') out.push(kept)
  }
  return out
}

// Текст заголовка без завершающих «#» (только если перед ними пробел,
// как в CommonMark: «C#» остаётся).
function headingText(s: string): string {
  let t = s.trimEnd()
  let i = t.length
  while (i > 0 && t[i - 1] === '#') i--
  if (i < t.length && (i === 0 || t[i - 1] === ' ' || t[i - 1] === '\t')) t = t.slice(0, i).trimEnd()
  return t
}

export function parseMarkdown(text: string): Block[] {
  const lines = stripComments((text ?? '').replace(/\r\n?/g, '\n').split('\n'))
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = fenceOf(line)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !(lines[i].trim().startsWith(fence[1]) && lines[i].trim().replace(/[`~]/g, '') === ''); i++) body.push(lines[i])
      blocks.push({ t: 'code', lang: fence[2].toLowerCase(), v: body.join('\n') + (body.length ? '\n' : '') })
      continue
    }
    if (!line.trim()) { flush(); continue }
    const h = HEADING.exec(line)
    if (h) { flush(); blocks.push({ t: 'h', level: h[1].length, c: parseInline(headingText(h[2])) }); continue }
    if (HR.test(line.trim())) { flush(); blocks.push({ t: 'hr' }); continue }
    if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      flush()
      const head = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i].trimStart().startsWith('|'); i++) rows.push(cells(lines[i]).map(parseInline))
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }
    const li = LIST.exec(line)
    if (li) {
      flush()
      const ordered = /\d/.test(li[2])
      const items: { depth: number; c: Inline[] }[] = []
      const base = li[1].length
      let cur: { depth: number; text: string } | null = null
      const push = () => { if (cur) items.push({ depth: cur.depth, c: parseInline(cur.text) }) }
      for (; i < lines.length; i++) {
        const m = LIST.exec(lines[i])
        if (m) { push(); cur = { depth: Math.min(4, Math.max(0, Math.floor((m[1].length - base) / 2))), text: m[3] }; continue }
        // Продолжение пункта — строка с отступом без маркера.
        if (cur && lines[i].trim() && /^\s+/.test(lines[i]) && !fenceOf(lines[i])) { cur.text += ' ' + lines[i].trim(); continue }
        break
      }
      push(); i--
      blocks.push({ t: 'list', ordered, items })
      continue
    }
    if (line.trimStart().startsWith('>')) {
      flush()
      const q: string[] = []
      for (; i < lines.length && lines[i].trimStart().startsWith('>'); i++) q.push(lines[i].trimStart().replace(/^>\s?/, ''))
      i--
      blocks.push({ t: 'quote', c: parseInline(q.join(' ')) })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return blocks
}

// Строчная разметка: `код`, **жирный**, *курсив*, [ссылка](адрес), голые
// http(s)-адреса и экранирование «\».
//
// Разбор линейный: пары скобок, бэктиков и закрывающие «)» находятся
// одним проходом заранее, а не поиском с каждой позиции. Вложенность
// жирного, курсива и ссылок ограничена: глубже — текст, иначе тысячи
// вложенных «[» переполняют стек. Строка длиннее лимита остаётся текстом.
export const MAX_INLINE_DEPTH = 32
export const MAX_INLINE_LENGTH = 20000
const ESCAPABLE = /[\\`*_[\]()#|<>!~-]/
const BARE_URL = /https?:\/\/[^\s)<>]+/y

export function parseInline(s: string, depth = 0): Inline[] {
  if (s.length > MAX_INLINE_LENGTH || depth >= MAX_INLINE_DEPTH) return s ? [{ t: 'text', v: s }] : []
  const n = s.length
  // Пары квадратных скобок с учётом экранирования.
  const closeOf = new Int32Array(n).fill(-1)
  const stack: number[] = []
  for (let i = 0; i < n; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '[') stack.push(i)
    else if (s[i] === ']' && stack.length) closeOf[stack.pop()!] = i
  }
  // Ближайшая «)» начиная с позиции.
  const nextParen = new Int32Array(n + 1).fill(-1)
  for (let i = n - 1; i >= 0; i--) nextParen[i] = s[i] === ')' ? i : nextParen[i + 1]
  // Серии бэктиков: для каждой — следующая серия той же длины.
  const runAt = new Map<number, { len: number; next: number }>()
  const runs: { start: number; len: number }[] = []
  for (let i = 0; i < n;) {
    if (s[i] !== '`') { i++; continue }
    let j = i
    while (j < n && s[j] === '`') j++
    runs.push({ start: i, len: j - i })
    i = j
  }
  const lastOfLen = new Map<number, number>()
  for (let k = runs.length - 1; k >= 0; k--) {
    runAt.set(runs[k].start, { len: runs[k].len, next: lastOfLen.get(runs[k].len) ?? -1 })
    lastOfLen.set(runs[k].len, runs[k].start)
  }

  const out: Inline[] = []
  let text = ''
  const pushText = () => { if (text) out.push({ t: 'text', v: text }); text = '' }
  for (let i = 0; i < n;) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < n && ESCAPABLE.test(s[i + 1])) { text += s[i + 1]; i += 2; continue }
    if (ch === '`') {
      const run = runAt.get(i)
      if (run) {
        if (run.next > 0) {
          const body = s.slice(i + run.len, run.next)
          pushText(); out.push({ t: 'code', v: body.trim() || body }); i = run.next + run.len; continue
        }
        // Серия без пары — текстом целиком.
        text += s.slice(i, i + run.len); i += run.len; continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] === ch) {
      const end = s.indexOf(ch + ch, i + 2)
      if (end > i + 2) { pushText(); out.push({ t: 'strong', c: parseInline(s.slice(i + 2, end), depth + 1) }); i = end + 2; continue }
    }
    // Курсив только звёздочкой: «_» внутри идентификаторов (snake_case) не трогаем.
    if (ch === '*' && s[i + 1] && s[i + 1] !== ' ') {
      const end = s.indexOf('*', i + 1)
      if (end > i + 1 && s[end - 1] !== ' ') { pushText(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, end), depth + 1) }); i = end + 1; continue }
    }
    if (ch === '[') {
      const close = closeOf[i]
      if (close > 0 && s[close + 1] === '(') {
        const end = nextParen[close + 2] ?? -1
        if (end > 0) {
          pushText()
          const href = s.slice(close + 2, end).trim().split(/\s+/)[0] ?? ''
          out.push({ t: 'link', href, c: parseInline(s.slice(i + 1, close), depth + 1) })
          i = end + 1
          continue
        }
      }
    }
    if (ch === 'h' && (i === 0 || /[\s(]/.test(s[i - 1])) && (s.startsWith('http://', i) || s.startsWith('https://', i))) {
      BARE_URL.lastIndex = i
      const m = BARE_URL.exec(s)
      if (m) {
        const url = m[0].replace(/[.,;:!?]+$/, '')
        pushText(); out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] }); i += url.length; continue
      }
    }
    text += ch; i++
  }
  pushText()
  return out
}

// Внешняя ссылка допустима только по http(s) и mailto. Относительная
// (без схемы) уходит в resolveLink отрисовки. Остальное — текст.
export function linkKind(href: string): 'external' | 'relative' | 'unsafe' {
  const h = href.trim()
  if (/^(https?:|mailto:)/i.test(h)) return 'external'
  // Схема любого вида (javascript:, data:, vbscript:) и адрес без схемы
  // с «//» не пропускаются.
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('\\')) return 'unsafe'
  return 'relative'
}

export function inlineText(c: Inline[]): string {
  return c.map(x => x.t === 'text' || x.t === 'code' ? x.v : inlineText(x.c)).join('')
}
