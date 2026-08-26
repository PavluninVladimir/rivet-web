import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Member, ProcessDoc, ProcessLocks, ProcessStep, Runner } from '../api/client'
import { StepModal, TransitionModal, type StepError } from './StepModal'
import { CAP_H, CAP_W, DEFAULT_TITLE, GX, HAS_PARTICIPANTS, NW, PAD, layoutProcess, type GEdge, type GNode, type Outcome } from './processLayout'

// Граф процесса (add-process-graph-editor, спека web «Редактор процесса»):
// узлы-шаги по хребту, стрелки переходов, терминалы «готово» и «эскалация».
// Свой SVG без библиотек (design решение 1), клик или Enter открывает окно
// шага или перехода, «+» между узлами добавляет шаг, узел тянется вдоль
// хребта. Документ локальный, наверх уходит через onChange.

type Modal = { kind: 'step'; index: number } | { kind: 'new'; at: number } | { kind: 'edge'; stepId: string; outcome: Outcome } | null

const KIND_COLOR: Record<string, string> = {
  code: 'var(--c-run)', test: 'var(--c-test)', review: 'var(--c-review)', prompt: 'var(--accent)', merge: 'var(--c-done)', deploy: 'var(--c-queue)',
}

function participantLabel(p: ProcessStep['participants'] extends (infer T)[] | undefined ? T : never): string {
  if (p.user) return '👤 ' + (p.user.login !== undefined ? (p.user.login || '?') : p.user.role ?? 'owner')
  const a = p.agent ?? {}
  const t = [a.kind, a.model].filter(Boolean).join(' · ')
  return '⚙ ' + (t || 'любой')
}

