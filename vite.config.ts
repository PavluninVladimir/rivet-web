import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Консоли нужны четыре вида схем Mermaid: C4, sequence, ER и flowchart
// (блоки mermaid в теле ADR). Остальные виды, раскладки cose-bilkent и
// swimlanes и KaTeX при сборке заменяются заглушками: сборка встраивается
// в бинарь rivetd, без заглушек dist растёт с 0,5 до 3,9 МБ. Схема
// неподдержанного вида падает с ошибкой, и консоль показывает её исходный
// текст с причиной, как для любой ошибки отрисовки. В dev Mermaid
// предсобирается целиком, заглушки работают только в сборке.
const KEEP = /\/(c4Diagram|sequenceDiagram|erDiagram|flowDiagram)-[A-Z0-9]+\.mjs$/
const DIAGRAM = /mermaid\/dist\/chunks\/mermaid\.core\/([A-Za-z0-9]+Diagram(-v2)?|diagram|[a-z]+-definition)-[A-Z0-9]+\.mjs$/
const LAYOUT = /mermaid\/dist\/chunks\/mermaid\.core\/(cose-bilkent|swimlanes)-[A-Z0-9]+\.mjs$/
const KATEX = /katex\/dist\/katex\.mjs$/
const KEPT = ['c4Diagram', 'sequenceDiagram', 'erDiagram', 'flowDiagram']

// KaTeX-заглушка: формула $$…$$ в подписи показывается исходным текстом,
// а не роняет схему.
const KATEX_STUB = `const esc = s => String(s).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';')
export const renderToString = s => esc(s)
export const render = () => { throw new Error("формулы не поддерживаются консолью") }
export default { renderToString, render }
`

function trimMermaid(): Plugin {
  const kept = new Set<string>()
  return {
    name: 'rivet-trim-mermaid',
    enforce: 'pre',
    apply: 'build',
    buildStart() { kept.clear() },
    load(id) {
      const file = id.split('?')[0]
      if (KATEX.test(file)) return KATEX_STUB
      if (LAYOUT.test(file)) {
        return 'export default {}\nexport const render = () => { throw new Error("раскладка не поддерживается консолью") }\n'
      }
      if (DIAGRAM.test(file) && KEEP.test(file)) {
        kept.add(file.split('/').pop()!.replace(/-[A-Z0-9]+\.mjs$/, ''))
        return null
      }
      if (DIAGRAM.test(file)) {
        return 'export const diagram = { parser: { parse() { throw new Error("вид схемы не поддерживается консолью: доступны C4, sequence, ER и flowchart") } }, db: {}, renderer: { draw() {} } }\n'
      }
      return null
    },
    // Заглушки выбираются по имени файла: после обновления mermaid имена
    // чанков могут смениться, и нужная схема молча заменится заглушкой.
    // Сборка падает, если сохранились не ровно четыре нужных вида.
    buildEnd(err) {
      if (err) return
      const got = [...kept].sort().join(', ')
      if (kept.size !== KEPT.length || !KEPT.every(k => kept.has(k))) {
        this.error(`trim-mermaid: ожидались ${KEPT.join(', ')}, сохранены: ${got || 'ничего'}. Проверьте имена чанков mermaid.`)
      }
    },
  }
}

// NOTICE консоли (уведомления пакетов бандла, npm run third-party) едет в
// dist рядом с third-party-licenses.md: rivetd встраивает dist, и NOTICE и
// THIRD_PARTY репозитория rivet собираются из встроенной сборки, а не из
// соседнего клона.
function emitNotice(): Plugin {
  return {
    name: 'rivet-emit-notice',
    apply: 'build',
    generateBundle() {
      const notice = fileURLToPath(new URL('./NOTICE', import.meta.url))
      if (existsSync(notice)) this.emitFile({ type: 'asset', fileName: 'NOTICE', source: readFileSync(notice, 'utf8') })
    },
  }
}

// Dev-прокси на rivetd: CORS не нужен (design build-web-console).
export default defineConfig({
  plugins: [trimMermaid(), react(), emitNotice()],
  // Лицензии зависимостей, попавших в бандл (open-source, AGPL и чужие
  // уведомления): Rollup при сборке выбрасывает лицензионные комментарии
  // из кода пакетов, поэтому имена, версии и тексты лицензий всех
  // встроенных пакетов собираются в отдельный файл рядом с index.html. Он
  // встраивается в rivetd вместе с консолью.
  build: {
    license: { fileName: 'third-party-licenses.md' },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8181', changeOrigin: false },
    },
  },
})
