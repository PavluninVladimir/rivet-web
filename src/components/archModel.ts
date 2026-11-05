import type { ArchitectureData, ArchView, C4Element, Decision, Event, ProjectArchitecture, ScenarioView, TaskFailure } from '../api/client'

// Модель представления «Архитектура» (add-architecture-c4,
// add-architecture-erd-sequence-adr): чистые функции без React, чтобы
// проверяться юнит-тестом. Уровни C4, адрес страницы, ссылки на хостинг,
// фильтры решений и сценариев.

// ─── адрес: #/architecture/<вкладка>/<уровень или выбор>/<id>?el=&status= ──

export const ARCH_TABS = ['hld', 'c4', 'deployment', 'erd', 'scenarios', 'decisions', 'check'] as const
export type ArchTab = typeof ARCH_TABS[number]

// sub и id зависят от вкладки: у C4 уровень (context, containers,
// components) и id системы или контейнера, у ERD хранилище, у сценариев
// id сценария, у решений номер. el — выбранный элемент или фильтр по
// элементу, status — фильтр статусов решений через запятую.
export interface ArchRoute { tab: ArchTab; sub?: string; id?: string; el?: string; status?: string }

function dec(s: string | undefined): string | undefined {
  if (!s) return undefined
  try { return decodeURIComponent(s) } catch { return s }
}

export function parseArchRoute(parts: string[], query: string): ArchRoute {
  const q = new URLSearchParams(query)
  const tab = (ARCH_TABS as readonly string[]).includes(parts[0]) ? parts[0] as ArchTab : 'hld'
  const r: ArchRoute = { tab }
  const sub = dec(parts[1]), id = dec(parts[2])
  if (sub) r.sub = sub
  if (sub && id) r.id = id
  const el = q.get('el'), status = q.get('status')
  if (el) r.el = el
  if (status) r.status = status
  return r
}

export function archRouteHash(r: ArchRoute): string {
  let h = `#/architecture/${r.tab}`
  if (r.sub) {
    h += '/' + encodeURIComponent(r.sub)
    if (r.id) h += '/' + encodeURIComponent(r.id)
  }
  const q = new URLSearchParams()
  if (r.el) q.set('el', r.el)
  if (r.status) q.set('status', r.status)
  const qs = q.toString()
  return qs ? `${h}?${qs}` : h
}

// ─── снимок ──────────────────────────────────────────────────────────────

const EMPTY_VIEW: ArchView = { title: '', mermaid: '' }

// Отсутствующие поля старого снимка считаются пустыми: снимок до
// add-architecture-erd-sequence-adr не знает ERD, сценариев и решений.
export function normalizeData(d: Partial<ArchitectureData> | null | undefined): ArchitectureData | null {
  if (!d) return null
  const v = (d.views ?? {}) as Partial<ArchitectureData['views']>
  const erd = (d.erd ?? {}) as Partial<ArchitectureData['erd']>
  return {
    system: { name: d.system?.name ?? '', description: d.system?.description ?? '' },
    principles: d.principles ?? [],
    elements: (d.elements ?? []).map(e => ({ ...e, parent: e.parent || null })),
    views: {
      context: v.context ?? EMPTY_VIEW,
      containers: v.containers ?? [],
      components: v.components ?? [],
      deployment: v.deployment ?? null,
    },
    hld: d.hld ?? '',
    dsl: d.dsl ?? '',
    erd: {
      all: erd.all ?? null,
      stores: erd.stores ?? [],
      entities: (erd.entities ?? []).map(e => ({ ...e, stores: e.stores ?? [], attributes: e.attributes ?? [], relations: e.relations ?? [] })),
    },
    scenarios: (d.scenarios ?? []).map(s => ({ ...s, description: s.description ?? '', process: s.process || null, participants: s.participants ?? [] })),
    decisions: (d.decisions ?? []).map(x => ({ ...x, elements: x.elements ?? [], supersedes: x.supersedes ?? [], superseded_by: x.superseded_by ?? null, body: x.body ?? '' })),
    links: d.links ?? {},
  }
}

