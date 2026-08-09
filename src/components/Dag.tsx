import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '../api/client'
import { StBadge } from './ui'

// Слоевая раскладка DAG — перенос алгоритма эталонного прототипа:
// слой узла = 1 + max(слой зависимостей), слои центрируются по вертикали.
const NW = 204, NH = 66, GX = 64, GY = 16, PAD = 28

interface Layout {
  pos: Map<string, { x: number; y: number }>
  w: number
  h: number
}

function layout(tasks: Task[]): Layout {
  const byId = new Map(tasks.map(t => [t.ID, t]))
  const memo = new Map<string, number>()
  const level = (t: Task): number => {
    const cached = memo.get(t.ID)
    if (cached !== undefined) return cached
    memo.set(t.ID, 0) // защита от циклов (бэкенд их не пропускает)
    const deps = (t.Deps ?? []).map(d => byId.get(d)).filter((x): x is Task => !!x)
    const l = deps.length ? 1 + Math.max(...deps.map(level)) : 0
    memo.set(t.ID, l)
    return l
  }
  const layers = new Map<number, Task[]>()
  for (const t of tasks) {
    const l = level(t)
    if (!layers.has(l)) layers.set(l, [])
    layers.get(l)!.push(t)
  }
  const maxCount = Math.max(1, ...[...layers.values()].map(a => a.length))
  const maxH = maxCount * NH + (maxCount - 1) * GY
  const pos = new Map<string, { x: number; y: number }>()
  for (const [li, arr] of layers) {
    const totalH = arr.length * NH + (arr.length - 1) * GY
    arr.forEach((t, i) => {
      pos.set(t.ID, { x: PAD + li * (NW + GX), y: PAD + (maxH - totalH) / 2 + i * (NH + GY) })
    })
  }
  const nLayers = Math.max(1, layers.size)
  return { pos, w: PAD * 2 + nLayers * NW + (nLayers - 1) * GX, h: PAD * 2 + maxH }
}

// Критический путь: самая «тяжёлая» по оценкам цепочка зависимостей.
function criticalPath(tasks: Task[]): Set<string> {
  const byId = new Map(tasks.map(t => [t.ID, t]))
  const memo = new Map<string, { w: number; prev: string | null }>()
  const weight = (t: Task): { w: number; prev: string | null } => {
    const cached = memo.get(t.ID)
    if (cached) return cached
    memo.set(t.ID, { w: t.Estimate, prev: null })
    let best: { w: number; prev: string | null } = { w: 0, prev: null }
    for (const d of t.Deps ?? []) {
      const dep = byId.get(d)
      if (!dep) continue
      const dw = weight(dep)
      if (dw.w > best.w) best = { w: dw.w, prev: d }
    }
    const r = { w: t.Estimate + best.w, prev: best.prev }
    memo.set(t.ID, r)
    return r
  }
  let endId: string | null = null, max = -1
  for (const t of tasks) {
    const { w } = weight(t)
    if (w > max) { max = w; endId = t.ID }
  }
  const path = new Set<string>()
  while (endId) {
    path.add(endId)
    endId = memo.get(endId)?.prev ?? null
  }
  return path
}

export type DagFilter = 'all' | 'active' | 'review' | 'blocked' | 'done'
const MATCH: Record<DagFilter, (t: Task) => boolean> = {
  all: () => true,
  active: t => ['running', 'testing', 'fixing', 'ready', 'queued'].includes(t.Status),
  review: t => t.Status === 'review',
  blocked: t => ['blocked', 'failed'].includes(t.Status),
  done: t => t.Status === 'done',
}

export function Dag({ tasks, filter, hideDone, showCP, selected, onSelect }: {
  tasks: Task[]
  filter: DagFilter
  hideDone: boolean
  showCP: boolean
  selected?: string
  onSelect: (id: string) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const lay = useMemo(() => layout(tasks), [tasks])
  const cp = useMemo(() => (showCP ? criticalPath(tasks) : new Set<string>()), [tasks, showCP])
  const visible = useMemo(() => {
    const v = new Map<string, boolean>()
    for (const t of tasks) v.set(t.ID, MATCH[filter](t) && !(hideDone && t.Status === 'done'))
    return v
  }, [tasks, filter, hideDone])

  const fit = () => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return
    const k = Math.min((r.width - 24) / lay.w, (r.height - 24) / lay.h, 1.15)
    setView({ k, x: (r.width - lay.w * k) / 2, y: (r.height - lay.h * k) / 2 })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [lay.w, lay.h])

  const zoomAt = (f: number, px: number, py: number) => {
    setView(v => {
      const k2 = Math.min(2.2, Math.max(0.3, v.k * f))
      const ff = k2 / v.k
      return { k: k2, x: px - (px - v.x) * ff, y: py - (py - v.y) * ff }
    })
  }

  const byId = new Map(tasks.map(t => [t.ID, t]))

  return (
    <>
      <div className="dag-canvas" ref={canvasRef}
        onWheel={e => {
          const r = canvasRef.current!.getBoundingClientRect()
          zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top)
        }}
        onPointerDown={e => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          canvasRef.current?.classList.add('panning')
        }}
        onPointerMove={e => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x, dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
          setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
        }}
        onPointerUp={e => {
          const wasDrag = drag.current?.moved
          drag.current = null
          canvasRef.current?.classList.remove('panning')
          if (!wasDrag) {
            const n = (e.target as HTMLElement).closest('.node') as HTMLElement | null
            if (n?.dataset.task) onSelect(n.dataset.task)
          }
        }}>
        <div className="dag-world" style={{
          width: lay.w, height: lay.h,
          transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`,
        }}>
          <svg width={lay.w} height={lay.h}>
            {tasks.flatMap(t => (t.Deps ?? []).map(d => {
              const a = lay.pos.get(d), b = lay.pos.get(t.ID)
              if (!a || !b) return null
              const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2
              const dim = !(visible.get(d) && visible.get(t.ID))
              const isCP = showCP && cp.has(d) && cp.has(t.ID)
              const cls = 'edge'
                + (t.Status === 'blocked' ? ' to-blocked' : '')
                + (isCP ? ' cp-edge' : '') + (dim ? ' dim' : '')
              return <path key={`${d}-${t.ID}`} className={cls}
                d={`M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} />
            }))}
          </svg>
          {tasks.map(t => {
            const p = lay.pos.get(t.ID)!
            const who = t.RunnerID || (byId.get(t.ID)?.BlockReason ? '⚠' : '—')
            return (
              <button key={t.ID} className={'node'
                  + (visible.get(t.ID) ? '' : ' dim')
                  + (selected === t.ID ? ' sel' : '')
                  + (showCP && cp.has(t.ID) ? ' cp' : '')}
                data-status={t.Status} data-task={t.ID}
                style={{ left: p.x, top: p.y }}>
                <span className="n-top"><span className="n-id">task-{t.Num}</span><StBadge s={t.Status} /></span>
                <span className="n-title">{t.Title}</span>
                <span className="n-meta"><span>{who}</span><span>{t.AttemptUsed > 0 ? `${t.AttemptUsed}/${t.AttemptLimit}` : ''}</span></span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
