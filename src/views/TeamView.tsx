import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stColor, type SessionEntry } from '../api/client'
import { fmtDuration, fmtTokens, StBadge, timeShort } from '../components/ui'
import { useStore } from '../store'
import { FormNote } from '../components/form'

// Представление «Команда» (спека web «Лента команды», add-team-visibility):
// реестр активных сессий проекта с пересечениями работ и поиск по истории.
// Собрано из существующих паттернов прототипа (sess-row, budget-pause):
// отклонения зафиксированы в design change'а.

function liveDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  return fmtDuration(Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000)))
}

function stageColor(stage: string): string {
  return `var(${stColor[stage === 'fix' ? 'fixing' : stage] ?? '--muted'})`
}

function SessionRow({ e, onOpen }: { e: SessionEntry; onOpen: () => void }) {
  return (
    <div>
      <button className="sess-row" onClick={onOpen}>
        <span className="mono muted">task-{e.task_num}</span>
        <span className="sess-stage" style={{ color: stageColor(e.stage) }}>{e.stage.toUpperCase()}</span>
        <span className="sess-agent">{e.task_title}</span>
        <span className="muted">{e.driver_kind === 'user' ? `водитель: ${e.driver_id} · ` : ''}{e.agent}{e.model ? ` · ${e.model}` : ''}</span>
        {e.private && <span className="chip" title="содержимое видно только автору"><span className="n">приватная</span></span>}
        {e.depth === 'full' && <span className="chip" title="глубина данных подключения"><span className="n">full</span></span>}
        <span className="mono">{liveDuration(e.started_at, e.ended_at)}</span>
        <span className="mono" title="токены">{fmtTokens(e.tokens)}</span>
      </button>
      {!e.ended_at && (
        e.last_step
          ? <div className="sess-files muted">сейчас: {e.last_step}</div>
          : null
      )}
      {!e.ended_at && e.overlaps === null && (
        <div className="sess-files muted">пересечения недоступны для этого подключения</div>
      )}
      {(e.overlaps?.length ?? 0) > 0 && e.overlaps!.map(o => (
        <div key={o.task_id} className="budget-pause" style={{ margin: '2px 0 6px' }}>
          Пересечение с task-{o.task_num} «{o.task_title}»: общие файлы{' '}
          <span className="mono">{o.files.slice(0, 3).join(', ')}{o.files.length > 3 ? ` +${o.files.length - 3}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

export function TeamView() {
  const { projectId, nav, tick } = useStore()
  const [active, setActive] = useState<SessionEntry[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SessionEntry[] | null>(null)
  const [err, setErr] = useState('')
  // Поздние ответы устаревших запросов не должны перетирать свежие данные;
  // счётчики раздельные: tick-обновление реестра не инвалидирует поиск.
  const activeSeq = useRef(0)
  const searchSeq = useRef(0)

  const refresh = useCallback(() => {
    if (!projectId) return
    const seq = ++activeSeq.current
    api.projectSessions(projectId)
      .then(list => { if (activeSeq.current === seq) { setActive(list); setErr('') } })
      .catch(e => { if (activeSeq.current === seq) setErr(String(e)) })
  }, [projectId])
  useEffect(refresh, [refresh, tick])
  useEffect(() => { setResults(null); setQ('') }, [projectId])

  // Поиск с лёгким дебаунсом: история не меняется на каждый tick. Очистка
  // поля тоже двигает счётчик — поздний ответ не вернёт результаты.
  useEffect(() => {
    const seq = ++searchSeq.current
    if (!projectId || !q.trim()) { setResults(null); return }
    const id = setTimeout(() => {
      api.projectSessions(projectId, q.trim())
        .then(list => { if (searchSeq.current === seq) { setResults(list); setErr('') } })
        .catch(e => { if (searchSeq.current === seq) setErr(String(e)) })
    }, 250)
    return () => clearTimeout(id)
  }, [projectId, q])

  const openTask = (e: SessionEntry) => nav({ view: 'epic', id: e.epic_id, taskId: e.task_id })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Команда</h1>
        <span className="sub">активные сессии и история проекта</span>
        <div className="right">
          <input className="search" style={{ width: 260 }} placeholder="Поиск по истории сессий…"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      {err && <div style={{ marginBottom: 8 }}><FormNote err={err} /></div>}

      {results === null ? (
        <div className="dw-sec">
          <h3>Сейчас в работе</h3>
          {active.length === 0
            ? <span className="muted">активных сессий нет</span>
            : <div className="sess-list">{active.map(e => <SessionRow key={e.id} e={e} onOpen={() => openTask(e)} />)}</div>}
        </div>
      ) : (
        <div className="dw-sec">
          <h3>История: {results.length} {results.length === 1 ? 'сессия' : 'сессий'}</h3>
          {results.length === 0
            ? <span className="muted">ничего не найдено — поиск идёт по запросу, названию задачи и итогу</span>
            : (
              <div className="sess-list">
                {results.map(e => (
                  <div key={e.id}>
                    <button className="sess-row" onClick={() => openTask(e)}>
                      <span className="mono muted">{timeShort(e.started_at)}</span>
                      <span className="sess-stage" style={{ color: stageColor(e.stage) }}>{e.stage.toUpperCase()}</span>
                      <span className="sess-agent">{e.task_title}</span>
                      {e.driver_kind === 'user' && <span className="muted">водитель: {e.driver_id}</span>}
                      {e.private && <span className="chip" title="содержимое видно только автору"><span className="n">приватная</span></span>}
                      {e.ended_at ? <StBadge s="done" /> : <StBadge s="running" />}
                      <span className="mono" title="токены">{fmtTokens(e.tokens)}</span>
                    </button>
                    <div className="sess-files muted">
                      {e.prompt && <>запрос: {e.prompt.split('\n')[0].slice(0, 120)}<br /></>}
                      {e.outcome && <>итог: {e.outcome}<br /></>}
                      {e.files && e.files.length > 0 && (
                        <span className="mono">{e.files.slice(0, 5).join(', ')}{e.files.length > 5 ? ` +${e.files.length - 5}` : ''}</span>
                      )}
                      {e.files === null && 'файлы недоступны для этого подключения'}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
