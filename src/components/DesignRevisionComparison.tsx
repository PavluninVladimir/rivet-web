import { useEffect, useMemo, useState } from 'react'
import { designApi, type DocumentView } from '../api/design'
import { compareDesignModels, historyValue } from './designHistory'
import { Button, errText } from './form'

export function DesignRevisionComparison({ projectId, documentId, revision, parentRevision, currentRevision }: {
  projectId: string; documentId: string; revision: number; parentRevision: number | null; currentRevision: number
}) {
  const [base, setBase] = useState<'parent' | 'current'>(parentRevision === null ? 'current' : 'parent')
  const [pair, setPair] = useState<{ before: DocumentView; after: DocumentView } | null>(null)
  const [error, setError] = useState(''), [limit, setLimit] = useState(50)
  useEffect(() => {
    let live = true
    setPair(null); setError(''); setLimit(50)
    const load = base === 'parent' && parentRevision !== null
      ? Promise.all([designApi.get(projectId, documentId, parentRevision), designApi.get(projectId, documentId, revision)])
      : Promise.all([designApi.get(projectId, documentId, revision), designApi.get(projectId, documentId)])
    void load.then(([before, after]) => { if (live) setPair({ before, after }) }).catch(err => { if (live) setError(errText(err)) })
    return () => { live = false }
  }, [projectId, documentId, revision, parentRevision, base, currentRevision])
  const changes = useMemo(() => pair ? compareDesignModels(pair.before.model, pair.after.model) : [], [pair])
  return <section className="design-history-comparison" aria-label="Сравнение содержимого версий">
    <h3>Содержимое версии v{revision}</h3>
    <label>Сравнить выбранную версию
      <select value={base} onChange={event => setBase(event.target.value as typeof base)}>
        {parentRevision !== null && <option value="parent">С родительской версией v{parentRevision}</option>}
        <option value="current">С текущей сохранённой версией</option>
      </select>
    </label>
    <p className="muted">Сравниваются сохранённые модели. Undo и импорт могут не иметь списка typed операций, их изменения показаны по значениям снимков.</p>
    {error && <p role="alert">Не удалось загрузить сравнение: {error}</p>}
    {!pair && !error && <p role="status">Загрузка снимков версий…</p>}
    {pair && <>
      <p role="status">v{pair.before.document.revision} → v{pair.after.document.revision}: изменений {changes.length}</p>
      {changes.length === 0 && <p>Сохранённые модели совпадают.</p>}
      {changes.slice(0, limit).map(change => <article className="design-history-change" key={change.path}>
        <h4><code>{change.path}</code></h4>
        <dl>
          <div><dt>До · v{pair.before.document.revision}</dt><dd><pre>{historyValue(change.before_present, change.before)}</pre></dd></div>
          <div><dt>После · v{pair.after.document.revision}</dt><dd><pre>{historyValue(change.after_present, change.after)}</pre></dd></div>
        </dl>
      </article>)}
      {changes.length > limit && <Button onClick={() => setLimit(value => value + 50)}>Показать ещё изменения ({changes.length - limit})</Button>}
    </>}
  </section>
}
