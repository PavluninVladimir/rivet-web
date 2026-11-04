import { parseMarkdown, type Inline } from './markdownLite'

function Inl({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => {
    if (p.t === 'code') return <code key={i} className="mono">{p.v}</code>
    if (p.t === 'bold') return <b key={i}>{p.v}</b>
    if (p.t === 'link') return <a key={i} href={p.href} target={p.href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{p.v}</a>
    return <span key={i}>{p.v}</span>
  })}</>
}

// Markdown release notes и описаний без HTML (см. markdownLite).
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'h': {
            const H = (['h3', 'h4', 'h5'] as const)[b.level - 1]
            return <H key={i}><Inl parts={b.text} /></H>
          }
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inl parts={it} /></li>)}</ul>
          case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inl parts={it} /></li>)}</ol>
          case 'code': return <pre key={i} className="term">{b.text}</pre>
          default: return <p key={i}><Inl parts={b.text} /></p>
        }
      })}
    </div>
  )
}
