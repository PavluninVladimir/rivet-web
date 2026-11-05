import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ProjectArchitecture } from '../api/client'
import { useStore } from '../store'
import { architectureEventStale, eventAfterLoad, normalizeArchitecture } from './archModel'
import { errText } from './form'

// Снимок архитектуры проекта с живым обновлением (спека web «Живое
// обновление схем»): перечитывается по project.architecture_updated, по
// постановке задачи описания, по смене статуса и шага этой задачи и после
// восстановления потока. Снимок бывает тяжёлым (HLD, ERD, тела ADR),
// поэтому события склеиваются: одно перечитывание на пачку событий и не
// больше одного запроса одновременно. События из реплея истории потока,
// которые старше показанного снимка, перечитывания не вызывают.
//
// live — поток подписан на этот проект. Блок на дашборде Epic другого
// проекта событий не получает и обновляется только при открытии.
//
// refreshing — нажали «Обновить снимок» и получили 202: флаг держится,
// пока не придёт снимок с новым временем чтения или SHA. Если события нет,
// снимок перечитывается раз в 8 с, но не дольше 2 минут.
const POLL_MS = 8000
const REFRESH_LIMIT_MS = 120_000

export function useArchitecture(projectId: string | null | undefined) {
  const { listen, connected, projectId: streamProject } = useStore()
  const [arch, setArch] = useState<ProjectArchitecture | null>(null)
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState('')
  const archRef = useRef<ProjectArchitecture | null>(null)
  archRef.current = arch
  const st = useRef({
    pid: projectId, inFlight: false, dirty: false, timer: 0 as ReturnType<typeof setTimeout> | 0,
    // Время сервера (заголовок Date) на момент последнего успешного
    // чтения: события задачи старше него пришли из реплея истории. Часы
    // браузера не участвуют. Без заголовка — время чтения снимка.
    loadedAt: null as number | null,
    base: null as null | { readAt: string | null; sha: string | null; until: number },
  })

  const load = useCallback(function load() {
    const s = st.current
    if (!projectId) return
    if (s.inFlight) { s.dirty = true; return }
    s.inFlight = true
    const pid = projectId
    api.architectureAt(pid).then(
      ({ data: a, serverTime }) => {
        if (st.current.pid !== pid) return
        const n = normalizeArchitecture(a)
        setArch(n); setErr('')
        const readAt = n.read_at ? Date.parse(n.read_at) : NaN
        s.loadedAt = serverTime ?? (Number.isFinite(readAt) ? readAt : null)
        const b = s.base
        if (b && (n.read_at !== b.readAt || n.sha !== b.sha)) { s.base = null; setRefreshing(false) }
      },
      e => { if (st.current.pid === pid) setErr(errText(e)) },
    ).finally(() => {
      if (st.current.pid !== pid) return
      s.inFlight = false
      if (s.dirty) { s.dirty = false; load() }
    })
  }, [projectId])

  // Пачка событий за 250 мс даёт одно чтение.
  const schedule = useCallback(() => {
    const s = st.current
    if (s.timer) return
    s.timer = setTimeout(() => { s.timer = 0; load() }, 250)
  }, [load])

  useEffect(() => {
    const s = st.current
    s.pid = projectId; s.inFlight = false; s.dirty = false; s.loadedAt = null; s.base = null
    setArch(null); setErr(''); setRefreshing(false); setRefreshNote('')
    load()
    return () => { if (s.timer) { clearTimeout(s.timer); s.timer = 0 } }
  }, [projectId, load])

  // Нажатие «Обновить снимок» с ответом 202: ждём снимок новее текущего.
  const startRefresh = useCallback(() => {
    const a = archRef.current
    st.current.base = { readAt: a?.read_at ?? null, sha: a?.sha ?? null, until: Date.now() + REFRESH_LIMIT_MS }
    setRefreshNote('')
    setRefreshing(true)
  }, [])

  useEffect(() => {
    if (!refreshing) return
    const t = setInterval(() => {
      const b = st.current.base
      if (!b) return
      if (Date.now() > b.until) {
        st.current.base = null
        setRefreshing(false)
        setRefreshNote('чтение не завершилось за 2 минуты, снимок прежний')
        return
      }
      load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [refreshing, load])

  const live = !!projectId && projectId === streamProject

  useEffect(() => {
    if (!live) return
    return listen(e => {
      if (e.ProjectID && e.ProjectID !== projectId) return
      const s = st.current
      if (e.Type === 'project.architecture_updated') {
        // Реплей истории и повтор того же снимка не перечитываются, кроме
        // ожидания «Обновить снимок».
        if (!s.base && architectureEventStale(e, archRef.current)) return
        schedule(); return
      }
      const fresh = eventAfterLoad(e.TS, s.loadedAt)
      if (e.Type === 'architecture.describe_started') { if (fresh) schedule(); return }
      const task = archRef.current?.task
      if (fresh && task && e.TaskID === task.task_id && (e.Type === 'task.status' || e.Type === 'task.step' || e.Type === 'task.assign')) schedule()
    })
  }, [live, listen, projectId, schedule])

  // После разрыва события могли пропасть: снимок перечитывается. Первое
  // открытие потока разрывом не считается.
  const prev = useRef<boolean | null>(connected ? true : null)
  useEffect(() => {
    if (connected && prev.current === false && live) schedule()
    if (connected) prev.current = true
    else if (prev.current === true) prev.current = false
  }, [connected, live, schedule])

  return { arch, err, refresh: load, live, refreshing, refreshNote, startRefresh }
}