export function normalizeArchitecture(a: ProjectArchitecture): ProjectArchitecture {
  return {
    ...a,
    defects: a.defects ?? [],
    source: a.source ?? { branch: '', path: 'docs/architecture', url: '' },
    current: normalizeData(a.current),
    last_valid: a.last_valid ? { ...a.last_valid, data: normalizeData(a.last_valid.data)! } : null,
    task: a.task ?? null,
  }
}

// Что показывать: текущий снимок, а при invalid и error последнюю
// корректную версию с её SHA.
export interface Shown { data: ArchitectureData; sha: string | null; readAt: string | null; lastValid: boolean }
export function shownSnapshot(a: ProjectArchitecture | null): Shown | null {
  if (!a) return null
  if (a.current) return { data: a.current, sha: a.sha, readAt: a.read_at, lastValid: false }
  if (a.last_valid?.data) return { data: a.last_valid.data, sha: a.last_valid.sha, readAt: a.last_valid.read_at, lastValid: true }
  return null
}

// Задача описания ещё идёт: кнопка «Описать архитектуру» не нужна.
export function taskActive(status: string | undefined): boolean {
  return !!status && !['done', 'cancelled', 'failed'].includes(status)
}

// ─── уровни C4 ───────────────────────────────────────────────────────────

export type C4Level = { level: 'context' } | { level: 'containers'; id: string } | { level: 'components'; id: string }

const CONTAINER_KINDS = new Set(['container', 'database', 'queue'])

export function byId(d: ArchitectureData): Map<string, C4Element> {
  return new Map(d.elements.map(e => [e.id, e]))
}

function hasContainers(d: ArchitectureData, systemId: string): boolean {
  return d.views.containers.some(c => c.system_id === systemId)
}
function hasComponents(d: ArchitectureData, containerId: string): boolean {
  return d.views.components.some(c => c.container_id === containerId)
}

// Уровень из адреса. Если уровня больше нет (контейнер удалён после
// merge), берётся ближайший существующий: контейнеры его системы или
// контекст. fallback говорит, что адрес надо заменить.
export function resolveLevel(d: ArchitectureData, sub?: string, id?: string): { lvl: C4Level; fallback: boolean } {
  if (sub === 'containers' && id) {
    if (hasContainers(d, id)) return { lvl: { level: 'containers', id }, fallback: false }
    return { lvl: { level: 'context' }, fallback: true }
  }
  if (sub === 'components' && id) {
    if (hasComponents(d, id)) return { lvl: { level: 'components', id }, fallback: false }
    const parent = byId(d).get(id)?.parent
    if (parent && hasContainers(d, parent)) return { lvl: { level: 'containers', id: parent }, fallback: true }
    return { lvl: { level: 'context' }, fallback: true }
  }
  return { lvl: { level: 'context' }, fallback: !!sub && sub !== 'context' }
}

export function levelRoute(l: C4Level): { sub?: string; id?: string } {
  return l.level === 'context' ? { sub: undefined, id: undefined } : { sub: l.level, id: l.id }
}

export function levelView(d: ArchitectureData, l: C4Level): ArchView | null {
  if (l.level === 'containers') return d.views.containers.find(c => c.system_id === l.id)?.view ?? null
  if (l.level === 'components') return d.views.components.find(c => c.container_id === l.id)?.view ?? null
  return d.views.context.mermaid ? d.views.context : null
}

const KIND_ORDER: Record<string, number> = { person: 0, system: 1, container: 2, database: 3, queue: 4, component: 5 }
function sortEls(list: C4Element[]): C4Element[] {
  return [...list].sort((a, b) => Number(a.external) - Number(b.external)
    || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name, 'ru'))
}

// Элементы уровня для списка рядом со схемой: на контексте люди и
// системы, на контейнерах — контейнеры системы, на компонентах —
// компоненты контейнера. Внутренние идут первыми.
export function levelElements(d: ArchitectureData, l: C4Level): C4Element[] {
  if (l.level === 'context') return sortEls(d.elements.filter(e => !e.parent && (e.kind === 'person' || e.kind === 'system')))
  return sortEls(d.elements.filter(e => e.parent === l.id))
}

// Куда ведёт переход вниз с элемента: система — на свои контейнеры,
// контейнер — на свои компоненты. null — ниже уровня нет.
export function drillTarget(d: ArchitectureData, e: C4Element): C4Level | null {
  if (e.kind === 'system' && hasContainers(d, e.id)) return { level: 'containers', id: e.id }
  if (CONTAINER_KINDS.has(e.kind) && hasComponents(d, e.id)) return { level: 'components', id: e.id }
  return null
}

