import { useEffect, useState } from 'react'
import { api, ApiError, errCode, type ArchitectureTask, type ProjectArchitecture } from '../api/client'
import { routeHash, useStore } from '../store'
import { archErrorInfo, outsideDocsFailure, outsideDocsOf, taskActive, type OutsideDocs } from './archModel'
import { RoleChip } from './RoleChip'
import { StBadge } from './ui'
import { Button, errText } from './form'

// Общие части представления «Архитектура» и блока на дашборде Epic
// (спека web «Пустое состояние архитектуры»): статус снимка, статус задачи
// описания и кнопка «Описать архитектуру» с ошибкой рядом.

export const ARCH_STATUS_LABEL: Record<string, string> = {
  pending: 'строится', absent: 'нет описания', ok: 'ok', invalid: 'есть ошибки', error: 'не прочитано',
}

export function ArchStatus({ s }: { s: string }) {
  return <span className={`arch-st arch-st-${s}`}>{ARCH_STATUS_LABEL[s] ?? s}</span>
}

const TRIGGER_LABEL: Record<string, string> = {
  connect: 'после подключения репозитория', epic_start: 'при запуске первого Epic', manual: 'вручную',
}
const STEP_LABEL: Record<string, string> = {
  describe: 'описание', test: 'проверки', review: 'review', merge: 'merge', code: 'реализация',
}

// Подробности задачи, которых нет в снимке: причина ожидания у ready и
// queued (например, «обновите rivet-runner», если нет runner'а с
// architecture) и отказ merge из-за файлов вне docs/architecture у failed.
function useTaskFacts(task: ArchitectureTask) {
  const { listen } = useStore()
  const [facts, setFacts] = useState<{ wait: string; outside: OutsideDocs | null } | null>(null)
  // Причина ожидания меняется событием task.wait без смены статуса.
  const [waitTick, setWaitTick] = useState(0)
  // Причину отказа новый бэкенд отдаёт в снимке (task.failure), тогда
  // упавшую задачу перечитывать не нужно.
  const fromSnapshot = task.status === 'failed' ? outsideDocsFailure(task.failure) : null
  const need = ['ready', 'queued'].includes(task.status) || (task.status === 'failed' && !fromSnapshot)
  useEffect(() => {
    if (!need) return
    return listen(e => { if (e.TaskID === task.task_id && e.Type === 'task.wait') setWaitTick(t => t + 1) })
  }, [need, listen, task.task_id])
  useEffect(() => {
    if (!need) { setFacts(null); return }
    let alive = true
    api.task(task.task_id).then(
      r => {
        if (!alive) return
        const outside = task.status !== 'failed' ? null
          : outsideDocsFailure(r.task.failure) ?? outsideDocsOf(r.timeline)
        setFacts({ wait: r.task.WaitReason ?? '', outside })
      },
      () => { if (alive) setFacts(null) },
    )
    return () => { alive = false }
  }, [task.task_id, task.status, need, waitTick])
  if (fromSnapshot) return { wait: '', outside: fromSnapshot }
  return facts
}

// Заголовок отказа merge задачи описания по причине и признаку merged.
export function rejectTitle(o: OutsideDocs): string {
  if (o.reason === 'architecture_files_truncated') {
    return o.merged
      ? 'PR уже смержен на хостинге, а список его файлов неполный: проверьте основную ветку.'
      : 'Merge отклонён: список файлов PR неполный, границу docs/architecture проверить нельзя.'
  }
  return o.merged
    ? 'PR уже смержен на хостинге, но меняет файлы вне docs/architecture: проверьте основную ветку.'
    : 'Merge отклонён: PR меняет файлы вне docs/architecture.'
}

// Отказ merge задачи описания: причина, сообщение бэкенда и файлы.
export function OutsideDocsNote({ o, compact }: { o: OutsideDocs; compact?: boolean }) {
  const shown = compact ? o.files.slice(0, 3) : o.files.slice(0, 50)
  return (
    <div className="arch-outside" role="note">
      <b>{rejectTitle(o)}</b>
      {!compact && o.message && <div className="arch-outside-msg">{o.message}</div>}
      {shown.length > 0 && (
        <ul>
          {shown.map(f => <li key={f} className="mono">{f}</li>)}
          {o.total > shown.length && <li className="muted">и ещё {o.total - shown.length}</li>}
        </ul>
      )}
      {shown.length === 0 && o.reason === 'architecture_outside_docs' && <span className="muted"> Список файлов PR не получен с хостинга.</span>}
    </div>
  )
}

export function DescribeTaskStatus({ task, compact }: { task: ArchitectureTask; compact?: boolean }) {
  // Задача описания — в проекте показанной архитектуры, то есть текущем.
  const { roleOf, team, href } = useStore()
  const facts = useTaskFacts(task)
  const active = taskActive(task.status)
  const role = roleOf(task.role ?? undefined)
  const agent = team.find(a => a.task_id === task.task_id)?.name
  const who = role?.title ?? 'Архитектор'
  const title = !active
    ? task.status === 'failed' ? 'Последняя задача описания не удалась' : 'Задача описания'
    : task.status === 'queued' || task.status === 'ready' ? `Задача описания ждёт: ${who}` : `${who} описывает проект`
  return (
    <div className={'arch-task' + (compact ? ' compact' : '')} data-task-status={task.status}>
      <div className="arch-task-head">
        <b>{title}</b>
        <StBadge s={task.status} />
      </div>
      <div className="arch-task-meta">
        {(task.role || agent || task.runner)
          ? <RoleChip role={role} roleId={task.role || undefined} name={agent} runner={task.runner || undefined} small />
          : <span className="muted">исполнитель ещё не назначен</span>}
        {task.step_id && <span>шаг <b>{STEP_LABEL[task.step_id] ?? task.step_id}</b>{STEP_LABEL[task.step_id] && <span className="mono muted"> {task.step_id}</span>}</span>}
        {!compact && task.trigger && <span className="muted">поставлена {TRIGGER_LABEL[task.trigger] ?? task.trigger}</span>}
      </div>
      {facts?.wait && active && <div className="arch-task-wait muted">ожидание: {facts.wait}</div>}
      {facts?.outside && <OutsideDocsNote o={facts.outside} compact={compact} />}
      <div className="arch-task-links">
        <a href={href({ view: 'epic', id: task.epic_id, taskId: task.task_id })}>task-{task.task_num} →</a>
        <a className="muted" href={href({ view: 'epic', id: task.epic_id })}>Epic описания</a>
      </div>
    </div>
  )
}

