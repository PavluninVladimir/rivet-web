import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './form'

// Границы ошибок консоли: падение одного экрана, вкладки, схемы или
// документа не гасит всю консоль (в React 19 без границы падает корень,
// остаётся пустая страница без навигации). Ленивые чанки после обновления
// rivetd отдельный случай: старые хэши в адресах чанков больше не
// существуют, сервер отвечает index.html, и модуль не загружается. Тогда
// консоль один раз перезагружает страницу сама, а при повторе просит
// перезагрузить.

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

// what — что не отрисовалось, в винительном падеже: «экран», «вкладку
// «Подключения»». page — заглушка занимает место экрана (отступы .page).
// fallback — своя заглушка вместо стандартной (схема Mermaid, документ).
// Ошибку сбрасывают смена key у границы (экран или вкладка
// перемонтируется), смена resetKey (дети рисуются заново без
// перемонтирования границы) и кнопка «Повторить».
interface Props {
  what?: string
  page?: boolean
  resetKey?: string
  fallback?: (error: unknown, reset: () => void) => ReactNode
  children: ReactNode
}

export class ErrorBoundary extends Component<Props, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { failed: true, error } }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[rivet] не удалось отрисовать ${this.props.what ?? 'блок'}`, error, info.componentStack)
  }
  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, error: null })
  }
  render() {
    if (!this.state.failed) return this.props.children
    const reset = () => this.setState({ failed: false, error: null })
    if (this.props.fallback) return this.props.fallback(this.state.error, reset)
    return <ViewCrash error={this.state.error} what={this.props.what ?? 'экран'} page={this.props.page} onRetry={reset} />
  }
}

// Стандартная заглушка: остальная консоль работает. Отказ чанка, дошедший
// до границы (автоматическая перезагрузка уже была), просит перезагрузить
// страницу: «Повторить» тут не поможет.
function ViewCrash({ error, what, page, onRetry }: { error: unknown; what: string; page?: boolean; onRetry: () => void }) {
  const chunk = isChunkError(error)
  const msg = error instanceof Error ? error.message || error.name : String(error)
  return (
    <div className={page ? 'page' : undefined} data-error-boundary>
      {chunk ? <ChunkNotice what={what} /> : (
        <div className="view-crash" role="alert">
          <b>Не удалось отрисовать {what}.</b>
          <p>Остальная консоль работает: можно перейти в другой раздел.</p>
          <div className="mono" style={{ margin: '0 0 12px', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{msg.slice(0, 300)}</div>
          <div className="f-actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" onClick={onRetry}>Повторить</Button>
            <Button onClick={() => location.reload()}>Перезагрузить страницу</Button>
          </div>
        </div>
      )}
    </div>
  )
}