// Уровень, на котором элемент виден: обратные ссылки из решений и
// сценариев ведут сюда. Элемент вне C4 (процесс, сущность) — контекст.
export function elementLevel(d: ArchitectureData, id: string): C4Level {
  const m = byId(d)
  const e = m.get(id)
  if (!e) return { level: 'context' }
  if (e.kind === 'component' && e.parent) {
    if (hasComponents(d, e.parent)) return { level: 'components', id: e.parent }
    return elementLevel(d, e.parent)
  }
  if (CONTAINER_KINDS.has(e.kind) && e.parent && hasContainers(d, e.parent)) return { level: 'containers', id: e.parent }
  return { level: 'context' }
}

// Хлебные крошки: контекст → контейнеры системы → компоненты контейнера.
export function crumbs(d: ArchitectureData, l: C4Level): { label: string; lvl: C4Level }[] {
  const m = byId(d)
  const out: { label: string; lvl: C4Level }[] = [{ label: 'Контекст', lvl: { level: 'context' } }]
  let systemId = l.level === 'containers' ? l.id : undefined
  if (l.level === 'components') systemId = m.get(l.id)?.parent ?? undefined
  if (systemId && hasContainers(d, systemId)) {
    out.push({ label: `${m.get(systemId)?.name ?? systemId} · контейнеры`, lvl: { level: 'containers', id: systemId } })
  }
  if (l.level === 'components') out.push({ label: `${m.get(l.id)?.name ?? l.id} · компоненты`, lvl: l })
  return out
}

// ─── узлы SVG ────────────────────────────────────────────────────────────

const ws = (s: string) => s.replace(/\s+/g, ' ').trim()

// Mermaid C4 не пишет псевдоним в SVG узла (у g.person-man нет ни id, ни
// data-id). Поэтому узел сопоставляется с исходным текстом схемы по
// сигнатуре: строка типа (<<container>>, <<external_system>>,
// <<container_db>>) и имя, которое Mermaid рисует жирными строками.
// Описание и технология в сопоставление не входят. В исходнике у фигуры
// есть псевдоним, а псевдоним элемента отдаёт снимок (C4Element.alias).
// Полные тёзки одного типа различаются порядком объявления.

export interface C4Shape { alias: string; type: string; label: string }

// Макрос Mermaid C4 → строка типа на схеме: Container_Ext → external_container,
// ContainerDb → container_db, SystemQueue_Ext → external_system_queue.
export function c4MacroType(macro: string): string {
  const ext = macro.endsWith('_Ext')
  const m = /^(Person|System|Container|Component)(Db|Queue)?/.exec(ext ? macro.slice(0, -4) : macro)
  if (!m) return ''
  const t = m[1].toLowerCase() + (m[2] ? '_' + m[2].toLowerCase() : '')
  return ext ? 'external_' + t : t
}

const SHAPE_RE = /^\s*((?:Person|System|Container|Component)(?:Db|Queue)?(?:_Ext)?)\(\s*([^,\s)]+)\s*,\s*"([^"]*)"/

// Фигуры из исходного текста схемы в порядке объявления.
export function parseC4Shapes(code: string): C4Shape[] {
  const out: C4Shape[] = []
  for (const line of code.split('\n')) {
    const m = SHAPE_RE.exec(line)
    // Директивы %%{…}%% Mermaid вырезает из текста до отрисовки: на схеме
    // имени без них.
    if (m) out.push({ alias: m[2], type: c4MacroType(m[1]), label: ws(m[3].replace(/%%\{.*?\}%%/g, '')) })
  }
  return out
}

export interface C4NodeText { text: string; bold: boolean }

// Сигнатура узла SVG: тип из строки <<…>> и имя из жирных строк подряд.
export function c4NodeSignature(texts: C4NodeText[]): { type: string; name: string } {
  let type = ''
  const name: string[] = []
  for (const t of texts) {
    const m = /^<<(.+)>>$/.exec(t.text.trim())
    if (m && !type) { type = m[1].trim(); continue }
    if (t.bold) name.push(t.text)
    else if (name.length) break
  }
  return { type, name: ws(name.join(' ')) }
}

