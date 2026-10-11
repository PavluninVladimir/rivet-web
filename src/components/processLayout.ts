import type { ProcessDoc, ProcessStep } from '../api/client'

// Раскладка графа процесса (add-process-graph-editor, design решение 2):
// чистая функция «документ → узлы, рёбра, зазоры, размеры». Порядок шагов
// задаёт колонки хребта, координаты нигде не хранятся. Переходы по
// умолчанию повторяют policy.Resolve бэкенда: ok → следующий включённый
// шаг или done, changes → ближайший предыдущий включённый code (включая
// сам) или escalate, fail → escalate; changes/fail есть только у шагов с
// участниками.

export type Outcome = 'ok' | 'changes' | 'fail'
export const OUTCOMES: Outcome[] = ['ok', 'changes', 'fail']
export const HAS_PARTICIPANTS = new Set<string>(['code', 'test', 'review', 'prompt'])

export const NW = 200, NH = 80, GX = 64, PAD = 24, CAP_W = 100, CAP_H = 30

export interface Target { to: string; explicit: boolean }
export type Transitions = Record<Outcome, Target | null>

export interface GNode {
  id: string
  kind: 'step' | 'done' | 'escalate'
  index: number          // индекс шага в документе; -1 у терминальных
  step?: ProcessStep
  enabled: boolean
  x: number; y: number; w: number; h: number
}

export interface GEdge {
  id: string             // `${from}:${outcome}`
  from: string
  fromIndex: number
  outcome: Outcome
  to: string
  explicit: boolean
  d: string              // путь SVG
  lx: number; ly: number // точка подписи
}

// Зазор для «+»: вставка нового шага перед индексом `at` (at = n — в конец).
export interface Gap { at: number; x: number; y: number }

export interface GLayout {
  nodes: GNode[]
  edges: GEdge[]
  gaps: Gap[]
  w: number
  h: number
  spineY: number
}

export function nearestCode(enabled: ProcessStep[], i: number): string {
  for (let j = i; j >= 0; j--) if (enabled[j].kind === 'code') return enabled[j].id
  return 'escalate'
}

// resolveTransitions — переходы каждого включённого шага с признаком
// «задан явно». Выключенные шаги переходов не имеют.
export function resolveTransitions(doc: ProcessDoc): Map<string, Transitions> {
  const enabled = doc.steps.filter(s => s.enabled !== false)
  const out = new Map<string, Transitions>()
  enabled.forEach((s, i) => {
    const on = s.on ?? {}
    const withParts = HAS_PARTICIPANTS.has(s.kind)
    const ok: Target = on.ok ? { to: on.ok, explicit: true }
      : { to: i + 1 < enabled.length ? enabled[i + 1].id : 'done', explicit: false }
    let changes: Target | null = null, fail: Target | null = null
    if (withParts) {
      changes = on.changes ? { to: on.changes, explicit: true } : { to: nearestCode(enabled, i), explicit: false }
      fail = on.fail ? { to: on.fail, explicit: true } : { to: 'escalate', explicit: false }
    } else {
      if (on.changes) changes = { to: on.changes, explicit: true }
      if (on.fail) fail = { to: on.fail, explicit: true }
    }
    out.set(s.id, { ok, changes, fail })
  })
  return out
}

// defaultTargetLabel — подпись цели по умолчанию для окна перехода.
export function defaultTarget(doc: ProcessDoc, stepId: string, outcome: Outcome): string {
  const enabled = doc.steps.filter(s => s.enabled !== false)
  const i = enabled.findIndex(s => s.id === stepId)
  if (i < 0) return outcome === 'ok' ? 'done' : 'escalate'
  if (outcome === 'ok') return i + 1 < enabled.length ? enabled[i + 1].id : 'done'
  if (outcome === 'changes') return nearestCode(enabled, i)
  return 'escalate'
}

