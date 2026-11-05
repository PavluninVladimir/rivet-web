import { useMemo, type ReactNode } from 'react'
import { linkKind, parseMarkdown, type Block, type Inline } from './mdParse'
import { ErrorBoundary } from './ErrorBoundary'

// Отрисовка безопасного Markdown: дерево разбора в элементы React, HTML
// не вставляется никогда. Относительные ссылки разворачивает resolveLink
// (файл на хостинге), без него они остаются текстом. renderCode позволяет
// показать блок mermaid схемой.
type MdProps = {
  text: string
  resolveLink?: (href: string) => string
  renderCode?: (lang: string, code: string) => ReactNode | null
  className?: string
}

// Документ, который не удалось разобрать, показывается исходным текстом.
export function DocMarkdown(p: MdProps) {
  return (
    <ErrorBoundary resetKey={p.text} fallback={() => <pre className="md-code" role="alert">{p.text}</pre>}>
      <MarkdownDoc {...p} />
    </ErrorBoundary>
  )
}

function MarkdownDoc({ text, resolveLink, renderCode, className }: MdProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className={'doc-md' + (className ? ' ' + className : '')}>{blocks.map((b, i) => <BlockView key={i} b={b} resolveLink={resolveLink} renderCode={renderCode} />)}</div>
}

function BlockView({ b, resolveLink, renderCode }: {
  b: Block
  resolveLink?: (href: string) => string
  renderCode?: (lang: string, code: string) => ReactNode | null
}) {
  const inl = (c: Inline[]) => <Inlines c={c} resolveLink={resolveLink} />
  switch (b.t) {
    case 'h': {
      const H = (`h${Math.min(6, b.level + 1)}`) as 'h2'
      return <H className={`md-h md-h${b.level}`}>{inl(b.c)}</H>
    }
    case 'p': return <p>{inl(b.c)}</p>
    case 'quote': return <blockquote>{inl(b.c)}</blockquote>
    case 'hr': return <hr />
    case 'code': {
      const custom = renderCode?.(b.lang, b.v)
      if (custom) return <>{custom}</>
      return <pre className="md-code">{b.v}</pre>
    }
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul'
      return <L>{b.items.map((it, i) => <li key={i} style={it.depth ? { marginLeft: it.depth * 18 } : undefined}>{inl(it.c)}</li>)}</L>
    }
    case 'table':
      return (
        <div className="md-table">
          <table className="tbl">
            <thead><tr>{b.head.map((h, i) => <th key={i}>{inl(h)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inl(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
  }
}

function Inlines({ c, resolveLink }: { c: Inline[]; resolveLink?: (href: string) => string }) {
  return <>{c.map((x, i) => {
    switch (x.t) {
      case 'text': return <span key={i}>{x.v}</span>
      case 'code': return <code key={i}>{x.v}</code>
      case 'strong': return <strong key={i}><Inlines c={x.c} resolveLink={resolveLink} /></strong>
      case 'em': return <em key={i}><Inlines c={x.c} resolveLink={resolveLink} /></em>
      case 'link': {
        const kind = linkKind(x.href)
        const href = kind === 'external' ? x.href : kind === 'relative' ? resolveLink?.(x.href) ?? '' : ''
        // Итоговый адрес снова проверяется: resolveLink мог вернуть что угодно.
        if (!href || linkKind(href) !== 'external') return <span key={i}><Inlines c={x.c} resolveLink={resolveLink} /></span>
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer"><Inlines c={x.c} resolveLink={resolveLink} /></a>
      }
    }
  })}</>
}
