import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errCode, type ArchDefect, type ArchitectureData, type C4Element, type Decision, type ErdEntity, type ProjectArchitecture } from '../api/client'
import { routeHash, useStore, type Route } from '../store'
import { Mermaid } from '../components/Mermaid'
import { DocMarkdown } from '../components/DocMarkdown'
import { useArchitecture } from '../components/useArchitecture'
import { ArchErrorText, ArchStatus, CredentialsHint, DescribeAction } from '../components/ArchitectureParts'
import {
  ADR_STATUSES, ADR_STATUS_LABEL, adrLabel, defectHints, crumbs, drillTarget, elementLevel, elementName, filterDecisions,
  c4NodeSignature, dirOf, docLinkURL, filterScenarios, hldLinkURL, hostingFileURL, levelElements, levelRoute, levelView, linkCounts, matchC4Nodes,
  parseStatusFilter, resolveLevel, shownSnapshot, statusFilterParam, type ArchRoute, type ArchTab, type C4Level, type Shown,
} from '../components/archModel'
import { Tabs, fmtAgo, fmtDate } from '../components/ui'
import { Button, errText } from '../components/form'

// Представление «Архитектура» проекта (спеки web add-architecture-c4 и
// add-architecture-erd-sequence-adr). Полоса снимка над содержимым,
// вкладки HLD, C4, Развёртывание, Данные (ERD), Сценарии, Решения (ADR),
// Проверка. Вкладка, уровень C4, выбранный элемент и фильтры — в адресе.

type ArchR = Extract<Route, { view: 'architecture' }>
// go — переход внутри представления, go.href — тот же адрес для ссылки:
// навигация доступна с клавиатуры и копируется.
type Go = ((patch: Partial<ArchRoute>, opts?: { replace?: boolean }) => void) & { href: (patch: Partial<ArchRoute>) => string }

const KIND_LABEL: Record<string, string> = {
  person: 'человек', system: 'система', container: 'контейнер', database: 'база данных', queue: 'очередь', component: 'компонент',
}

export function ArchitectureView({ route }: { route: ArchR }) {
  const { projectId, projects, nav } = useStore()
  const project = projects.find(p => p.ID === projectId)
  const { arch, err, refresh, refreshing, refreshNote, startRefresh } = useArchitecture(projectId)
  const shown = shownSnapshot(arch)

  const go = useMemo<Go>(() => {
    const next = (patch: Partial<ArchRoute>): ArchR => ({ ...route, ...patch, view: 'architecture' })
    return Object.assign((patch: Partial<ArchRoute>, opts?: { replace?: boolean }) => {
      if (opts?.replace) location.replace(routeHash(next(patch))); else nav(next(patch))
    }, { href: (patch: Partial<ArchRoute>) => routeHash(next(patch)) })
  }, [route, nav])

  if (!projectId) return <div className="page"><span className="muted">Нет проекта: подключите репозиторий в разделе «Проекты».</span></div>

  const defects = arch?.defects ?? []
  const errors = defects.filter(d => d.severity === 'error').length
  const tabs: { id: ArchTab; label: string }[] = [
    { id: 'hld', label: 'HLD' },
    { id: 'c4', label: 'C4' },
    { id: 'deployment', label: 'Развёртывание' },
    { id: 'erd', label: 'Данные (ERD)' },
    { id: 'scenarios', label: 'Сценарии' },
    { id: 'decisions', label: 'Решения (ADR)' },
    { id: 'check', label: defects.length ? `Проверка · ${defects.length}` : 'Проверка' },
  ]

  return (
    <div className="page arch-page">
      <div className="page-head">
        <h1>Архитектура</h1>
        <span className="sub">{shown?.data.system.name || project?.Name}</span>
      </div>
      {!arch
        ? <div className="muted">{err || 'Загрузка снимка…'}</div>
        : <>
          <SnapshotStrip arch={arch} shown={shown} projectId={projectId} refreshing={refreshing} refreshNote={refreshNote} startRefresh={startRefresh} />
          {err && <div className="f-note err" role="alert" style={{ marginBottom: 8 }}>Снимок не обновился: {err}</div>}
          {shown?.lastValid && (
            <div className="arch-warn">
              {arch.status === 'invalid'
                ? <>Описание на <span className="mono">{short(arch.sha)}</span> не проходит проверку: {errors ? `ошибок ${errors}` : 'есть дефекты'}. </>
                : <>Снимок на <span className="mono">{short(arch.sha)}</span> не прочитан. </>}
              Показана последняя корректная версия <span className="mono">{short(shown.sha)}</span>
              {shown.readAt && <> от {fmtDate(shown.readAt)}</>}.
              {defectHints(defects).map((h, i) => <div key={i} className="arch-hint-line">{h}</div>)}
              {route.tab !== 'check' && defects.length > 0 && (
                <ul className="arch-warn-defects">
                  {defects.slice(0, 5).map((x, i) => (
                    <li key={i}><span className={'arch-sev arch-sev-' + x.severity}>{x.severity === 'error' ? 'ошибка' : 'предупр.'}</span>{' '}
                      <span className="mono">{x.rule}</span> <span className="mono muted">{x.file}{x.location ? `:${x.location}` : ''}</span> {x.message}</li>
                  ))}
                </ul>
              )}
              {arch.status === 'error' && <ArchErrorText arch={arch} projectId={projectId} />}
              {route.tab !== 'check' && defects.length > 0 && <a href={go.href({ tab: 'check', sub: undefined, id: undefined, el: undefined })}>{defects.length > 5 ? `Все дефекты (${defects.length}) →` : 'Дефекты подробно →'}</a>}
            </div>
          )}
          {shown
            ? <>
              <Tabs tabs={tabs} active={route.tab}
                onChange={t => go({ tab: t, sub: undefined, id: undefined, el: undefined, status: route.status })} />
              <TabBody arch={arch} shown={shown} route={route} go={go} projectId={projectId} onStarted={refresh} />
            </>
            : <NoSnapshot arch={arch} projectId={projectId} onStarted={refresh} />}
        </>}
    </div>
  )
}

