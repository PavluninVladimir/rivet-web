import { useCallback, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { stColor, type ResolvedProcess, type StepTransition } from '../api/client'
import { KIND_COLOR } from './ProcessGraph'
import { COMPACT_SIZE, layoutProcess } from './processLayout'
import { edgeLabel, stepState, stepTitle, taskProcessView } from './taskProcess'

// Компактный граф процесса задачи в деталке (fix-web-console-tails, спека
// web «Процесс задачи в деталке»): шаги снимка процесса задачи, текущий шаг
// цветом статуса, пройденные с отметкой, рёбра ok по хребту, а возвраты и
// эскалации только пройденные, с числом повторов. Только просмотр: окон,
// перетаскивания и «+» редактора здесь нет (design, решение 3).

// Граф ужимается под ширину деталки до этого масштаба, дальше прокрутка.
const MIN_SCALE = 0.8
// Сколько символов названия влезает в узел компактной раскладки.
const TITLE_MAX = 11

function clip(s: string): string {
  return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1) + '…' : s
}

const STATE_LABEL = { current: 'текущий', passed: 'пройден', ahead: 'впереди' }

export function TaskProcessGraph({ process, history, step, status }: {
  process: ResolvedProcess | null | undefined
  history: StepTransition[] | null | undefined
  step: string
  status: string
}) {
  const uid = useId().replace(/:/g, '')
  const view = useMemo(() => taskProcessView(process, history, step, status), [process, history, step, status])
  const lay = useMemo(() => (view ? layoutProcess(view.doc, { size: COMPACT_SIZE, keep: view.keep }) : null), [view])
  // Ширина контейнера: граф появляется после загрузки задачи, поэтому
  // наблюдатель вешается ref-колбэком, а не эффектом монтирования.
  const [boxW, setBoxW] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    ro.current = new ResizeObserver(entries => setBoxW(entries[0].contentRect.width))
    ro.current.observe(el)
  }, [])

  if (!view || !lay) return null
  const scale = boxW && lay.w > boxW ? Math.max(MIN_SCALE, boxW / lay.w) : 1
  const S = COMPACT_SIZE
  const stVar = `var(${stColor[status] ?? '--accent'})`

  return (
    <div className="dw-sec" data-task-process>
      <h3>Процесс</h3>
      <div className="tpg-wrap" ref={rootRef}>
        <svg className="tpg" width={Math.round(lay.w * scale)} height={Math.round(lay.h * scale)}
          viewBox={`0 0 ${lay.w} ${lay.h}`} role="img" aria-label={`Процесс задачи. ${view.summary}`}>
          <defs>
            {(['ok', 'changes', 'fail', 'idle'] as const).map(o => (
              <marker key={o} id={`${uid}-m-${o}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className={'tpg-arrow ' + o} />
              </marker>
            ))}
          </defs>

          {lay.edges.map(e => {
            const n = view.taken.get(e.id) ?? 0
            // В «готово» задача приходит и подтверждением merge мимо шагов.
            const walked = n > 0 || (view.done && e.outcome === 'ok')
            const cls = walked ? e.outcome : 'idle'
            return (
              <g key={e.id} className={'tpg-edge ' + cls} data-edge={e.id} data-taken={n || undefined}>
                <path d={e.d} markerEnd={`url(#${uid}-m-${cls})`} />
                {e.outcome !== 'ok' && (
                  <text x={e.lx} y={e.ly} textAnchor="middle">{edgeLabel(view, e.id, e.outcome)}</text>
                )}
              </g>
            )
          })}

          {lay.nodes.filter(nd => nd.kind === 'step').map(nd => {
            const s = nd.step!
            const st = stepState(view, s.id)
            const title = stepTitle(s)
            return (
              <g key={s.id} className={'tpg-node ' + st} data-step={s.id} data-state={st}
                style={st === 'current' ? { '--st': stVar } as CSSProperties : undefined}>
                <title>{`${nd.index + 1}. ${title} · ${s.kind} · ${STATE_LABEL[st]}`}</title>
                <rect className="box" x={nd.x} y={nd.y} width={nd.w} height={nd.h} rx={5} />
                <rect className="bar" x={nd.x} y={nd.y + 5} width={2.5} height={nd.h - 10} rx={1.25}
                  style={{ fill: st === 'passed' ? 'var(--c-done)' : KIND_COLOR[s.kind] ?? 'var(--accent)' }} />
                <text className="k" x={nd.x + 7} y={nd.y + 12}>{`${nd.index + 1} ${s.kind}`}</text>
                {st === 'passed' && <text className="mark" x={nd.x + nd.w - 7} y={nd.y + 12} textAnchor="end">✓</text>}
                <text className="t" x={nd.x + 7} y={nd.y + S.nh - 10}>{clip(title)}</text>
              </g>
            )
          })}

          {lay.nodes.filter(nd => nd.kind !== 'step').map(nd => {
            const reached = nd.kind === 'done' ? view.done : view.escalated
            return (
              <g key={nd.id} className={'tpg-cap ' + nd.kind + (reached ? ' reached' : '')} data-cap={nd.kind}>
                <rect x={nd.x} y={nd.y} width={S.capW} height={S.capH} rx={S.capH / 2} />
                <text x={nd.x + S.capW / 2} y={nd.y + S.capH / 2}>{nd.kind === 'done' ? 'готово' : 'эскалация'}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="tpg-sum muted" data-task-process-summary>{view.summary}</div>
    </div>
  )
}

