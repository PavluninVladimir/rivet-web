import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Epic, type Runner, type Task } from '../api/client'
import { useStore } from '../store'
import { INSTALL_ITEMS, PROJECT_SECTIONS, installRoute, projectHome, sectionRoute } from '../routes'
import { StBadge } from './ui'
import { FormNote, errText } from './form'
import { requestNewEpic } from './intents'
import { GROUP_LABEL, commandItems, filterItems, initialKey, type EpicWithTasks, type PalItem } from './paletteItems'

// Подтверждение вторым нажатием: не раньше чем через CONFIRM_DELAY_MS после
// первого и не позже CONFIRM_TTL_MS, потом его надо взводить заново.
const CONFIRM_DELAY_MS = 450
const CONFIRM_TTL_MS = 5000

// Командная палитра ⌘K: команды, проекты, разделы, Epic'и и задачи
// текущего проекта, runner'ы (спека web «Командная палитра»). Разделы
// проекта и команды есть только в проекте; выбор проекта входит в него или
// переключает на него. Действие выполняется здесь же: успех открывает его
// объект, отказ остаётся в палитре причиной (fix-web-console-tails).
// Выделение хранится ключом пункта: после перечитывания списка оно не
// перескакивает на другое действие, оказавшееся на том же месте. Выделение
// меняют только стрелки и клик, наведение мыши лишь подсвечивает пункт.
export function Palette({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const { projectId, projects, overviewAvailable, nav, route } = useStore()
  const [q, setQ] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  // Пользователь выбрал пункт сам (стрелкой, мышью, нажатием).
  const [touched, setTouched] = useState(false)
  // Команда с подтверждением, ждущая второго нажатия, и момент первого.
  const [armed, setArmed] = useState<string | null>(null)
  const armedAt = useRef(0)
  const [loaded, setLoaded] = useState<{ epics: EpicWithTasks[]; runners: Runner[] }>({ epics: [], runners: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // Растёт после отказа: Epic'и и задачи перечитываются, и устаревшее
  // действие уступает место действию по текущему статусу.
  const [reload, setReload] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Палитру могут закрыть (Escape, клик мимо), пока действие в полёте:
  // тогда ответ уже никуда не уводит.
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => { inputRef.current?.focus() }, [])

  // Переходы и проекты известны сразу, без запросов.
  const fixed = useMemo(() => {
    const all: PalItem[] = []
    if (projectId) {
      for (const s of PROJECT_SECTIONS) {
        if (s.view === 'overview' && !overviewAvailable) continue
        all.push({ key: `section-${s.view}`, group: 'sections', label: `Перейти: ${s.label}`, hint: 'раздел проекта', action: { kind: 'nav', target: sectionRoute(s.view, projectId) } })
      }
    }
    for (const p of projects) {
      all.push({ key: `project-${p.ID}`, group: 'projects', label: `Проект: ${p.Name}`, hint: p.ID === projectId ? 'текущий проект' : 'проект', action: { kind: 'nav', target: projectHome(p.ID) } })
    }
    for (const i of INSTALL_ITEMS) {
      if (i.admin && !admin) continue
      all.push({ key: `view-${i.view}`, group: 'sections', label: `Перейти: ${i.label}`, hint: 'раздел', action: { kind: 'nav', target: installRoute(i.view) } })
    }
    all.push({ key: 'view-profile', group: 'sections', label: 'Перейти: Профиль', hint: 'раздел', action: { kind: 'nav', target: { view: 'profile' } } })
    return all
  }, [projectId, projects, overviewAvailable, admin])

  useEffect(() => {
    let live = true
    ;(async () => {
      const [epics, runners] = await Promise.all([projectId ? api.epics(projectId) : Promise.resolve(null), api.runners()])
      const views = await Promise.all((epics ?? []).map(e => api.epic(e.ID)))
      const list: EpicWithTasks[] = (epics ?? []).map((e: Epic, i) => ({ epic: e, tasks: (views[i].tasks ?? []) as Task[] }))
      if (live) setLoaded({ epics: list, runners: (runners ?? []) as Runner[] })
    })().catch(() => {})
    return () => { live = false }
  }, [projectId, reload])

  // Открытые Epic и задача: их действия видны без запроса.
  const openEpic = route.view === 'epic' ? route.id : undefined
  const openTask = route.view === 'epic' ? route.taskId : undefined
  const found = useMemo(() => {
    const all: PalItem[] = projectId ? commandItems(projectId, loaded.epics, { epicId: openEpic, taskId: openTask }) : []
    for (const { epic: ep, tasks } of loaded.epics) {
      all.push({ key: `epic-${ep.ID}`, group: 'epics', label: ep.Title, hint: 'epic', status: ep.Status, action: { kind: 'nav', target: { view: 'epic', pid: ep.ProjectID, id: ep.ID } } })
      for (const t of tasks) {
        all.push({
          key: `task-${t.ID}`, group: 'tasks', label: `task-${t.Num} · ${t.Title}`, hint: ep.Title, status: t.Status,
          action: { kind: 'nav', target: { view: 'epic', pid: ep.ProjectID, id: ep.ID, taskId: t.ID } },
        })
      }
    }
    for (const r of loaded.runners) {
      all.push({ key: `runner-${r.ID}`, group: 'runners', label: r.ID, hint: 'runner', status: r.Status, action: { kind: 'nav', target: { view: 'runners' } } })
    }
    return all
  }, [projectId, loaded, openEpic, openTask])

  const filtered = useMemo(() => filterItems([...fixed, ...found], q), [fixed, found, q])

  // Новый запрос: выделение на первом пункте без побочного эффекта, ошибка и
  // ожидание подтверждения сбрасываются.
  useEffect(() => { setSelKey(null); setTouched(false); setArmed(null); setErr('') }, [q])
  // Пока пользователь ничего не выбрал, выделение следует за списком. Если
  // выбранный пункт пропал (перечитывание после отказа), выделения нет.
  const sel = useMemo(() => {
    if (selKey && filtered.some(i => i.key === selKey)) return selKey
    return touched ? null : initialKey(filtered)
  }, [selKey, filtered, touched])
  const pick = (key: string | null) => { setSelKey(key); setTouched(true); setArmed(a => (a === key ? a : null)) }
  // Взведённое подтверждение живёт недолго: отвлёкшись, пользователь не
  // запустит действие следующим Enter в поле поиска.
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(null), CONFIRM_TTL_MS)
    return () => clearTimeout(id)
  }, [armed])

  // Выполнение пункта. Переходы закрывают палитру сразу, действия после
  // ответа сервера; отказ показывается здесь, палитра остаётся открытой.
  const run = async (i: PalItem) => {
    if (busy) return
    if (i.confirm) {
      if (armed !== i.key) { pick(i.key); setArmed(i.key); armedAt.current = Date.now(); return }
      // Второе нажатие сразу за первым (двойной Enter, дребезг) не
      // подтверждает: его принимают не раньше CONFIRM_DELAY_MS.
      if (Date.now() - armedAt.current < CONFIRM_DELAY_MS) return
    }
    const a = i.action
    if (a.kind === 'nav') { nav(a.target); onClose(); return }
    if (a.kind === 'new-epic') { requestNewEpic(); nav(sectionRoute('epics', a.pid)); onClose(); return }
    if (a.kind === 'open-pr') { window.open(a.url, '_blank', 'noopener,noreferrer'); onClose(); return }
    setBusy(i.key); setErr(''); setArmed(null)
    try {
      if (a.kind === 'epic') await api.epicAction(a.epicId, a.action)
      else await api.retry(a.taskId)
      if (!alive.current) return
      nav(a.kind === 'epic' ? { view: 'epic', pid: a.pid, id: a.epicId } : { view: 'epic', pid: a.pid, id: a.epicId, taskId: a.taskId })
      onClose()
    } catch (e) {
      if (!alive.current) return
      setErr(`${i.label}: ${errText(e)}`)
      pick(i.key)
      setReload(n => n + 1)
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const selIdx = filtered.findIndex(i => i.key === sel)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = filtered[Math.min(selIdx + 1, filtered.length - 1)]; if (n) pick(n.key) }
    if (e.key === 'ArrowUp') { e.preventDefault(); const n = filtered[Math.max(selIdx - 1, 0)]; if (n) pick(n.key) }
    // Автоповтор зажатого Enter не нажатие: он не подтверждает действие.
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat && selIdx >= 0) void run(filtered[selIdx]) }
  }

  const hintOf = (i: PalItem) => busy === i.key ? 'выполняется…'
    : armed === i.key ? 'нажмите ещё раз, чтобы подтвердить'
      : i.hint

  return (
    <div id="pal-wrap" onClick={onClose}>
      <div id="pal" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} placeholder="Задача, Epic, проект, runner, раздел или команда…" aria-label="Поиск или команда"
          value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} />
        {err && <div className="pal-err"><FormNote err={err} /></div>}
        <div id="pal-list">
          {filtered.length === 0 && <div className="pal-group">Ничего не найдено</div>}
          {filtered.map((i, idx) => (
            <Fragment key={i.key}>
              {(idx === 0 || filtered[idx - 1].group !== i.group) && <div className="pal-group">{GROUP_LABEL[i.group]}</div>}
              {/* Фокус остаётся в поле поиска, как в combobox: пункты не
                  получают его ни по Tab, ни по клику. Клавиатура обрабатывается
                  в поле, поэтому клик без мыши (detail 0, автоповтор Enter на
                  кнопке) и второй клик двойного клика пункт с подтверждением
                  не подтверждают. */}
              <button className={'pal-item' + (i.key === sel ? ' sel' : '') + (armed === i.key ? ' armed' : '')}
                tabIndex={-1} aria-busy={busy === i.key || undefined} disabled={!!busy && busy !== i.key}
                onMouseDown={e => e.preventDefault()}
                onClick={e => {
                  if (i.confirm && e.detail !== 1) return
                  void run(i)
                }}>
                {i.status && <StBadge s={i.status} />}
                {i.label}
                <span className="hint">{hintOf(i)}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