export function layoutProcess(doc: ProcessDoc): GLayout {
  const steps = doc.steps
  const n = steps.length
  const idx = new Map(steps.map((s, i) => [s.id, i]))
  const trans = resolveTransitions(doc)

  // Запас над и под хребтом под дуги: чем длиннее прыжок, тем выше дуга.
  let topJump = 0, bottomJump = 0, anyEscalate = false
  for (const [from, t] of trans) {
    const fi = idx.get(from)!
    for (const o of OUTCOMES) {
      const tg = t[o]
      if (!tg) continue
      if (tg.to === 'escalate') { anyEscalate = true; continue }
      // done стоит за последним шагом: дуга к нему из не последнего шага идёт поверху.
      const ti = tg.to === 'done' ? n : idx.get(tg.to)
      if (ti === undefined) continue
      const jump = Math.max(1, Math.abs(ti - fi))
      const straight = o === 'ok' && ti === fi + 1
      if (straight) continue
      // fail к шагу идёт дугой под хребтом, всё остальное (включая fail → done) — над ним.
      if (o === 'fail' && tg.to !== 'done') bottomJump = Math.max(bottomJump, jump)
      else topJump = Math.max(topJump, jump)
    }
  }
  const arcH = (jump: number) => 22 + jump * 22
  const topRoom = topJump ? arcH(topJump) + 16 : 12
  const bottomRoom = bottomJump ? arcH(bottomJump) + 16 : 0
  const spineY = PAD + topRoom
  const cy = spineY + NH / 2

  const nodes: GNode[] = steps.map((s, i) => ({
    id: s.id, kind: 'step', index: i, step: s, enabled: s.enabled !== false,
    x: PAD + i * (NW + GX), y: spineY, w: NW, h: NH,
  }))
  const doneX = PAD + n * (NW + GX)
  const done: GNode = { id: 'done', kind: 'done', index: -1, enabled: true, x: doneX, y: cy - CAP_H / 2, w: CAP_W, h: CAP_H }
  nodes.push(done)
  let escalate: GNode | null = null
  if (anyEscalate) {
    const spineW = Math.max(NW, n * (NW + GX) - GX)
    escalate = {
      id: 'escalate', kind: 'escalate', index: -1, enabled: true,
      x: PAD + spineW / 2 - CAP_W / 2, y: spineY + NH + Math.max(56, bottomRoom + 24), w: CAP_W, h: CAP_H,
    }
    nodes.push(escalate)
  }
  const byId = new Map(nodes.map(nd => [nd.id, nd]))

  const edges: GEdge[] = []
  for (const [from, t] of trans) {
    const a = byId.get(from)!
    for (const o of OUTCOMES) {
      const tg = t[o]
      if (!tg) continue
      const b = byId.get(tg.to)
      if (!b) continue // цель не существует: ошибку покажет сервер
      const e: GEdge = { id: `${from}:${o}`, from, fromIndex: a.index, outcome: o, to: tg.to, explicit: tg.explicit, d: '', lx: 0, ly: 0 }
      const acx = a.x + a.w / 2
      if (b.kind === 'escalate' || (b.kind === 'step' && o === 'fail')) {
        // Вниз: к эскалации прямо, к шагу — дугой под хребтом.
        if (b.kind === 'escalate') {
          const x1 = acx, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y
          const my = (y1 + y2) / 2
          e.d = `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
          e.lx = x1 + (x2 - x1) * 0.35; e.ly = y1 + (y2 - y1) * 0.35 + 4
        } else {
          const jump = Math.max(1, Math.abs(b.index - a.index))
          const h = arcH(jump)
          const x1 = acx + (b.index > a.index ? 24 : -24), y1 = a.y + a.h
          const x2 = b.x + b.w / 2 + (b.index > a.index ? -24 : 24), y2 = b.y + b.h
          e.d = `M${x1} ${y1} C ${x1} ${y1 + h}, ${x2} ${y2 + h}, ${x2} ${y2}`
          e.lx = (x1 + x2) / 2; e.ly = y1 + h * 0.75 + 4
        }
      } else if (b.kind === 'step' && b.index === a.index) {
        // Петля на себя (code: changes → code).
        const y = a.y
        e.d = `M${acx + 18} ${y} C ${acx + 52} ${y - 54}, ${acx - 52} ${y - 54}, ${acx - 18} ${y}`
        e.lx = acx; e.ly = y - 44
      } else if (o === 'ok' && b.kind === 'step' && b.index === a.index + 1) {
        // Соседний шаг: прямая по хребту.
        const x1 = a.x + a.w, x2 = b.x
        e.d = `M${x1} ${cy} L${x2} ${cy}`
        e.lx = (x1 + x2) / 2; e.ly = cy - 7
      } else if (o === 'ok' && b.kind === 'done' && a.index === n - 1) {
        const x1 = a.x + a.w, x2 = b.x
        e.d = `M${x1} ${cy} L${x2} ${cy}`
        e.lx = (x1 + x2) / 2; e.ly = cy - 7
      } else {
        // Дуга над хребтом: прыжок вперёд или возврат назад.
        const bi = b.kind === 'done' ? n : b.index
        const jump = Math.max(1, Math.abs(bi - a.index))
        const h = arcH(jump)
        const forward = bi > a.index
        const x1 = acx + (forward ? 24 : -24), y1 = a.y
        const bcx = b.x + b.w / 2
        const x2 = bcx + (forward ? -24 : 24), y2 = b.y
        e.d = `M${x1} ${y1} C ${x1} ${y1 - h}, ${x2} ${y2 - h}, ${x2} ${y2}`
        e.lx = (x1 + x2) / 2; e.ly = Math.min(y1, y2) - h * 0.75 - 4
      }
      edges.push(e)
    }
  }
  // Порядок фокуса: по хребту — шаг, его рёбра, следующий шаг.
  edges.sort((p, q) => p.fromIndex - q.fromIndex || OUTCOMES.indexOf(p.outcome) - OUTCOMES.indexOf(q.outcome))

  const gaps: Gap[] = []
  // «+» стоит под линией хребта, чтобы не перекрывать подпись ok над ней.
  for (let i = 1; i <= n; i++) gaps.push({ at: i, x: PAD + i * (NW + GX) - GX / 2, y: cy + 22 })

  const w = doneX + CAP_W + PAD
  const h = (escalate ? escalate.y + escalate.h : spineY + NH) + PAD
  return { nodes, edges, gaps, w, h, spineY }
}

export const KIND_LABEL: Record<string, string> = {
  code: 'реализация', test: 'проверки', review: 'ревью', prompt: 'задание', merge: 'merge', deploy: 'публикация',
}

export const DEFAULT_TITLE: Record<string, string> = {
  code: 'Реализация', test: 'Проверки', review: 'Review', merge: 'Merge', deploy: 'Публикация', prompt: 'Задание',
}

// newStepId — идентификатор нового шага: тип плюс порядковый суффикс.
export function newStepId(doc: ProcessDoc, kind: string): string {
  let id = kind
  for (let k = 2; doc.steps.some(s => s.id === id); k++) id = `${kind}${k}`
  return id
}
