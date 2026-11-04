import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Владелец ли пользователь проекта: ручные действия с релизами и
// инцидентами доступны только владельцу (бэкенд проверяет сам, консоль
// прячет кнопки остальным).
export function useIsOwner(projectId: string | null, login: string): boolean {
  const [owner, setOwner] = useState(false)
  useEffect(() => {
    if (!projectId) return
    let live = true
    api.members(projectId)
      .then(ms => { if (live) setOwner((ms ?? []).some(m => m.login === login && m.role === 'owner')) })
      .catch(() => { if (live) setOwner(false) })
    return () => { live = false }
  }, [projectId, login])
  return owner
}
