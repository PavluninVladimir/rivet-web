import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Epic, type Runner, type Task } from '../api/client'
import { useStore } from '../store'
import { INSTALL_ITEMS, PROJECT_SECTIONS, installRoute, projectHome, sectionRoute } from '../routes'
import { StBadge } from './ui'

interface Item {
  key: string
  label: string
  hint: string
  status?: string
  go: () => void
}

// Командная палитра ⌘K: проекты, разделы, Epic'и и задачи текущего
// проекта, runner'ы (спека web «Командная палитра»). Разделы проекта — только
// в проекте; выбор проекта входит в него или переключает на него.
export function Palette({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const { projectId, projects, overviewAvailable, nav } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [found, setFound] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Переходы и проекты известны сразу, без запросов.
  const fixed = useMemo(() => {
    const all: Item[] = []
    if (projectId) {
      for (const s of PROJECT_SECTIONS) {
        if (s.view === 'overview' && !overviewAvailable) continue
        all.push({ key: `section-${s.view}`, label: `Перейти: ${s.label}`, hint: 'раздел проекта', go: () => nav(sectionRoute(s.view, projectId)) })
      }
    }
    for (const p of projects) {
      all.push({ key: `project-${p.ID}`, label: `Проект: ${p.Name}`, hint: p.ID === projectId ? 'текущий проект' : 'проект', go: () => nav(projectHome(p.ID)) })
    }
    for (const i of INSTALL_ITEMS) {
      if (i.admin && !admin) continue
      all.push({ key: `view-${i.view}`, label: `Перейти: ${i.label}`, hint: 'раздел', go: () => nav(installRoute(i.view)) })
    }
    all.push({ key: 'view-profile', label: 'Перейти: Профиль', hint: 'раздел', go: () => nav({ view: 'profile' }) })
    return all
  }, [projectId, projects, overviewAvailable, admin, nav])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [epics, runners] = await Promise.all([projectId ? api.epics(projectId) : Promise.resolve(null), api.runners()])
      const all: Item[] = []
      const epicViews = await Promise.all((epics ?? []).map(e => api.epic(e.ID)))
      for (const [i, e] of (epics ?? []).entries()) {
        const ep: Epic = e
        all.push({ key: `epic-${ep.ID}`, label: ep.Title, hint: 'epic', status: ep.Status, go: () => nav({ view: 'epic', pid: ep.ProjectID, id: ep.ID }) })
        for (const t of (epicViews[i].tasks ?? []) as Task[]) {
          all.push({
            key: `task-${t.ID}`, label: `task-${t.Num} · ${t.Title}`, hint: ep.Title, status: t.Status,
            go: () => nav({ view: 'epic', pid: ep.ProjectID, id: ep.ID, taskId: t.ID }),
          })
        }
      }
      for (const r of (runners ?? []) as Runner[]) {
        all.push({ key: `runner-${r.ID}`, label: r.ID, hint: 'runner', status: r.Status, go: () => nav({ view: 'runners' }) })
      }
      if (alive) setFound(all)
    })().catch(() => {})
    return () => { alive = false }
  }, [projectId, nav])

  const items = useMemo(() => [...fixed, ...found], [fixed, found])

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
        <input ref={inputRef} placeholder="Задача, Epic, проект, runner, раздел…"
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