const sigKey = (type: string, name: string) => `${type}\u0000${name}`

// Элементы для узлов схемы по порядку узлов в SVG: i-й узел с данной
// сигнатурой — i-я фигура исходника с той же сигнатурой.
export function matchC4Nodes(code: string, nodes: { type: string; name: string }[], elements: C4Element[]): (C4Element | undefined)[] {
  const byAlias = new Map(elements.filter(e => e.alias).map(e => [e.alias!, e]))
  const groups = new Map<string, C4Shape[]>()
  for (const sh of parseC4Shapes(code)) {
    const k = sigKey(sh.type, sh.label)
    groups.set(k, [...(groups.get(k) ?? []), sh])
  }
  const seen = new Map<string, number>()
  return nodes.map(n => {
    const k = sigKey(n.type, n.name)
    const i = seen.get(k) ?? 0
    seen.set(k, i + 1)
    const sh = groups.get(k)?.[i]
    return sh ? byAlias.get(sh.alias) : undefined
  })
}

// Вид диаграммы по первой значимой строке исходного текста.
export function diagramKind(code: string): 'c4' | 'er' | 'sequence' | 'other' {
  const first = code.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('%%')) ?? ''
  if (/^C4(Context|Container|Component|Dynamic|Deployment)\b/.test(first)) return 'c4'
  if (/^erDiagram\b/.test(first)) return 'er'
  if (/^sequenceDiagram\b/.test(first)) return 'sequence'
  return 'other'
}

// ─── ссылки на хостинг ────────────────────────────────────────────────────

// Нормализация пути: убирает «.» и разворачивает «..».
export function joinPath(base: string, rel: string): string {
  const out: string[] = []
  for (const p of [...base.split('/'), ...rel.split('/')]) {
    if (!p || p === '.') continue
    if (p === '..') out.pop(); else out.push(p)
  }
  return out.join('/')
}

// Файл на хостинге по пути от корня репозитория. Ссылка source.url ведёт
// на каталог: …/tree/<ветка>/<каталог> у GitHub, …/-/tree/… у GitLab.
// Префикс репозитория отрезается по известному хвосту, чтобы «/tree/» в
// имени ветки не сбивал. Файл берётся из SHA снимка, если он известен.
export function hostingFileURL(source: { url: string; branch: string; path?: string } | undefined, ref: string | null | undefined, path: string): string {
  if (!source?.url) return ''
  const tails = [`/tree/${source.branch}/${source.path ?? ''}`.replace(/\/+$/, ''), `/tree/${source.branch}`]
  let prefix = ''
  for (const t of tails) {
    if (source.branch && source.url.endsWith(t)) { prefix = source.url.slice(0, -t.length); break }
  }
  if (!prefix) {
    const i = source.url.lastIndexOf('/tree/')
    if (i < 0) return ''
    prefix = source.url.slice(0, i)
  }
  return `${prefix}/blob/${ref || source.branch}/${path.replace(/^\/+/, '')}`
}

// Ссылка из документа описания (HLD, тело ADR) на файл: относительная —
// от каталога документа, «/путь» — от корня репозитория, чистый якорь
// остаётся текстом.
export function docLinkURL(source: { url: string; branch: string; path?: string } | undefined, ref: string | null | undefined, docDir: string, href: string): string {
  if (!source) return ''
  const clean = href.split('#')[0]
  if (!clean) return ''
  const path = clean.startsWith('/') ? joinPath('', clean) : joinPath(docDir, clean)
  return path ? hostingFileURL(source, ref, path) : ''
}

// Ссылка из HLD: документ лежит в <каталог>/views/hld.md.
export function hldLinkURL(source: { url: string; branch: string; path: string } | undefined, ref: string | null | undefined, rel: string): string {
  return docLinkURL(source, ref, `${source?.path || 'docs/architecture'}/views`, rel)
}

export function dirOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

// ─── решения и сценарии ──────────────────────────────────────────────────

export const ADR_STATUSES = ['accepted', 'proposed', 'superseded', 'deprecated', 'rejected'] as const
export const ADR_DEFAULT: string[] = ['accepted', 'proposed']
export const ADR_STATUS_LABEL: Record<string, string> = {
  accepted: 'принято', proposed: 'предложено', superseded: 'заменено', deprecated: 'устарело', rejected: 'отклонено',
}