// Строки узла C4: каждая строка Mermaid — отдельный <text>, имя жирное.
function nodeTexts(n: Element): { text: string; bold: boolean }[] {
  return [...n.querySelectorAll('text')].map(t => {
    const w = (t as SVGTextElement).style.fontWeight || t.getAttribute('font-weight') || ''
    return { text: t.textContent ?? '', bold: w === 'bold' || Number(w) >= 600 }
  })
}

function short(sha: string | null | undefined): string { return sha ? sha.slice(0, 12) : '—' }

// ─── полоса снимка ───────────────────────────────────────────────────────

function SnapshotStrip({ arch, shown, projectId, refreshing, refreshNote, startRefresh }: {
  arch: ProjectArchitecture; shown: Shown | null; projectId: string
  refreshing: boolean; refreshNote: string; startRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ReactNode>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 8000)
    return () => clearTimeout(t)
  }, [note])
  // 202 — чтение запущено, ждём снимок новее; 200 fresh — чтение пропущено.
  const refreshSnap = async () => {
    setBusy(true); setErr(null); setNote('')
    try {
      const r = await api.refreshArchitecture(projectId)
      if (r?.status === 'fresh') {
        setNote(r.retry_after_s ? `снимок свежий, повторить через ${r.retry_after_s} с` : 'снимок свежий')
      } else {
        startRefresh()
      }
    } catch (e) {
      const code = errCode(e)
      setErr(code === 'no_credentials' ? <CredentialsHint projectId={projectId} />
        : code === 'repo_not_connected' ? 'у проекта нет подключённого репозитория' : errText(e))
    } finally { setBusy(false) }
  }
  const readAt = shown && !shown.lastValid ? shown.readAt : arch.read_at
  return (
    <div className="arch-strip" data-status={arch.status}>
      <ArchStatus s={arch.status} />
      {arch.sha && <span className="mono" title={arch.sha}>{short(arch.sha)}</span>}
      {readAt && <span className="muted" title={fmtDate(readAt)}>прочитан {fmtAgo(readAt)}</span>}
      {arch.source.branch && <span className="muted">ветка <span className="mono">{arch.source.branch}</span></span>}
      {arch.source.url
        ? <a className="mono" href={arch.source.url} target="_blank" rel="noopener noreferrer">{arch.source.path} ↗</a>
        : <span className="mono muted">{arch.source.path}</span>}
      <span className="arch-strip-right">
        {refreshing && <span className="muted pulse" role="status">снимок обновляется…</span>}
        {(note || refreshNote) && <span className="muted" role="status">{note || refreshNote}</span>}
        {err && (typeof err === 'string' ? <span className="arch-describe-err" role="alert">{err}</span> : err)}
        <Button size="sm" busy={busy} busyLabel="обновляю…" disabled={refreshing} onClick={refreshSnap}>Обновить снимок</Button>
      </span>
    </div>
  )
}

