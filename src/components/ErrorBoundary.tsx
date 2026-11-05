import { Component, type ReactNode } from 'react'
import { Button } from './form'

// Границы ошибок консоли: падение одного экрана, схемы или документа не
// гасит всю консоль. Ленивые чанки после обновления rivetd отдельный
// случай: старые хэши в адресах чанков больше не существуют, сервер
// отвечает index.html, и модуль не загружается. Тогда консоль один раз
// перезагружает страницу сама, а при повторе просит перезагрузить.

export function isChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|valid JavaScript MIME type/i.test(m)
}

const RELOAD_KEY = 'rivet:chunk-reload'
const RELOAD_GAP_MS = 60_000

// Фабрика для React.lazy: при отказе загрузки чанка одна автоматическая
// перезагрузка. Флаг в sessionStorage не даёт уйти в цикл: повторный
// отказ в течение минуты доходит до границы ошибок. Без sessionStorage
// автоматической перезагрузки нет.
export function lazyWithReload<T>(factory: () => Promise<T>): () => Promise<T> {
  return () => factory().then(
    m => m,
    e => {
      if (!isChunkError(e) || !reloadForChunk()) throw e
      return new Promise<T>(() => {})
    },
  )
}

// Одна перезагрузка страницы на отказ чанка в минуту: true — перезагрузка
// пошла. Общая для чанков экранов и схем Mermaid. Флаг не снимается при
// удачной загрузке: иначе удачный чанк экрана и упавший чанк схемы на
// той же странице перезагружали бы её по кругу. Он просто стареет.
export function reloadForChunk(): boolean {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0 } catch { return false }
  if (Date.now() - last < RELOAD_GAP_MS) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { return false }
  location.reload()
  return true
}

// Подсказка вместо сырой ошибки загрузки чанка.
export function ChunkNotice({ what = 'этот раздел' }: { what?: string }) {
  return (
    <div className="view-crash" role="alert">
      <b>Консоль обновилась</b>
      <p>Установку Rivet обновили, а страница осталась от прежней версии. Перезагрузите страницу, чтобы открыть {what}.</p>
      <Button variant="primary" onClick={() => location.reload()}>Перезагрузить страницу</Button>
    </div>
  )
}

interface Props { resetKey?: string; fallback: (error: unknown, reset: () => void) => ReactNode; children: ReactNode }

export class ErrorBoundary extends Component<Props, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { failed: true, error } }
  componentDidCatch(error: unknown) { console.error('[rivet] экран упал', error) }
  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, error: null })
  }
  render() {
    if (this.state.failed) return this.props.fallback(this.state.error, () => this.setState({ failed: false, error: null }))
    return this.props.children
  }
}

// Заглушка упавшего экрана: остальная консоль работает.
export function ViewCrash({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const chunk = isChunkError(error)
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="page">
      <div className="view-crash" role="alert">
        <b>{chunk ? 'Консоль обновилась' : 'Экран не открылся'}</b>
        <p>{chunk
          ? 'Установку Rivet обновили, а страница осталась от прежней версии. Перезагрузите страницу, чтобы открыть этот раздел.'
          : <>Ошибка на этом экране: <span className="mono">{msg.slice(0, 300)}</span>. Остальные разделы работают.</>}</p>
        <div className="f-actions" style={{ justifyContent: 'flex-start' }}>
          <Button variant="primary" onClick={() => location.reload()}>Перезагрузить страницу</Button>
          {!chunk && <Button onClick={onRetry}>Повторить</Button>}
        </div>
      </div>
    </div>
  )
}