export function ProcessGraph({ doc, runners, members, locks, readOnly, error, onChange }: {
  doc: ProcessDoc
  runners: Runner[]
  members?: Member[]
  locks?: ProcessLocks | null
  readOnly?: boolean
  error?: StepError | null
  onChange: (doc: ProcessDoc) => void
}) {
  const uid = useId().replace(/:/g, '')
  const lay = useMemo(() => layoutProcess(doc), [doc])
  const [modal, setModal] = useState<Modal>(null)
  const [hi, setHi] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ index: number; dx: number; target: number } | null>(null)
  // Цель перетаскивания живёт в ref: pointerup может прийти раньше рендера с новым state.
  const dragRef = useRef<{ index: number; x0: number; moved: boolean; target: number } | null>(null)
  const lastFocus = useRef<Element | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Граф ужимается под ширину контейнера до 0.72, дальше — прокрутка.
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setBoxW(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = boxW && lay.w > boxW ? Math.max(0.72, boxW / lay.w) : 1
  const svgW = Math.round(lay.w * scale), svgH = Math.round(lay.h * scale)

  // Ошибка сервера с шагом: подсветить узел и открыть его окно.
  const errKey = error ? `${error.step ?? ''}|${error.field ?? ''}|${error.message}` : ''
  useEffect(() => {
    if (!error?.step) return
    const i = doc.steps.findIndex(s => s.id === error.step)
    if (i >= 0) setModal({ kind: 'step', index: i })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errKey])

  const open = (m: Modal, from?: Element | null) => { lastFocus.current = from ?? document.activeElement; setModal(m) }
  const close = () => {
    setModal(null)
    const el = lastFocus.current as HTMLElement | null
    if (el && rootRef.current?.contains(el)) requestAnimationFrame(() => el.focus())
  }

  const update = (i: number, step: ProcessStep) => onChange({ steps: doc.steps.map((s, j) => (j === i ? step : s)) })
  const insert = (at: number, step: ProcessStep) => onChange({ steps: [...doc.steps.slice(0, at), step, ...doc.steps.slice(at)] })
  const remove = (i: number) => onChange({ steps: doc.steps.filter((_, j) => j !== i) })
  const moveTo = (i: number, to: number) => {
    if (to === i || to < 0 || to >= doc.steps.length) return
    const steps = doc.steps.slice()
    const [s] = steps.splice(i, 1)
    steps.splice(to, 0, s)
    onChange({ steps })
  }
  const setTransition = (stepId: string, outcome: Outcome, target: string | undefined) => {
    const i = doc.steps.findIndex(s => s.id === stepId)
    if (i < 0) return
    const on = { ...(doc.steps[i].on ?? {}), [outcome]: target }
    const clean = Object.fromEntries(Object.entries(on).filter(([, v]) => v)) as ProcessStep['on']
    update(i, { ...doc.steps[i], on: clean && Object.keys(clean).length ? clean : undefined })
  }

  // Перетаскивание узла вдоль хребта: порог 6px, клик без сдвига открывает окно.
  const onNodeDown = (e: PointerEvent<SVGGElement>, nd: GNode) => {
    if (e.button !== 0) return
    dragRef.current = { index: nd.index, x0: e.clientX, moved: false, target: nd.index }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onNodeMove = (e: PointerEvent<SVGGElement>) => {
    const d = dragRef.current
    if (!d || readOnly) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 6) return
    d.moved = true
    const col = Math.round(d.index + dx / scale / (NW + GX))
    d.target = Math.max(0, Math.min(doc.steps.length - 1, col))
    setDrag({ index: d.index, dx: dx / scale, target: d.target })
  }
  const onNodeUp = (e: PointerEvent<SVGGElement>, nd: GNode) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.moved) { moveTo(d.index, d.target); setDrag(null); return }
    open({ kind: 'step', index: nd.index }, e.currentTarget)
  }
  const keyOpen = (e: KeyboardEvent<SVGGElement>, m: Modal) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(m, e.currentTarget) }
  }

  const stepNodes = lay.nodes.filter(nd => nd.kind === 'step')
  const caps = lay.nodes.filter(nd => nd.kind !== 'step')
  const edgesByStep = new Map<string, GEdge[]>()
  for (const e of lay.edges) edgesByStep.set(e.from, [...(edgesByStep.get(e.from) ?? []), e])
  const errStep = error?.step
  const humanLock = !!locks?.human_review
  const minReview = locks?.min_participants?.review

  return (
    <div className="pg-wrap" ref={rootRef}>
      <svg className={'pg' + (hi ? ' dim-others' : '')} width={svgW} height={svgH} viewBox={`0 0 ${lay.w} ${lay.h}`}
        role="group" aria-label={`Граф процесса, шагов: ${doc.steps.length}`}>
        <defs>
          {(['ok', 'changes', 'fail'] as Outcome[]).map(o => (
            <marker key={o} id={`${uid}-m-${o}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={'pg-arrow ' + o} />
            </marker>
          ))}
        </defs>

        {stepNodes.map(nd => {
          const s = nd.step!
          const parts = s.participants ?? []
          const shown = parts.slice(0, 3).map(participantLabel)
          const isDrag = drag?.index === nd.index
          const tx = isDrag ? drag!.dx : 0
          const label = `шаг ${s.id}${s.title ? ', ' + s.title : ''}, ${s.kind}, участников: ${parts.length}${s.enabled === false ? ', выключен' : ''}`
          return (
            <g key={s.id}>
              <g className={'pg-node' + (nd.enabled ? '' : ' off') + (errStep === s.id ? ' has-err' : '') + (isDrag ? ' dragging' : '')}
                data-step={s.id} role="button" tabIndex={0} aria-label={label}
                transform={tx ? `translate(${tx} 0)` : undefined}
                onPointerDown={e => onNodeDown(e, nd)} onPointerMove={onNodeMove} onPointerUp={e => onNodeUp(e, nd)}
                onKeyDown={e => keyOpen(e, { kind: 'step', index: nd.index })}>
                <rect className="pg-box" x={nd.x} y={nd.y} width={nd.w} height={nd.h} rx={6} />
                <rect className="pg-bar" x={nd.x} y={nd.y + 6} width={3} height={nd.h - 12} rx={1.5} style={{ fill: KIND_COLOR[s.kind] ?? 'var(--accent)' }} />
                <foreignObject x={nd.x} y={nd.y} width={nd.w} height={nd.h} style={{ pointerEvents: 'none' }}>
                  <div className="pg-card">
                    <div className="k">
                      <span>{nd.index + 1}</span><span>{s.kind}</span>
                      {s.kind === 'review' && humanLock && <span title="установка требует человека на review">🔒</span>}
                      {s.kind === 'review' && minReview && <span title={`установка требует участников: ${minReview}`}>≥{minReview}</span>}
                      {s.enabled === false && <span className="off-mark">выключен</span>}
                    </div>
                    <div className="t">{s.title || DEFAULT_TITLE[s.kind] || s.id}</div>
                    {HAS_PARTICIPANTS.has(s.kind) && (
                      <div className="p">
                        {shown.length ? shown.map((t, i) => <span key={i}>{t}</span>) : <span className="warn">без участников</span>}
                        {parts.length > 3 && <span>+{parts.length - 3}</span>}
                      </div>
                    )}
                    {HAS_PARTICIPANTS.has(s.kind) && (
                      <div className="m">{s.mode ?? 'parallel'} · {s.require === 'any' ? 'любой' : 'все'}{s.attempts ? ` · ${s.attempts}` : ''}</div>
                    )}
                  </div>
                </foreignObject>
              </g>
              {(edgesByStep.get(s.id) ?? []).map(e => (
                <g key={e.id} className={'pg-edge ' + e.outcome + (e.explicit ? '' : ' default') + (hi === e.id ? ' hi' : '')}
                  data-edge={e.id} role="button" tabIndex={0}
                  aria-label={`переход ${e.outcome} от ${e.from} к ${e.to === 'done' ? 'готово' : e.to === 'escalate' ? 'эскалации' : e.to}${e.explicit ? '' : ', по умолчанию'}`}
                  onMouseEnter={() => setHi(e.id)} onMouseLeave={() => setHi(null)}
                  onClick={ev => open({ kind: 'edge', stepId: e.from, outcome: e.outcome }, ev.currentTarget)}
                  onKeyDown={ev => keyOpen(ev, { kind: 'edge', stepId: e.from, outcome: e.outcome })}>
                  <path className="hit" d={e.d} />
                  <path className="line" d={e.d} markerEnd={`url(#${uid}-m-${e.outcome})`} />
                  <text x={e.lx} y={e.ly} textAnchor="middle">{e.outcome}</text>
                </g>
              ))}
            </g>
          )
        })}

        {caps.map(nd => (
          <g key={nd.id} className={'pg-cap ' + nd.kind} aria-label={nd.kind === 'done' ? 'готово' : 'эскалация'}>
            <rect x={nd.x} y={nd.y} width={CAP_W} height={CAP_H} rx={CAP_H / 2} />
            <text x={nd.x + CAP_W / 2} y={nd.y + CAP_H / 2}>{nd.kind === 'done' ? '◉ готово' : '⚠ эскалация'}</text>
          </g>
        ))}

        {!readOnly && lay.gaps.map(g => (
          <g key={g.at} className={'pg-gap' + (drag && drag.target === g.at - (drag.index < g.at ? 1 : 0) && drag.target !== drag.index ? ' target' : '')}
            role="button" tabIndex={0} aria-label={`добавить шаг на позицию ${g.at + 1}`}
            onClick={e => open({ kind: 'new', at: g.at }, e.currentTarget)}
            onKeyDown={e => keyOpen(e, { kind: 'new', at: g.at })}>
            <circle cx={g.x} cy={g.y} r={10} />
            <text x={g.x} y={g.y}>+</text>
          </g>
        ))}
        {doc.steps.length === 0 && !readOnly && (
          <g className="pg-gap" role="button" tabIndex={0} aria-label="добавить первый шаг"
            onClick={e => open({ kind: 'new', at: 0 }, e.currentTarget)} onKeyDown={e => keyOpen(e, { kind: 'new', at: 0 })}>
            <circle cx={PAD + 10} cy={lay.spineY + 40} r={10} /><text x={PAD + 10} y={lay.spineY + 40}>+</text>
          </g>
        )}
      </svg>

      {modal?.kind === 'step' && doc.steps[modal.index] && (
        <StepModal doc={doc} index={modal.index} runners={runners} members={members} readOnly={readOnly} error={error}
          onApply={update} onInsert={insert} onDelete={remove}
          onMove={(i, dir) => { moveTo(i, i + dir); setModal({ kind: 'step', index: i + dir }) }} onClose={close} />
      )}
      {modal?.kind === 'new' && (
        <StepModal doc={doc} index={-1} isNew at={modal.at} runners={runners} members={members} readOnly={readOnly}
          onApply={update} onInsert={insert} onDelete={remove} onMove={() => {}} onClose={close} />
      )}
      {modal?.kind === 'edge' && (
        <TransitionModal doc={doc} stepId={modal.stepId} outcome={modal.outcome} readOnly={readOnly}
          onApply={t => setTransition(modal.stepId, modal.outcome, t)} onClose={close} />
      )}
    </div>
  )
}
