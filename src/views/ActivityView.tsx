import { useCallback, useEffect, useState } from 'react'
import { api, type Event } from '../api/client'
import { timeShort } from '../components/ui'
import { useStore } from '../store'

export function ActivityView() {
  const { projectId, tick } = useStore()
  const [events, setEvents] = useState<Event[]>([])

  const refresh = useCallback(() => {
    if (!projectId) return
    api.events({ project: projectId }).then(e => setEvents((e ?? []).slice().reverse())).catch(() => {})
  }, [projectId])
  useEffect(refresh, [refresh, tick])

  return (
    <div className="page">
      <div className="page-head"><h1>Активность</h1><span className="sub">event log проекта</span></div>
      {events.map(e => (
        <div key={e.ID} className="act-row">
          <span className="t">{timeShort(e.TS)}</span>
          <span className="who">{e.ActorKind}{e.ActorID ? `:${e.ActorID}` : ''}</span>
          <span>{e.Text}</span>
        </div>
      ))}
    </div>
  )
}