// Фильтр статусов из адреса: пусто — по умолчанию принятые и предложенные,
// «all» — все статусы.
export function parseStatusFilter(s: string | undefined): string[] {
  if (!s) return ADR_DEFAULT
  if (s === 'all') return [...ADR_STATUSES]
  const list = s.split(',').filter(x => (ADR_STATUSES as readonly string[]).includes(x))
  return list.length ? list : ADR_DEFAULT
}
export function statusFilterParam(list: string[]): string | undefined {
  const set = new Set(list)
  if (set.size === ADR_DEFAULT.length && ADR_DEFAULT.every(x => set.has(x))) return undefined
  if (ADR_STATUSES.every(x => set.has(x))) return 'all'
  return ADR_STATUSES.filter(x => set.has(x)).join(',')
}

export function filterDecisions(list: Decision[], statuses: string[], el?: string): Decision[] {
  return list.filter(d => statuses.includes(d.status) && (!el || d.elements.includes(el)))
    .sort((a, b) => a.number - b.number)
}

export function adrLabel(n: number): string {
  return `ADR-${String(n).padStart(4, '0')}`
}

// Сценарии элемента: элемент — участник, процесс сценария или упомянут в
// индексе связей снимка.
export function filterScenarios(d: ArchitectureData, el?: string): ScenarioView[] {
  if (!el) return d.scenarios
  const linked = new Set(d.links[el]?.scenarios ?? [])
  return d.scenarios.filter(s => linked.has(s.id) || s.process === el || s.participants.some(p => p.id === el))
}

export function linkCounts(d: ArchitectureData, id: string): { decisions: number; scenarios: number } {
  const l = d.links[id]
  return { decisions: l?.decisions?.length ?? 0, scenarios: l?.scenarios?.length ?? 0 }
}

// Подпись элемента по id: имя из C4, сущности или процесса сценария,
// иначе сам id.
export function elementName(d: ArchitectureData, id: string): string {
  return d.elements.find(e => e.id === id)?.name
    ?? d.erd.entities.find(e => e.id === id)?.name
    ?? id
}

// ─── ошибки снимка и задачи описания ─────────────────────────────────────

// Текст ошибки снимка по виду (error_kind). Заголовок зависит только от
// вида: причина бэкенда (error) показывается отдельной строкой, иначе она
// повторяет заголовок. settings — подсказать подключение учётных данных
// проекта. describe — поможет ли задача описания: при сбое хостинга,
// превышении лимитов и без учётных данных кнопка не нужна.
export interface ArchErrorInfo { title: string; hint: string; settings: boolean; describe: boolean; showReason: boolean }
export function archErrorInfo(kind: string | null | undefined): ArchErrorInfo {
  switch (kind) {
    case 'no_credentials':
      return { title: 'У проекта нет собственных учётных данных хостинга', settings: true, describe: false, showReason: false,
        hint: 'Через общий токен установки Rivet описание не читает и не пишет. Подключите токен проекта в настройках, снимок обновится сам.' }
    case 'host':
      return { title: 'Хостинг не ответил', settings: false, describe: false, showReason: true,
        hint: 'Снимок перечитается при следующем merge или по кнопке «Обновить снимок».' }
    case 'limit':
      return { title: 'Описание слишком большое для чтения через API хостинга', settings: false, describe: false, showReason: true,
        hint: 'Снимок читает не больше 600 файлов и 8 МиБ, из них до 100 сценариев и 300 решений. Сократите описание или перенесите старые решения в архив.' }
    case 'data':
      return { title: 'Описание прочитано, но не разобрано', settings: false, describe: true, showReason: true,
        hint: 'Исправьте файлы описания или поставьте задачу описания заново.' }
    default:
      return { title: 'Описание не удалось прочитать', settings: false, describe: true, showReason: true,
        hint: 'Снимок обновится после следующего merge или по кнопке «Обновить снимок».' }
  }
}

