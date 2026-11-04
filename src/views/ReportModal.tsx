import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Report } from '../api/client'
import { Button, FormNote, errText } from '../components/form'
import { copyText, reportRange, type ReportPreset } from '../components/overviewLogic'

// Еженедельный отчёт (спека web «Еженедельный отчёт в консоли»): отчёт
// строится на сервере, консоль показывает текст как есть. Скачивается тот
// же текст, что в предпросмотре, под именем файла из ответа сервера.

const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: '7d', label: 'последние 7 суток' }, { id: 'last_week', label: 'прошлая неделя' }, { id: 'custom', label: 'свои даты' },
]

export function ReportModal({ projectId, tz, onClose }: { projectId: string; tz: string; onClose: () => void }) {
  const [preset, setPreset] = useState<ReportPreset>('7d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  const seq = useRef(0)
  const load = useCallback(() => {
    const range = reportRange(preset, new Date(), custom)
    setNote('')
    if ('error' in range) {
      // Запрос прежнего пресета, если он ещё идёт, больше не применяется.
      ++seq.current
      setReport(null); setLoading(false)
      setErr(preset === 'custom' && !custom.from && !custom.to ? '' : range.error)
      return
    }
    const n = ++seq.current
    // Отчёт прежнего периода не остаётся доступным для скачивания, пока
    // грузится новый.
    setReport(null); setLoading(true); setErr('')
    api.report(projectId, { ...range, tz })
      .then(r => { if (n === seq.current) setReport(r) })
      .catch(e => { if (n === seq.current) { setReport(null); setErr(errText(e)) } })
      .finally(() => { if (n === seq.current) setLoading(false) })
  }, [projectId, tz, preset, custom])
  useEffect(load, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = () => {
    if (!report) return
    setErr(''); setNote('')
    void copyText(report.text).then(ok => ok
      ? setNote('Текст отчёта скопирован')
      : setErr('Браузер не дал скопировать: выделите текст в предпросмотре и скопируйте вручную или скачайте файл'))
  }
  const download = () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([report.text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = report.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal report f-form" role="dialog" aria-modal="true" aria-label="Отчёт" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Отчёт по проекту</h2>
          <Button variant="quiet" size="sm" aria-label="закрыть" onClick={onClose}>✕</Button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start' }}>
          <div className="seg">
            {PRESETS.map(p => (
              <button key={p.id} className={p.id === preset ? 'on' : ''} onClick={() => setPreset(p.id)}>{p.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <>
              <input type="date" aria-label="с" style={{ width: 'auto' }} value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
              <span className="muted">по</span>
              <input type="date" aria-label="по" style={{ width: 'auto' }} value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
            </>
          )}
        </div>
        {(err || note) && <FormNote err={err || undefined} ok={note || undefined} />}
        <pre className="term report-pre" data-report>{loading && !report ? 'Загрузка…' : report?.text ?? ''}</pre>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {report && <span className="muted mono" style={{ fontSize: 11, marginRight: 'auto' }}>{report.filename}</span>}
          <Button disabled={!report || loading} onClick={copy}>Скопировать</Button>
          <Button variant="primary" disabled={!report || loading} onClick={download}>Скачать</Button>
        </div>
      </div>
    </div>
  )
}