// ─── нет снимка ──────────────────────────────────────────────────────────

function NoSnapshot({ arch, projectId, onStarted }: { arch: ProjectArchitecture; projectId: string; onStarted: () => void }) {
  const text: Record<string, ReactNode> = {
    pending: 'Снимок архитектуры ещё строится: Rivet читает описание с основной ветки. Обычно это занимает несколько секунд.',
    absent: <>В репозитории нет описания архитектуры (<span className="mono">{arch.source.path}</span>). Архитектор опишет проект как есть: HLD, схемы C4, данные, ключевые сценарии и архитектурные решения. Описание придёт pull request’ом и после merge появится здесь.</>,
    invalid: 'Описание архитектуры есть, но не проходит проверку, а корректной версии ещё не было. Дефекты ниже, их исправит задача описания или разработчик.',
  }
  return (
    <div className="arch-empty">
      {arch.status === 'error'
        ? <div style={{ marginBottom: 12 }}><ArchErrorText arch={arch} projectId={projectId} /></div>
        : <p>{text[arch.status] ?? 'Описания архитектуры нет.'}</p>}
      {arch.status !== 'pending' && <DescribeAction arch={arch} projectId={projectId} onStarted={onStarted} />}
      {defectHints(arch.defects).map((h, i) => <div key={i} className="arch-warn" style={{ marginTop: 12 }}>{h}</div>)}
      {arch.defects.length > 0 && <div style={{ marginTop: 16 }}><DefectsTable defects={arch.defects} /></div>}
    </div>
  )
}

// Пустая вкладка: чего не хватает в описании и переход к задаче описания.
function EmptyTab({ children, arch, projectId, onStarted }: { children: ReactNode; arch: ProjectArchitecture; projectId: string; onStarted: () => void }) {
  return (
    <div className="arch-empty">
      <p>{children}</p>
      <DescribeAction arch={arch} projectId={projectId} onStarted={onStarted} compact />
    </div>
  )
}

// ─── вкладки ─────────────────────────────────────────────────────────────

interface TabProps { arch: ProjectArchitecture; shown: Shown; route: ArchR; go: Go; projectId: string; onStarted: () => void }

function TabBody(p: TabProps) {
  const d = p.shown.data
  const empty = (text: ReactNode) => <EmptyTab arch={p.arch} projectId={p.projectId} onStarted={p.onStarted}>{text}</EmptyTab>
  switch (p.route.tab) {
    case 'hld':
      return d.hld.trim()
        ? <div className="arch-doc"><DocMarkdown text={d.hld}
          resolveLink={href => hldLinkURL(p.arch.source, p.shown.sha, href)}
          renderCode={(lang, code) => lang === 'mermaid' ? <Mermaid code={code} className="arch-doc-diagram" /> : null} /></div>
        : empty('В снимке нет HLD: описание собрано без обзорного документа. Задача описания строит его из модели.')
    case 'c4': return <C4Tab {...p} />
    case 'deployment':
      return d.views.deployment?.mermaid
        ? <>
          <div className="arch-crumbs"><b>{d.views.deployment.title || 'Развёртывание'}</b></div>
          <div className="arch-canvas"><Mermaid code={d.views.deployment.mermaid} label={d.views.deployment.title} /></div>
        </>
        : empty(<>Развёртывание не описано: в слое технологий (<span className="mono">model/technology.yaml</span>) нет узлов.</>)
    case 'erd': return <ErdTab {...p} />
    case 'scenarios': return <ScenariosTab {...p} />
    case 'decisions': return <DecisionsTab {...p} />
    case 'check':
      return (
        <div>
          {p.arch.status === 'error' && <div className="budget-pause" style={{ marginBottom: 12 }}>
            <ArchErrorText arch={p.arch} projectId={p.projectId} />
          </div>}
          {defectHints(p.arch.defects).map((h, i) => <div key={i} className="arch-warn" style={{ marginBottom: 10 }}>{h}</div>)}
          {p.arch.defects.length
            ? <DefectsTable defects={p.arch.defects} />
            : <div className="arch-empty"><p>Дефектов нет: описание на <span className="mono">{short(p.arch.sha)}</span> проходит проверку.</p></div>}
        </div>
      )
  }
}