// Отказ merge задачи описания (409 architecture_outside_docs): PR
// меняет файлы вне docs/architecture (outside_docs) или список файлов PR
// неполный и границу проверить нельзя (files_truncated). merged — внешний
// merge на хостинге уже прошёл.
export const MERGE_REJECT_REASONS = ['architecture_outside_docs', 'architecture_files_truncated']
export interface OutsideDocs { reason: string; files: string[]; total: number; merged: boolean; message: string }
const strFiles = (v: unknown) => Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []
function rejectOf(p: Record<string, unknown>, message: string): OutsideDocs | null {
  const reason = typeof p.reason === 'string' ? p.reason : ''
  if (!MERGE_REJECT_REASONS.includes(reason)) return null
  const files = strFiles(p.files)
  const total = typeof p.files_total === 'number' ? Math.max(p.files_total, files.length) : files.length
  return { reason, files, total, merged: p.merged === true, message }
}
export function outsideDocsEvent(e: Event): OutsideDocs | null {
  const p = e.Payload && typeof e.Payload === 'object' ? e.Payload as Record<string, unknown> : null
  if (e.Type !== 'task.status' || !p) return null
  return rejectOf(p, e.Text)
}
// Поле failure задачи: причина без поиска по событиям.
export function outsideDocsFailure(f: TaskFailure | null | undefined): OutsideDocs | null {
  if (!f) return null
  return rejectOf(f as unknown as Record<string, unknown>, typeof f.message === 'string' ? f.message : '')
}
// Старый бэкенд без failure: последнее событие отказа в истории задачи.
export function outsideDocsOf(timeline: Event[] | null | undefined): OutsideDocs | null {
  let found: OutsideDocs | null = null
  for (const e of timeline ?? []) {
    const o = outsideDocsEvent(e)
    if (o) found = o
    // Задачу вернули в работу после отказа: причина больше не актуальна.
    else if (found && e.Type === 'task.status' && e.Payload?.status && e.Payload.status !== 'failed') found = null
  }
  return found
}

// Ответы merge задачи описания понятным текстом.
export const MERGE_ERROR_TEXT: Record<string, string> = {
  architecture_head_moved: 'PR обновился после проверки файлов: merge не выполнен, задача вернулась на шаг check.',
  architecture_files_unavailable: 'Хостинг не отдал список файлов PR: merge не выполнен, повторите позже.',
  architecture_outside_docs: 'PR задачи описания меняет файлы вне docs/architecture или их список неполный: merge не выполнен, задача переведена в failed.',
}

// Понятные пояснения к дефектам снимка, которые не исправить правкой
// модели: символические ссылки и устаревшие представления.
export function defectHints(defects: { rule: string }[]): string[] {
  const out: string[] = []
  if (defects.some(d => d.rule === 'file.symlink')) {
    out.push('В каталоге описания есть символические ссылки. Rivet их не читает: замените ссылки обычными файлами.')
  }
  if (defects.some(d => d.rule === 'views.stale')) {
    out.push('Представления в views/ устарели после обновления Rivet или правки модели. Перегенерируйте их командой rivet architecture views и закоммитьте или поставьте задачу описания заново.')
  }
  return out
}

// Событие project.architecture_updated не требует перечитывания: снимок
// тот же (SHA и статус совпадают) или событие старше показанного снимка
// (реплей истории потока при открытии). Время события и время чтения
// снимка — оба по часам сервера.
export function architectureEventStale(e: Event, arch: ProjectArchitecture | null): boolean {
  if (!arch) return false
  const p = e.Payload && typeof e.Payload === 'object' ? e.Payload as Record<string, unknown> : {}
  if (typeof p.sha === 'string' && p.sha === arch.sha && p.status === arch.status) return true
  const ts = Date.parse(e.TS), readAt = arch.read_at ? Date.parse(arch.read_at) : NaN
  return Number.isFinite(ts) && Number.isFinite(readAt) && ts < readAt
}

// Событие задачи пришло после загрузки снимка, если его время не раньше
// времени сервера на момент ответа (заголовок Date, точность до секунды:
// секунда запаса). Сравнение только по часам сервера: часы браузера
// могут расходиться с ним на любую величину. Без времени загрузки
// событие считается новым.
export function eventAfterLoad(ts: string, loadedServerAt: number | null): boolean {
  if (loadedServerAt == null) return true
  const t = Date.parse(ts)
  return !Number.isFinite(t) || t >= loadedServerAt - 1000
}