// Кнопка постановки задачи описания. Ответ 409 значит, что задача уже идёт:
// показывается ссылка на неё. Ошибка остаётся рядом с кнопкой.
// retry — повтор после упавшей задачи: бэкенд отменяет её и ставит новую.
export function DescribeButton({ projectId, onStarted, label = 'Описать архитектуру', primary = true, retry = false }: {
  projectId: string; onStarted: () => void; label?: string; primary?: boolean; retry?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; task?: { epic_id: string; task_id: string }; settings?: boolean } | null>(null)
  // 422 no_credentials: описывать нечем, кнопка прячется до подключения токена.
  const [noCreds, setNoCreds] = useState(false)
  const start = async () => {
    setBusy(true); setErr(null)
    try {
      await api.describeArchitecture(projectId)
      onStarted()
    } catch (e) {
      const code = errCode(e)
      if (code === 'architecture_task_active') {
        let task: { epic_id: string; task_id: string } | undefined
        try {
          const det = (e as ApiError).data as { error?: { details?: unknown } }
          const raw = det?.error?.details
          task = (typeof raw === 'string' ? JSON.parse(raw) : raw) as typeof task
        } catch { /* без ссылки */ }
        // Бэкенд до решения «describe отменяет упавшую задачу» отвечает 409
        // и на повтор: тогда упавшую задачу нужно повторить или отменить.
        setErr({ text: retry
          ? 'Упавшая задача описания ещё открыта: повторите или отмените её в карточке задачи.'
          : 'Задача описания архитектуры уже идёт.', task })
        onStarted()
      } else if (code === 'no_credentials') {
        setNoCreds(true)
      } else if (code === 'repo_not_connected') {
        setErr({ text: 'У проекта нет подключённого репозитория: описывать нечего.', settings: true })
      } else {
        setErr({ text: errText(e) })
      }
    } finally { setBusy(false) }
  }
  if (noCreds) return <CredentialsHint projectId={projectId} />
  return (
    <div className="arch-describe">
      <Button variant={primary ? 'primary' : 'default'} size={primary ? 'md' : 'sm'} busy={busy} busyLabel="ставлю задачу…" onClick={start}>{label}</Button>
      {err && (
        <span className="arch-describe-err" role="alert">
          {err.text}
          {err.task?.task_id && <> <a href={routeHash({ view: 'epic', pid: projectId, id: err.task.epic_id, taskId: err.task.task_id })}>Открыть задачу →</a></>}
          {err.settings && <> <a href={routeHash({ view: 'project-settings', pid: projectId, tab: 'general' })}>Настройки проекта →</a></>}
        </span>
      )}
    </div>
  )
}

// У проекта нет своих учётных данных хостинга: где их подключить.
export function CredentialsHint({ projectId }: { projectId: string }) {
  return (
    <span className="arch-describe-err" role="alert">
      У проекта нет собственных учётных данных хостинга: Rivet не читает и не описывает архитектуру через общий токен установки.{' '}
      <a href={routeHash({ view: 'project-settings', pid: projectId, tab: 'general' })}>Подключить токен проекта →</a>
    </span>
  )
}

// Ошибка снимка: заголовок по виду, причина бэкенда отдельной строкой,
// подсказка и, без учётных данных проекта, ссылка на их подключение.
export function ArchErrorText({ arch, projectId, compact }: { arch: ProjectArchitecture; projectId: string; compact?: boolean }) {
  const info = archErrorInfo(arch.error_kind)
  return (
    <div className="arch-error-text">
      <b>{info.title}.</b>
      {info.showReason && arch.error && <div className="muted">причина: <span className="mono">{arch.error}</span></div>}
      {!compact && <div className="muted">{info.hint}</div>}
      {info.settings && <a href={routeHash({ view: 'project-settings', pid: projectId, tab: 'general' })}>Подключить токен проекта →</a>}
    </div>
  )
}

// Задача описания или кнопка: что показать, когда описания нет. Если
// задача описания не поможет (сбой хостинга, лимиты, нет учётных данных
// проекта), кнопки нет: причину и что делать показывает ArchErrorText.
export function DescribeAction({ arch, projectId, onStarted, compact }: {
  arch: ProjectArchitecture; projectId: string; onStarted: () => void; compact?: boolean
}) {
  const task = arch.task
  const active = taskActive(task?.status)
  const useless = arch.status === 'error' && !archErrorInfo(arch.error_kind).describe
  return (
    <div className="arch-describe-wrap">
      {task && <DescribeTaskStatus task={task} compact={compact} />}
      {!active && !useless && <DescribeButton projectId={projectId} onStarted={onStarted} primary={!compact}
        retry={task?.status === 'failed'} label={task ? 'Описать заново' : 'Описать архитектуру'} />}
    </div>
  )
}
