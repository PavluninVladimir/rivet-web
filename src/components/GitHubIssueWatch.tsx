import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type IssueIntakeConfig, type IssueIntakeView } from '../api/client'
import { useStore } from '../store'
import { Button, Field, TextInput, errText } from './form'
import { fmtAgo } from './ui'

const STATUS: Record<string, string> = {
  running: 'Аналитик исследует', ready: 'Результат ждёт утверждения', approved: 'Исследование утверждено',
  superseded: 'Версия заменена', failed: 'Анализ завершился ошибкой',
}

// The primary entry is the Operations phase: sources are handed to Discovery,
// never turned into tasks by this UI. Polling is read-only and stops on unmount.
export function GitHubIssueWatch({ projectId }: { projectId: string }) {
  const { href, projects } = useStore()
  const supported = projects.find(p => p.ID === projectId)?.provider === 'github'
  const [view, setView] = useState<IssueIntakeView | null>(null)
  const [owner, setOwner] = useState(false)
  const [draft, setDraft] = useState<IssueIntakeConfig | null>(null)
  const [err, setErr] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    setView(null); setOwner(false); setDraft(null); setErr(''); setSaveErr('')
    if (!supported) return
    let alive = true
    const controller = new AbortController()
    const load = () => {
      const n = ++seq.current
      api.issueIntake(projectId, controller.signal).then(v => {
        if (alive && n === seq.current) { setView(v); setErr('') }
      }).catch(e => { if (alive && n === seq.current) setErr(errText(e)) })
    }
    Promise.all([api.me(), api.members(projectId)]).then(([me, members]) => {
      if (alive) setOwner((members ?? []).some(m => m.login === me.login && m.role === 'owner'))
    }).catch(() => { if (alive) setOwner(false) })
    load()
    const timer = window.setInterval(load, 10000)
    return () => { alive = false; controller.abort(); window.clearInterval(timer); ++seq.current }
  }, [projectId, supported])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || saving) return
    setSaving(true); setSaveErr(''); ++seq.current
    try {
      const v = await api.saveIssueIntake(projectId, { ...draft, label: draft.label.trim() })
      ++seq.current; setView(v); setDraft(null); setErr('')
    } catch (e) { setSaveErr(errText(e)) }
    finally { setSaving(false) }
  }

  if (!supported) return null
  return <section className="dw-sec" data-issue-watch tabIndex={-1} aria-label="GitHub Issues в сопровождении">
    <h3>GitHub Issues → Исследование</h3>
    <p className="muted">Сопровождение принимает запросы и ошибки по метке и передаёт их Аналитику. После исследования — обычное утверждение бэклога.</p>
    {err && <div className="f-error" role="alert">Не удалось обновить наблюдение: {err}</div>}
    {!view && !err && <p role="status">Загружаем наблюдение Issues…</p>}
    {view && <>
      <p role="status">{view.enabled ? `Наблюдение включено · метка ${view.label}` : 'Наблюдение выключено'}<br />
        {view.last_check_at ? `Последняя проверка ${fmtAgo(view.last_check_at)}` : 'Проверок ещё не было'}<br />
        {view.auto_research ? 'Автоматическое исследование включено' : 'Автоматическое исследование выключено'}
      </p>
      {view.error && <div className="f-error" role="status">{view.error}</div>}
      {owner && !draft && <Button variant="quiet" onClick={() => { setDraft({ enabled: view.enabled, auto_research: view.auto_research, label: view.label }); setSaveErr('') }}>Настроить приём Issues</Button>}
      {draft && owner && <form onSubmit={save}>
        <p><label><input type="checkbox" checked={draft.enabled} disabled={saving} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Наблюдать GitHub Issues</label></p>
        <Field label="Метка GitHub" hint="Одна метка. Например, rivet. Учитываются только открытые Issues.">
          {ids => <TextInput ids={ids} value={draft.label} required maxLength={50} disabled={saving} onChange={e => setDraft({ ...draft, label: e.target.value })} />}
        </Field>
        <p><label><input type="checkbox" checked={draft.auto_research} disabled={saving} onChange={e => setDraft({ ...draft, auto_research: e.target.checked })} /> Автоматически начинать исследование</label></p>
        <p className="muted">Запуск соблюдает бюджет, роль и модель Аналитика. Утверждение плана, merge и публикация проходят по обычным разрешениям.</p>
        {saveErr && <div className="f-error" role="alert">{saveErr}</div>}
        <Button type="submit" disabled={saving || !draft.label.trim()}>{saving ? 'Сохраняем…' : 'Сохранить наблюдение'}</Button>{' '}
        <Button variant="quiet" type="button" disabled={saving} onClick={() => setDraft(null)}>Отмена</Button>
      </form>}
      {!view.sources.length && <p className="muted">Обращений пока нет. При включённом наблюдении новые Issues с выбранной меткой будут приняты автоматически.</p>}
      <ul className="cp-items">
        {view.sources.map(s => <li key={s.material_id} style={{ overflowWrap: 'anywhere' }}>
          <a className="tlink" href={s.url} target="_blank" rel="noreferrer">#{s.number} {s.title}</a>
          <p className="muted">Сопровождение → <a className="tlink" href={href({ view: 'discovery', pid: projectId, runId: s.research_run_id })}>Исследование</a><br />
            {s.research_status ? STATUS[s.research_status] ?? s.research_status : view.auto_research ? 'Материал принят · ожидает исследования' : 'Материал принят · автоматический запуск выключен'}
            {s.research_status === 'failed' && (s.attempts >= 3 ? ' · лимит повторов исчерпан, откройте исследование' : ' · ожидает повторной передачи')}
          </p>
          {s.epics.map(ep => <p key={ep.id}><a className="tlink" href={href({ view: 'epic', pid: projectId, id: ep.id })}>{ep.title}</a> · {ep.status}</p>)}
        </li>)}
      </ul>
    </>}
  </section>
}