function DefectsTable({ defects }: { defects: ArchDefect[] }) {
  return (
    <table className="tbl arch-defects">
      <thead><tr><th>Важность</th><th>Правило</th><th>Файл</th><th>Место</th><th>Сообщение</th></tr></thead>
      <tbody>
        {defects.map((x, i) => (
          <tr key={i} data-severity={x.severity}>
            <td><span className={'arch-sev arch-sev-' + x.severity}>{x.severity === 'error' ? 'ошибка' : x.severity === 'warning' ? 'предупреждение' : x.severity}</span></td>
            <td className="mono">{x.rule}</td>
            <td className="mono">{x.file}</td>
            <td className="mono muted">{x.location || '—'}</td>
            <td>{x.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── элементы и ссылки ───────────────────────────────────────────────────

// Маршрут к элементу на C4: уровень, где он виден, и выбор элемента.
function c4RouteOf(d: ArchitectureData, id: string): Partial<ArchRoute> {
  return { tab: 'c4', ...levelRoute(elementLevel(d, id)), el: id, status: undefined }
}

function LinkChips({ d, id, go }: { d: ArchitectureData; id: string; go: Go }) {
  const n = linkCounts(d, id)
  if (!n.decisions && !n.scenarios) return null
  const chip = (label: string, count: number, href: string) => count
    ? <a className="chip" href={href}>{label}: <span className="n">{count}</span></a>
    : <span className="chip off">{label}: <span className="n">0</span></span>
  return (
    <span className="arch-links">
      {chip('решений', n.decisions, go.href({ tab: 'decisions', sub: undefined, id: undefined, el: id, status: 'all' }))}
      {chip('сценариев', n.scenarios, go.href({ tab: 'scenarios', sub: undefined, id: undefined, el: id }))}
    </span>
  )
}

function ElementRef({ d, id, go }: { d: ArchitectureData; id: string; go: Go }) {
  const inC4 = d.elements.some(e => e.id === id)
  return inC4
    ? <a className="chip arch-elref" title={id} href={go.href(c4RouteOf(d, id))}><span className="n">{elementName(d, id)}</span></a>
    : <span className="chip arch-elref off" title={`${id}: элемента нет на схемах C4`}><span className="n">{elementName(d, id)}</span></span>
}

function FilterChip({ d, el, go }: { d: ArchitectureData; el: string; go: Go }) {
  return (
    <div className="arch-filter">
      <span className="muted">элемент:</span>
      <span className="chip"><span className="n">{elementName(d, el)}</span>
        <button className="arch-x" title="Снять фильтр" onClick={() => go({ el: undefined })}>×</button>
      </span>
      {d.elements.some(e => e.id === el) && <a href={go.href(c4RouteOf(d, el))}>на C4 →</a>}
    </div>
  )
}

// ─── C4 ──────────────────────────────────────────────────────────────────

function C4Tab({ shown, route, go }: TabProps) {
  const d = shown.data
  const { lvl, fallback } = resolveLevel(d, route.sub, route.id)
  // Уровня больше нет (элемент удалён после merge): адрес меняется на
  // ближайший существующий уровень.
  useEffect(() => {
    if (fallback) go({ ...levelRoute(lvl) }, { replace: true })
  }, [fallback, lvl, go])

  const view = levelView(d, lvl)
  const els = levelElements(d, lvl)
  const sel = route.el ? d.elements.find(e => e.id === route.el) : undefined
  const trail = crumbs(d, lvl)
  const levelHref = (l: C4Level) => go.href({ ...levelRoute(l), el: undefined })
  const toLevel = (l: C4Level) => go({ ...levelRoute(l), el: undefined })
  const select = (id: string | undefined) => go({ el: id }, { replace: true })
  const byIdMap = useMemo(() => new Map(d.elements.map(e => [e.id, e])), [d])

  // Узел, который decorate связал с элементом.
  const onNode = (n: Element) => {
    const e = byIdMap.get(n.getAttribute('data-element') ?? '')
    if (!e) return
    const t = drillTarget(d, e)
    if (t) toLevel(t); else select(e.id)
  }
  // Связь узлов с элементами по сигнатуре, подсветка выбранного, пометка
  // узлов с переходом вниз, подписи для клавиатуры и экранного диктора.
  const decorate = (svg: SVGSVGElement) => {
    if (!view) return
    const nodes = [...svg.querySelectorAll('g.person-man')]
    const found = matchC4Nodes(view.mermaid, nodes.map(g => c4NodeSignature(nodeTexts(g))), d.elements)
    nodes.forEach((g, i) => {
      const e = found[i]
      const t = e ? drillTarget(d, e) : null
      g.classList.toggle('sel', !!sel && e?.id === sel.id)
      g.classList.toggle('drill', !!t)
      if (e) {
        g.setAttribute('data-element', e.id)
        g.setAttribute('aria-label', `${KIND_LABEL[e.kind] ?? e.kind} ${e.name}${t ? (t.level === 'containers' ? ', открыть контейнеры' : ', открыть компоненты') : ''}`)
      } else {
        g.removeAttribute('data-element')
        g.classList.remove('mmd-node')
        g.removeAttribute('tabindex'); g.removeAttribute('role')
      }
    })
  }

  return (
    <div className="arch-c4">
      <nav className="arch-crumbs" aria-label="Уровни C4">
        {trail.map((c, i) => i < trail.length - 1
          ? <span key={i}><a href={levelHref(c.lvl)}>{c.label}</a><span className="sep">/</span></span>
          : <b key={i} aria-current="page">{c.label}</b>)}
        {view?.title && <span className="muted arch-crumbs-title">{view.title}</span>}
      </nav>
      <div className="arch-split">
        <div className="arch-canvas">
          {view
            ? <Mermaid code={view.mermaid} label={view.title} nodeSelector="g.person-man" onNodeClick={onNode}
              decorate={decorate} decorateKey={`${sel?.id ?? ''}|${shown.sha ?? ''}|${view.mermaid.length}`} />
            : <div className="arch-empty"><p>Схемы этого уровня в снимке нет.</p></div>}
          <div className="arch-hint muted">Клик или Enter на системе и контейнере открывает уровень ниже, на остальных — карточку элемента.</div>
        </div>
        <aside className="arch-side">
          {sel && <ElementCard d={d} e={sel} go={go} onClose={() => select(undefined)} levelHref={levelHref} />}
          <h3>{lvl.level === 'context' ? 'Люди и системы' : lvl.level === 'containers' ? 'Контейнеры' : 'Компоненты'}</h3>
          {els.length === 0 && <div className="muted">На уровне нет элементов.</div>}
          {els.map(e => {
            const t = drillTarget(d, e)
            return (
              <div key={e.id} className={'arch-el' + (sel?.id === e.id ? ' on' : '')} data-element={e.id}>
                <button className="arch-el-main" aria-pressed={sel?.id === e.id}
                  onClick={() => select(sel?.id === e.id ? undefined : e.id)}>
                  <span className="arch-el-top">
                    <span className={'arch-kind k-' + e.kind}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                    {e.external && <span className="arch-ext">внешний</span>}
                  </span>
                  <b className="arch-el-name">{e.name}</b>
                  {e.technology && <span className="mono muted arch-el-tech">{e.technology}</span>}
                </button>
                <div className="arch-el-acts">
                  <LinkChips d={d} id={e.id} go={go} />
                  {t && <a className="arch-drill" href={levelHref(t)}>{t.level === 'containers' ? 'контейнеры →' : 'компоненты →'}</a>}
                </div>
              </div>
            )
          })}
        </aside>
      </div>
    </div>
  )
}

function ElementCard({ d, e, go, onClose, levelHref }: { d: ArchitectureData; e: C4Element; go: Go; onClose: () => void; levelHref: (l: C4Level) => string }) {
  const t = drillTarget(d, e)
  const parent = e.parent ? d.elements.find(x => x.id === e.parent) : undefined
  return (
    <div className="arch-card" data-element={e.id}>
      <div className="arch-el-top">
        <span className={'arch-kind k-' + e.kind}>{KIND_LABEL[e.kind] ?? e.kind}</span>
        {e.external && <span className="arch-ext">внешний</span>}
        <button className="arch-x" title="Закрыть" aria-label="Закрыть карточку" onClick={onClose}>×</button>
      </div>
      <b className="arch-el-name">{e.name}</b>
      <div className="mono muted arch-el-tech">{e.id}{e.technology ? ` · ${e.technology}` : ''}</div>
      {e.description && <p>{e.description}</p>}
      {parent && <div className="muted">в составе: <a href={go.href(c4RouteOf(d, parent.id))}>{parent.name}</a></div>}
      <div className="arch-el-acts">
        <LinkChips d={d} id={e.id} go={go} />
        {t && <a className="arch-drill" href={levelHref(t)}>{t.level === 'containers' ? 'контейнеры →' : 'компоненты →'}</a>}
      </div>
    </div>
  )
}

// ─── ERD ─────────────────────────────────────────────────────────────────

function ErdTab({ arch, shown, route, go, projectId, onStarted }: TabProps) {
  const d = shown.data
  const stores = d.erd.stores
  const store = route.sub ? stores.find(s => s.store_id === route.sub) : undefined
  useEffect(() => {
    if (route.sub && !store) go({ sub: undefined }, { replace: true })
  }, [route.sub, store, go])
  if (!d.erd.all && d.erd.entities.length === 0) {
    return <EmptyTab arch={arch} projectId={projectId} onStarted={onStarted}>
      В описании нет данных: ERD строится из объектов <span className="mono">data-object</span> с атрибутами в <span className="mono">model/data.yaml</span>.
      Хранилище — база данных C4, у которой есть доступ к объектам.
    </EmptyTab>
  }
  const view = store ? store.view : d.erd.all
  const entities = store ? d.erd.entities.filter(e => e.stores.includes(store.store_id)) : d.erd.entities
  const storeEl = store ? d.elements.find(e => e.id === store.store_id) : undefined
  return (
    <div className="arch-erd">
      <div className="arch-seg" role="group" aria-label="Хранилище">
        <button className={!store ? 'on' : ''} aria-pressed={!store} onClick={() => go({ sub: undefined, el: undefined }, { replace: true })}>Все хранилища</button>
        {stores.map(s => (
          <button key={s.store_id} className={store?.store_id === s.store_id ? 'on' : ''} aria-pressed={store?.store_id === s.store_id}
            onClick={() => go({ sub: s.store_id, el: undefined }, { replace: true })}>{s.title}</button>
        ))}
      </div>
      {store && (
        <div className="arch-store">
          <span className="muted">хранилище</span> <b>{storeEl?.name ?? store.title}</b>
          {storeEl?.technology && <span className="mono muted"> · {storeEl.technology}</span>}
          <LinkChips d={d} id={store.store_id} go={go} />
          {storeEl && <a href={go.href(c4RouteOf(d, store.store_id))}>на C4 →</a>}
        </div>
      )}
      <div className="arch-canvas">
        {view?.mermaid ? <Mermaid code={view.mermaid} label={view.title} /> : <div className="arch-empty"><p>Общей схемы данных в снимке нет.</p></div>}
      </div>
      <h3 className="arch-h3">Сущности <span className="muted">{entities.length}</span></h3>
      {entities.length === 0 && <div className="muted">В хранилище нет описанных сущностей.</div>}
      <div className="arch-entities">
        {entities.map(en => <EntityCard key={en.id} d={d} en={en} on={route.el === en.id}
          onSelect={() => go({ el: route.el === en.id ? undefined : en.id }, { replace: true })} go={go} />)}
      </div>
    </div>
  )
}

function EntityCard({ d, en, on, onSelect, go }: { d: ArchitectureData; en: ErdEntity; on: boolean; onSelect: () => void; go: Go }) {
  const nameOf = (id: string) => d.erd.entities.find(x => x.id === id)?.name ?? id
  return (
    <section className={'arch-entity' + (on ? ' on' : '')} data-entity={en.id}>
      <header>
        <button className="arch-entity-name" aria-pressed={on} onClick={onSelect}>
          <b>{en.name}</b> <span className="mono muted">{en.id}</span>
          {en.stores.length > 0 && <span className="muted"> · {en.stores.map(s => elementName(d, s)).join(', ')}</span>}
        </button>
        <LinkChips d={d} id={en.id} go={go} />
      </header>
      <table className="tbl">
        <thead><tr><th>Атрибут</th><th>Тип</th><th>Ключи</th><th>Null</th><th>Описание</th></tr></thead>
        <tbody>
          {en.attributes.map(a => (
            <tr key={a.name}>
              <td className="mono">{a.name}</td>
              <td className="mono muted">{a.type}</td>
              <td className="arch-keys">
                {a.pk && <span className="arch-key pk">PK</span>}
                {a.fk && <span className="arch-key fk" title={`${a.fk.to}.${a.fk.attribute}`}>FK → {nameOf(a.fk.to)}.{a.fk.attribute}</span>}
                {a.unique && <span className="arch-key uk">UK</span>}
              </td>
              <td className="muted">{a.nullable ? 'да' : ''}</td>
              <td>{a.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {en.relations.length > 0 && (
        <ul className="arch-rels">
          {en.relations.map((r, i) => (
            <li key={i}>→ <b>{nameOf(r.to)}</b> <span className="mono muted">{r.cardinality}</span>{r.label && <> · {r.label}</>}
              {r.derived && <span className="muted"> (из внешнего ключа)</span>}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── сценарии ────────────────────────────────────────────────────────────

function ScenariosTab({ arch, shown, route, go, projectId, onStarted }: TabProps) {
  const d = shown.data
  const list = useMemo(() => filterScenarios(d, route.el), [d, route.el])
  if (d.scenarios.length === 0) {
    return <EmptyTab arch={arch} projectId={projectId} onStarted={onStarted}>
      В описании нет сценариев: ключевые потоки вызовов описываются в <span className="mono">scenarios/&lt;id&gt;.yaml</span> и перечисляются в <span className="mono">scenarios</span> манифеста.
    </EmptyTab>
  }
  const sel = (route.sub ? d.scenarios.find(s => s.id === route.sub) : undefined) ?? list[0]
  const toParticipant = (id: string) => { if (d.elements.some(e => e.id === id)) go(c4RouteOf(d, id)) }
  // Псевдоним участника Mermaid пишет в name и data-id: у фигурки
  // человека — на группе, у прямоугольника — на самом rect.
  // Подписи участников для клавиатуры и экранного диктора: у
  // прямоугольника своего текста нет, имя берётся по псевдониму.
  const labelActors = (svg: SVGSVGElement) => {
    svg.querySelectorAll('rect.actor[name], g.actor-man[name], rect.actor[data-id], g.actor-man[data-id]').forEach(n => {
      const alias = n.getAttribute('name') || n.getAttribute('data-id')
      const p = sel?.participants.find(x => x.alias === alias)
      if (!p) return
      const inC4 = d.elements.some(e => e.id === p.id)
      n.setAttribute('aria-label', `участник ${p.name}${inC4 ? ', открыть на C4' : ''}`)
    })
  }
  const onActor = (n: Element) => {
    const named = n.closest('[name], [data-id]') ?? n.closest('g')?.querySelector('[name], [data-id]')
    const alias = named?.getAttribute('name') || named?.getAttribute('data-id')
    const p = sel?.participants.find(x => x.alias === alias)
    if (p) toParticipant(p.id)
  }
  return (
    <div className="arch-split arch-split-list">
      <aside className="arch-list">
        {route.el && <FilterChip d={d} el={route.el} go={go} />}
        {list.length === 0 && <div className="muted">Сценариев с этим элементом нет.</div>}
        {list.map(s => (
          <button key={s.id} className={'arch-li' + (sel?.id === s.id ? ' on' : '')} onClick={() => go({ sub: s.id }, { replace: true })}>
            <b>{s.title}</b>
            <span className="mono muted">{s.id}</span>
            <span className="muted">{s.process ? <>процесс {elementName(d, s.process)} · </> : null}участников: {s.participants.length}</span>
          </button>
        ))}
      </aside>
      <div className="arch-main">
        {sel && <>
          <h2 className="arch-h2">{sel.title} <span className="mono muted">{sel.id}</span></h2>
          {sel.description && <p className="arch-p">{sel.description}</p>}
          {sel.process && <p className="muted">Процесс: <b>{elementName(d, sel.process)}</b> <span className="mono">{sel.process}</span></p>}
          <div className="arch-canvas">
            <Mermaid code={sel.view.mermaid} label={sel.view.title} nodeSelector="rect.actor, text.actor, g.actor-man" focusSelector="rect.actor, g.actor-man" onNodeClick={onActor}
              decorate={labelActors} decorateKey={sel.id} />
          </div>
          <h3 className="arch-h3">Участники</h3>
          <div className="arch-parts">
            {sel.participants.map(pt => <ElementRef key={pt.id} d={d} id={pt.id} go={go} />)}
          </div>
        </>}
      </div>
    </div>
  )
}

// ─── решения ─────────────────────────────────────────────────────────────

function DecisionsTab({ arch, shown, route, go, projectId, onStarted }: TabProps) {
  const d = shown.data
  const statuses = parseStatusFilter(route.status)
  const list = filterDecisions(d.decisions, statuses, route.el)
  if (d.decisions.length === 0) {
    return <EmptyTab arch={arch} projectId={projectId} onStarted={onStarted}>
      В описании нет архитектурных решений: они лежат в <span className="mono">adr/NNNN-&lt;slug&gt;.md</span> и перечисляются в <span className="mono">decisions</span> манифеста.
    </EmptyTab>
  }
  const sel = route.sub ? d.decisions.find(x => String(x.number) === route.sub) : undefined
  const count = (s: string) => d.decisions.filter(x => x.status === s && (!route.el || x.elements.includes(route.el))).length
  const toggle = (s: string) => {
    const next = statuses.includes(s) ? statuses.filter(x => x !== s) : [...statuses, s]
    // Последний статус не снимается: пустой реестр ничего не объясняет.
    if (next.length) go({ status: statusFilterParam(next) }, { replace: true })
  }
  return (
    <div className="arch-split arch-split-list arch-adr">
      <aside className="arch-list">
        <div className="arch-adr-filter">
          {ADR_STATUSES.map(s => (
            <button key={s} className={'chip adr-f' + (statuses.includes(s) ? ' on' : '')} data-adr={s} onClick={() => toggle(s)}>
              {ADR_STATUS_LABEL[s]} <span className="n">{count(s)}</span>
            </button>
          ))}
        </div>
        {route.el && <FilterChip d={d} el={route.el} go={go} />}
        {list.length === 0 && <div className="muted">Под фильтр решений нет.</div>}
        {list.map(x => (
          <button key={x.number} className={'arch-li' + (sel?.number === x.number ? ' on' : '')} onClick={() => go({ sub: String(x.number) }, { replace: true })}>
            <span className="arch-li-top"><span className="mono">{adrLabel(x.number)}</span><AdrStatus s={x.status} /><span className="muted mono">{x.date}</span></span>
            <b>{x.title}</b>
            {x.elements.length > 0 && <span className="muted arch-li-els">{x.elements.map(id => elementName(d, id)).join(', ')}</span>}
          </button>
        ))}
      </aside>
      <div className="arch-main">
        {sel
          ? <DecisionView d={d} x={sel} go={go} fileURL={hostingFileURL(arch.source, shown.sha, sel.path)}
            resolveLink={href => docLinkURL(arch.source, shown.sha, dirOf(sel.path), href)} />
          : <div className="arch-empty"><p>Выберите решение в реестре слева.</p></div>}
      </div>
    </div>
  )
}

function AdrStatus({ s }: { s: string }) {
  return <span className={'adr-st adr-' + s}>{ADR_STATUS_LABEL[s] ?? s}</span>
}

function DecisionView({ d, x, go, fileURL, resolveLink }: { d: ArchitectureData; x: Decision; go: Go; fileURL: string; resolveLink: (href: string) => string }) {
  const ref = (n: number) => {
    const t = d.decisions.find(y => y.number === n)
    return <a key={n} href={go.href({ sub: String(n) })}>{adrLabel(n)}{t ? ` · ${t.title}` : ''}</a>
  }
  return (
    <article className="arch-decision" data-adr={x.number}>
      <div className="arch-li-top"><span className="mono">{adrLabel(x.number)}</span><AdrStatus s={x.status} /><span className="muted mono">{x.date}</span>
        {fileURL && <a className="mono arch-file" href={fileURL} target="_blank" rel="noopener noreferrer">{x.path} ↗</a>}
      </div>
      <h2 className="arch-h2">{x.title}</h2>
      {x.superseded_by != null && <div className="arch-warn">Решение заменено: {ref(x.superseded_by)}</div>}
      {x.supersedes.length > 0 && <div className="muted arch-supersedes">Заменяет: {x.supersedes.map((n, i) => <span key={n}>{i > 0 && ', '}{ref(n)}</span>)}</div>}
      {x.elements.length > 0 && (
        <div className="arch-parts"><span className="muted">Элементы:</span>{x.elements.map(id => <ElementRef key={id} d={d} id={id} go={go} />)}</div>
      )}
      <DocMarkdown className="arch-doc" text={x.body} resolveLink={resolveLink}
        renderCode={(lang, code) => lang === 'mermaid' ? <Mermaid code={code} /> : null} />
    </article>
  )
}
