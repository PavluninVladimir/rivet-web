import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Epic, type Runner, type Task } from '../api/client'
import { useStore } from '../store'
import { StBadge } from './ui'

interface Item {
  key: string
  label: string
  hint: string
  status?: string
  go: () => void
}

// Командная палитра ⌘K: поиск по задачам, Epic'ам и runner'ам + переходы.
export function Palette({ onClose }: { onClose: () => void }) {
  const { projectId, nav } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!projectId) return
      const [epics, runners] = await Promise.all([api.epics(projectId), api.runners()])
      const all: Item[] = []
      for (const v of ['projects', 'epics', 'tasks', 'runners', 'activity', 'usage', 'profile'] as const) {
        all.push({
          key: `view-${v}`, label: `Перейти: ${v}`, hint: 'раздел',
          go: () => nav({ view: v }),
        })
      }
      const epicViews = await Promise.all((epics ?? []).map(e => api.epic(e.ID)))
      for (const [i, e] of (epics ?? []).entries()) {
        const ep: Epic = e
        all.push({ key: `epic-${ep.ID}`, label: ep.Title, hint: 'epic', status: ep.Status, go: () => nav({ view: 'epic', id: ep.ID }) })
        for (const t of (epicViews[i].tasks ?? []) as Task[]) {
          all.push({
            key: `task-${t.ID}`, label: `task-${t.Num} · ${t.Title}`, hint: ep.Title, status: t.Status,
            go: () => nav({ view: 'epic', id: ep.ID, taskId: t.ID }),
          })
        }
      }
      for (const r of (runners ?? []) as Runner[]) {
        all.push({ key: `runner-${r.ID}`, label: r.ID, hint: 'runner', status: r.Status, go: () => nav({ view: 'runners' }) })
      }
      if (alive) setItems(all)
    })().catch(() => {})
    return () => { alive = false }
  }, [projectId, nav])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items.slice(0, 12)
    return items.filter(i => i.label.toLowerCase().includes(needle)).slice(0, 12)
  }, [items, q])

  useEffect(() => { setSel(0) }, [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && filtered[sel]) { filtered[sel].go(); onClose() }
  }

  return (
    <div id="pal-wrap" onClick={onClose}>
      <div id="pal" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} placeholder="Задача, Epic, runner, раздел…"
          value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} />
        <div id="pal-list">
          {filtered.map((i, idx) => (
            <button key={i.key} className={'pal-item' + (idx === sel ? ' sel' : '')}
              onMouseEnter={() => setSel(idx)}
              onClick={() => { i.go(); onClose() }}>
              {i.status && <StBadge s={i.status} />}
              {i.label}
              <span className="hint">{i.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
