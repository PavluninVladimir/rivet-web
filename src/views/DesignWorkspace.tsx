import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, type User } from '../api/client'
import {
  designApi,
  type DesignAsset,
  type DesignComponent,
  type DesignDiff,
  type DesignDocument,
  type DesignHandoff,
  type DesignModel,
  type DesignNode,
  type DesignRevision,
  type DesignThread,
  type DesignValue,
  type DocumentView,
  type PatchOp
} from '../api/design'
import {
  appendDesignPatch,
  applyDesignPatch,
  componentOf,
  componentProperty,
  initialDesign,
  previewSelection,
  renderDesignPreview,
  walkNodes
} from '../components/designModel'
import { Button, errText } from '../components/form'
import { DesignRevisionComparison } from '../components/DesignRevisionComparison'
import { useDesignAssets } from '../components/useDesignAssets'
import { useIsOwner } from '../components/useOwner'
import { useStore } from '../store'

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function DesignWorkspace({ user }: { user: User }) {
  const { projectId, tick } = useStore(),
    owner = useIsOwner(projectId, user.login)
  const [documents, setDocuments] = useState<DesignDocument[]>([]),
    [id, setId] = useState(''),
    [view, setView] = useState<DocumentView | null>(null),
    [remote, setRemote] = useState<DocumentView | null>(null)
  const [ops, setOps] = useState<PatchOp[]>([]),
    [selection, setSelection] = useState(''),
    [canvas, setCanvas] = useState(''),
    [variant, setVariant] = useState('default'),
    [scope, setScope] = useState<'instance' | 'component'>('instance')
  const [threads, setThreads] = useState<DesignThread[]>([]),
    [revisions, setRevisions] = useState<DesignRevision[]>([]),
    [diff, setDiff] = useState<DesignDiff | null>(null),
    [handoff, setHandoff] = useState<DesignHandoff | null>(null)
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState(''),
    [unsupported, setUnsupported] = useState(false),
    [newName, setNewName] = useState('Новый дизайн'),
    [comment, setComment] = useState('')
  const [imported, setImported] = useState<{
    model: DesignModel
    assets: DesignAsset[]
    valid: boolean
    diagnostics: string[]
  } | null>(null)
  const [comparedRevision, setComparedRevision] = useState<DesignRevision | null>(null)
  const [historyRevision, setHistoryRevision] = useState<number | null>(null),
    [baseId, setBaseId] = useState(''),
    [baseRevision, setBaseRevision] = useState(''),
    [handoffId, setHandoffId] = useState(''),
    [linkKind, setLinkKind] = useState('task'),
    [linkTarget, setLinkTarget] = useState('')
  const historyRef = useRef<number | null>(null)
  historyRef.current = historyRevision
  const frame = useRef<HTMLIFrameElement>(null),
    nonce = useMemo(() => crypto.randomUUID(), [id]),
    seq = useRef(0),
    dirty = useRef(false),
    patchKey = useRef(crypto.randomUUID()),
    patchBase = useRef<number | null>(null)
  dirty.current = ops.length > 0
  const refresh = useCallback(async () => {
    if (!projectId) return
    const n = ++seq.current
    try {
      const d = await designApi.documents(projectId)
      if (n !== seq.current) return
      setDocuments(d.items ?? [])
      setUnsupported(false)
      if (!id) {
        if (d.items?.length) setId(d.items[0].id)
        return
      }
      const [v, t, r] = await Promise.all([
        designApi.get(projectId, id),
        designApi.threads(projectId, id),
        designApi.revisions(projectId, id)
      ])
      if (n !== seq.current) return
      setThreads(t.items ?? [])
      setRevisions(r.items ?? [])
      setView(prev => {
        if (historyRef.current !== null) return prev
        if (!prev || prev.document.id !== id || !dirty.current) {
          setRemote(null)
          return v
        }
        if (v.document.revision !== prev.document.revision) setRemote(v)
        return prev
      })
    } catch (e) {
      if (n === seq.current) {
        if (e instanceof ApiError && e.status === 404 && !id) setUnsupported(true)
        else setErr(errText(e))
      }
    }
  }, [projectId, id])
  useEffect(() => {
    void refresh()
    return () => {
      seq.current++
    }
  }, [refresh, tick])
  // Keep each unsaved patch outside component state too. A changed revision is
  // shown explicitly; restoring never sends or rebases it automatically.
  const draftKey = projectId && id ? `rivet:design:${user.id}:${projectId}:${id}` : null
  const restored = useRef('')
  useEffect(() => {
    if (!draftKey || !view || restored.current === draftKey) return
    restored.current = draftKey
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(draftKey)
    } catch {
      setNotice('Хранилище вкладки недоступно. Экспортируйте локальный patch перед уходом.')
    }
    if (raw) {
      try {
        const d = JSON.parse(raw) as { revision: number; operations: PatchOp[] }
        if (d.operations.length) {
          patchBase.current = d.revision
          dirty.current = true
          setOps(d.operations)
          setNotice(`Восстановлен локальный patch версии ${d.revision}. Проверьте его перед сохранением.`)
          if (d.revision !== view.document.revision) {
            const current = view
            setRemote(current)
            void designApi
              .get(projectId!, id, d.revision)
              .then(base => {
                setView(base)
                setRemote(current)
              })
              .catch(e => setErr(errText(e)))
          }
        }
      } catch {
        setNotice('Сохранённый локальный patch повреждён, экспортируйте его перед удалением.')
      }
    }
  }, [draftKey, view])
  useEffect(() => {
    if (draftKey && view && restored.current === draftKey) {
      try {
        if (ops.length)
          sessionStorage.setItem(
            draftKey,
            JSON.stringify({ revision: patchBase.current ?? view.document.revision, operations: ops })
          )
        else sessionStorage.removeItem(draftKey)
      } catch {
        setNotice(
          'Не удалось сохранить patch в хранилище вкладки. Правки остаются на экране, экспортируйте их перед уходом.'
        )
      }
    }
  }, [draftKey, view, ops])
  const model = useMemo(() => {
    if (!view) return null
    try {
      return applyDesignPatch(view.model, ops)
    } catch {
      return view.model
    }
  }, [view, ops])
  const { assets, error: assetError } = useDesignAssets(
    projectId,
    model,
    selection,
    view?.document.revision ?? null
  )
  const nodes = model ? walkNodes(model) : [],
    selected = nodes.find(n => n.id === selection)
  const roots = model
    ? [
        ...model.screens.map(s => ({ id: s.id, name: s.name, root: s.root })),
        ...model.components.map(c => ({ id: c.id, name: `Компонент · ${c.name}`, root: c.root }))
      ]
    : []
  const active = roots.find(s => s.id === canvas) ?? roots[0]
  const append = (op: PatchOp) => {
    if (historyRevision !== null) return
    if (!ops.length) patchBase.current = view?.document.revision ?? null
    setOps(prev => appendDesignPatch(prev, op))
    setDiff(null)
    patchKey.current = crypto.randomUUID()
    setErr('')
  }
  const changeProperty = (property: string, value: DesignValue) => {
    if (!selected || !model) return
    try {
      append(
        scope === 'component'
          ? componentProperty(model, selected.id, property, value)
          : { op: 'set_property', element_id: selected.id, property, value, scope: 'instance' }
      )
    } catch (e) {
      setErr(errText(e))
    }
  }
  const action = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(errText(e))
      if (e instanceof ApiError && e.status === 409) await refresh()
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!view || !projectId || !ops.length) return
    if (!diff) {
      setDiff(await designApi.diff(projectId, id, patchBase.current ?? view.document.revision, ops))
      setNotice('Проверьте затронутые элементы и сохраните patch.')
      return
    }
    if (diff.conflicts?.length || remote) return
    await designApi.patch(projectId, id, patchBase.current ?? view.document.revision, ops, patchKey.current)
    setOps([])
    dirty.current = false
    setDiff(null)
    setNotice('Изменения сохранены')
    await refresh()
  }
  const displayedModel = historyRevision === null ? model : view?.model
  const source =
    displayedModel && active && view
      ? renderDesignPreview(
          displayedModel,
          active.root,
          id,
          view.document.revision,
          nonce,
          selection,
          variant,
          Object.fromEntries(assets.filter(a => a.url).map(a => [a.id, a.url!]))
        )
      : ''
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || !model || !view) return
      const pick = previewSelection(event.data, nonce, id, view.document.revision, model)
      if (pick) setSelection(pick)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [nonce, id, model, view])
  const openDocument = (next: string) => {
    if (next === id) return
    if (ops.length && !window.confirm('Локальный patch сохранён в этой вкладке. Открыть другой документ?'))
      return
    setOps([])
    patchBase.current = null
    setView(null)
    setRemote(null)
    setDiff(null)
    setId(next)
    setHistoryRevision(null)
    setSelection('')
    setCanvas('')
    setImported(null)
    setHandoff(null)
    setComparedRevision(null)
  }
  const viewRevision = async (revision: number) => {
    if (ops.length) {
      setErr('Сначала сохраните или экспортируйте локальный patch.')
      return
    }
    const v = await designApi.get(projectId!, id, revision)
    setView(v)
    setHistoryRevision(revision)
    setComparedRevision(revisions.find(item => item.revision === revision) ?? null)
    setSelection('')
  }
  if (unsupported)
    return (
      <div className="page">
        <h1>Дизайн-система</h1>
        <p>Редактор недоступен на этой версии сервера.</p>
      </div>
    )
  return (
    <div className="page workspace design-workspace">
      <div className="page-head">
        <h1>Дизайн-система</h1>
        <span className="sub">Токены, компоненты, экраны и обсуждения</span>
      </div>
      {assetError && (
        <p role="alert" className="workspace-error">
          {assetError}
        </p>
      )}
      {err && (
        <p role="alert" className="workspace-error">
          {err}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="workspace-toolbar">
        <label>
          Документ
          <select value={id} onChange={e => openDocument(e.target.value)}>
            <option value="">Выберите документ</option>
            {documents.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} · v{d.revision}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Название нового документа"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          maxLength={120}
        />
        <Button
          busy={busy}
          disabled={!newName.trim()}
          onClick={() =>
            void action(async () => {
              const d = await designApi.create(projectId!, newName, initialDesign())
              openDocument(d.id)
              await refresh()
            })
          }
        >
          Создать документ
        </Button>
      </div>
      {view && model && (
        <>
          <div className="workspace-toolbar">
            <span>
              v{view.document.revision} · <code>{view.document.content_sha.slice(0, 12)}</code>
            </span>
            <span>
              {ops.length ? `Предпросмотр, ${ops.length} несохранённых операций` : 'Сохранённая версия'}
            </span>
            <Button
              busy={busy}
              disabled={!ops.length || !!remote || historyRevision !== null}
              onClick={() => void action(save)}
            >
              {diff ? 'Сохранить patch' : 'Проверить изменения'}
            </Button>
            <Button
              disabled={!ops.length}
              onClick={() =>
                download(
                  {
                    document_id: id,
                    expected_revision: patchBase.current ?? view.document.revision,
                    operations: ops
                  },
                  `design-${id}-patch.json`
                )
              }
            >
              Экспорт patch
            </Button>
            {ops.length > 0 && (
              <Button
                onClick={() => {
                  if (window.confirm('Удалить локальные правки?')) {
                    setOps([])
                    setDiff(null)
                    setRemote(null)
                    void refresh()
                  }
                }}
              >
                Отменить правки
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  download(
                    await designApi.export(projectId!, id, view.document.revision),
                    `design-${id}-v${view.document.revision}.json`
                  )
                )
              }
            >
              Экспорт версии
            </Button>
          </div>
          {historyRevision !== null && (
            <p role="status">
              Просмотр истории v{historyRevision}. Редактирование отключено.{' '}
              <Button
                onClick={() => {
                  setHistoryRevision(null)
                  void refresh()
                }}
              >
                К текущей версии
              </Button>
            </p>
          )}
          {remote && (
            <section className="workspace-card" role="alert">
              <h2>На сервере уже v{remote.document.revision}</h2>
              <p>
                Ваш patch остаётся на базе v{patchBase.current ?? view.document.revision}. Автоматической
                перезаписи нет. Экспортируйте patch, затем сравните с новой версией.
              </p>
              <details>
                <summary>Состояние на сервере</summary>
                <pre>{JSON.stringify(remote.model, null, 2)}</pre>
              </details>
              <Button
                onClick={() => {
                  if (window.confirm('Локальный patch будет сброшен. Он экспортирован?')) {
                    setView(remote)
                    setOps([])
                    setRemote(null)
                    setDiff(null)
                  }
                }}
              >
                Принять версию сервера
              </Button>
            </section>
          )}
          {diff && (
            <section className="workspace-card">
              <h2>Влияние изменений</h2>
              <p>Затронуто элементов: {diff.affected_element_ids.length}</p>
              <ul>
                {diff.affected_element_ids.map(x => (
                  <li key={x}>
                    <button className="btn sm" onClick={() => setSelection(x)}>
                      {String(nodes.find(n => n.id === x)?.props.text ?? x)}
                    </button>
                  </li>
                ))}
              </ul>
              {diff.conflicts.map((c, i) => (
                <p key={i} role="alert">
                  {c.path}: {c.message}
                </p>
              ))}
              <details>
                <summary>Typed patch</summary>
                <pre>{JSON.stringify(ops, null, 2)}</pre>
              </details>
            </section>
          )}
          <div className="design-grid">
            <aside className="workspace-card design-tree">
              <h2>Экраны и компоненты</h2>
              {roots.map(r => (
                <div key={r.id}>
                  <button
                    className="btn sm"
                    aria-pressed={active?.id === r.id}
                    onClick={() => {
                      setCanvas(r.id)
                      setSelection(r.root.id)
                      setScope(model.components.some(c => c.id === r.id) ? 'component' : 'instance')
                    }}
                  >
                    {r.name}
                  </button>
                  {active?.id === r.id && (
                    <NodeTree node={r.root} selection={selection} onSelect={setSelection} />
                  )}
                </div>
              ))}
              <label>
                Состояние компонента
                <select value={variant} onChange={e => setVariant(e.target.value)}>
                  {['default', 'hover', 'focus', 'disabled', 'error'].map(s => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </aside>
            <section className="workspace-card design-canvas">
              <h2>{active?.name ?? 'Предпросмотр'}</h2>
              <iframe
                ref={frame}
                title="Изолированный предпросмотр дизайна"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={source}
              />
              <p className="muted">
                Нажмите элемент в preview или выберите его в дереве. Отображается только поддержанная
                структура, импортируемый код не исполняется.
              </p>
            </section>
            <aside className="workspace-card design-inspector">
              <h2>Свойства</h2>
              {selected ? (
                <>
                  <code>{selected.id}</code>
                  <p>{selected.type}</p>
                  <label>
                    Область правки
                    <select value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
                      <option value="instance">Выбранный элемент / instance override</option>
                      {componentOf(model, selected.id) && <option value="component">Общий компонент</option>}
                    </select>
                  </label>
                  {scope === 'component' && (
                    <p>
                      Правка общего компонента затронет его экземпляры. Перед сохранением проверьте влияние и
                      overrides.
                    </p>
                  )}
                  <fieldset disabled={busy || historyRevision !== null}>
                    <legend>Поддержанные свойства</legend>
                    {['text', 'placeholder'].map(p => (
                      <label key={p}>
                        {p === 'text' ? 'Текст' : 'Подсказка'}
                        <input
                          value={String(selected.props[p] ?? '')}
                          maxLength={8000}
                          onChange={e => changeProperty(p, e.target.value)}
                        />
                      </label>
                    ))}
                    {['padding', 'gap', 'width', 'height', 'border', 'radius'].map(p => (
                      <label key={p}>
                        {p}
                        <input
                          type="number"
                          min={0}
                          max={p === 'width' || p === 'height' ? 4096 : 1024}
                          value={typeof selected.props[p] === 'number' ? (selected.props[p] as number) : ''}
                          onChange={e => changeProperty(p, Number(e.target.value))}
                        />
                        {(p === 'padding' || p === 'gap') && (
                          <select
                            aria-label={`${p}: токен`}
                            value={
                              typeof selected.props[p] === 'object'
                                ? ((selected.props[p] as { token_id: string })?.token_id ?? '')
                                : ''
                            }
                            onChange={e => {
                              if (e.target.value) changeProperty(p, { token_id: e.target.value })
                            }}
                          >
                            <option value="">Локальное значение</option>
                            {model.tokens
                              .filter(t => t.type === 'spacing')
                              .map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </label>
                    ))}
                    {['color', 'background', 'border_color'].map(p => (
                      <label key={p}>
                        {p}
                        <input
                          type="color"
                          value={
                            typeof selected.props[p] === 'string' ? (selected.props[p] as string) : '#ffffff'
                          }
                          onChange={e => changeProperty(p, e.target.value)}
                        />
                        <select
                          aria-label={`${p}: токен`}
                          value={
                            typeof selected.props[p] === 'object'
                              ? ((selected.props[p] as { token_id: string })?.token_id ?? '')
                              : ''
                          }
                          onChange={e => {
                            if (e.target.value) changeProperty(p, { token_id: e.target.value })
                          }}
                        >
                          <option value="">Локальный цвет</option>
                          {model.tokens
                            .filter(t => t.type === 'color')
                            .map(t => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                    <label>
                      Типографика
                      <select
                        value={
                          typeof selected.props.typography === 'object'
                            ? ((selected.props.typography as { token_id: string })?.token_id ?? '')
                            : ''
                        }
                        onChange={e => {
                          if (e.target.value) changeProperty('typography', { token_id: e.target.value })
                        }}
                      >
                        <option value="">По умолчанию</option>
                        {model.tokens
                          .filter(t => t.type === 'typography')
                          .map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Выравнивание
                      <select
                        value={String(selected.props.alignment ?? 'start')}
                        onChange={e => changeProperty('alignment', e.target.value)}
                      >
                        {['start', 'center', 'end', 'stretch'].map(v => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Расположение
                      <select
                        value={String(selected.props.direction ?? 'column')}
                        onChange={e => changeProperty('direction', e.target.value)}
                      >
                        <option>column</option>
                        <option>row</option>
                      </select>
                    </label>
                    <label>
                      Добавить дочерний элемент
                      <select
                        defaultValue=""
                        onChange={e => {
                          if (!e.target.value) return
                          append({
                            op: 'add_node',
                            parent_id: selected.id,
                            index: selected.children.length,
                            node: {
                              id: crypto.randomUUID(),
                              type: e.target.value as DesignNode['type'],
                              props: { text: 'Новый элемент' },
                              children: []
                            }
                          })
                          e.target.value = ''
                        }}
                      >
                        <option value="">Выберите тип</option>
                        {['container', 'text', 'button', 'input', 'image'].map(v => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <Button
                      onClick={() => append({ op: 'remove_node', element_id: selected.id })}
                      disabled={roots.some(r => r.root.id === selected.id)}
                    >
                      Удалить элемент
                    </Button>
                    <label>
                      Изображение
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          void action(async () => {
                            const a = await designApi.asset(projectId!, f)
                            changeProperty('asset_id', a.id)
                          })
                        }}
                      />
                    </label>
                  </fieldset>
                </>
              ) : (
                <p>Выберите элемент</p>
              )}
            </aside>
          </div>
          <section className="workspace-card">
            <h2>Токены · общие значения</h2>
            <p>Изменение токена применяется ко всем ссылкам. Локальные overrides сохраняются.</p>
            <div className="design-tokens">
              {model.tokens.map(t => (
                <fieldset key={t.id} disabled={busy || historyRevision !== null}>
                  <legend>
                    {t.name} · {t.type}
                  </legend>
                  {Object.entries(t.value).map(([key, value]) => (
                    <label key={key}>
                      {key}
                      <input
                        type={key === 'hex' ? 'color' : typeof value === 'number' ? 'number' : 'text'}
                        value={value}
                        onChange={e =>
                          append({
                            op: 'set_token',
                            token_id: t.id,
                            value: {
                              ...t.value,
                              [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value
                            }
                          })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </section>
          <section className="workspace-card">
            <h2>Состояния компонентов</h2>
            {model.components.map(c => (
              <ComponentStates
                key={c.id}
                component={c}
                disabled={busy || historyRevision !== null}
                onChange={component => append({ op: 'update_component', component_id: c.id, component })}
              />
            ))}
          </section>
          <section className="workspace-card">
            <h2>Закреплённая базовая версия</h2>
            <p>
              {model.base
                ? `${model.base.document_id} · v${model.base.revision} · ${model.base.content_sha}`
                : 'Без базового документа'}
            </p>
            {owner && (
              <div className="workspace-toolbar">
                <label>
                  Документ
                  <select value={baseId} onChange={e => setBaseId(e.target.value)}>
                    <option value="">Выберите</option>
                    {documents
                      .filter(d => d.id !== id)
                      .map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Версия
                  <input
                    type="number"
                    min={1}
                    value={baseRevision}
                    onChange={e => setBaseRevision(e.target.value)}
                  />
                </label>
                <Button
                  disabled={!baseId || !baseRevision || historyRevision !== null}
                  onClick={() =>
                    void action(async () => {
                      const b = await designApi.get(projectId!, baseId, Number(baseRevision))
                      append({
                        op: 'update_base',
                        base: {
                          document_id: b.document.id,
                          revision: b.document.revision,
                          content_sha: b.document.content_sha
                        }
                      })
                    })
                  }
                >
                  Предложить обновление базы
                </Button>
              </div>
            )}
          </section>
          <section className="workspace-card">
            <h2>Обсуждение</h2>
            <p>
              Anchor: {selection || 'выберите элемент'} · v{view.document.revision}
            </p>
            <label>
              Комментарий
              <textarea value={comment} maxLength={8000} onChange={e => setComment(e.target.value)} />
            </label>
            <Button
              disabled={!selection || !comment.trim() || busy || ops.length > 0 || historyRevision !== null}
              onClick={() =>
                void action(async () => {
                  await designApi.thread(
                    projectId!,
                    id,
                    { document_id: id, revision: view.document.revision, element_id: selection },
                    comment
                  )
                  setComment('')
                  await refresh()
                })
              }
            >
              Добавить к элементу
            </Button>
            {threads.map(t => (
              <ThreadView
                key={t.id}
                thread={t}
                projectId={projectId!}
                owner={owner}
                actor={user.id}
                onSelect={() => {
                  if (t.anchor.revision !== view.document.revision)
                    void action(async () => {
                      await viewRevision(t.anchor.revision)
                      setSelection(t.anchor.element_id)
                    })
                  else setSelection(t.anchor.element_id)
                }}
                onChanged={refresh}
              />
            ))}
          </section>
          <section className="workspace-card">
            <h2>История и undo</h2>
            {revisions.map(r => (
              <div key={r.revision} className="workspace-toolbar">
                <span>
                  v{r.revision} · {r.created_at} · {r.actor_id}
                </span>
                <code>{r.content_sha.slice(0, 12)}</code>
                <Button size="sm" onClick={() => void action(() => viewRevision(r.revision))}>
                  Просмотр
                </Button>
                <Button
                  size="sm"
                  disabled={busy || ops.length > 0 || historyRevision !== null || r.parent_revision === null}
                  onClick={() =>
                    void action(async () => {
                      await designApi.undo(projectId!, id, view.document.revision, r.revision)
                      await refresh()
                    })
                  }
                >
                  Отменить эту revision
                </Button>
                <Button
                  size="sm"
                  aria-label={`Сравнить содержимое версии ${r.revision}`}
                  onClick={() => setComparedRevision(r)}
                >
                  Сравнить содержимое
                </Button>
                <details>
                  <summary>Операции revision</summary>
                  {r.diff.operations.length === 0 ? (
                    <p>
                      Список операций отсутствует. Изменения undo/импорта доступны через «Сравнить
                      содержимое».
                    </p>
                  ) : (
                    <pre>{JSON.stringify(r.diff, null, 2)}</pre>
                  )}
                </details>
              </div>
            ))}
            {comparedRevision && (
              <DesignRevisionComparison
                key={`${id}:${comparedRevision.revision}`}
                projectId={projectId!}
                documentId={id}
                revision={comparedRevision.revision}
                parentRevision={comparedRevision.parent_revision}
                currentRevision={
                  documents.find(document => document.id === id)?.revision ?? view.document.revision
                }
              />
            )}
          </section>
          <section className="workspace-card">
            <h2>Импорт rivet.design/v1</h2>
            <p>
              Только поддержанная JSON-модель с manifest. React, HTML и неизвестные свойства отклоняются без
              изменения документа.
            </p>
            <input
              aria-label="Импорт JSON дизайна"
              type="file"
              accept="application/json,.json"
              disabled={busy || ops.length > 0 || historyRevision !== null}
              onChange={e => {
                const f = e.target.files?.[0]
                if (!f) return
                void action(async () => {
                  if (f.size > 2 * 1024 * 1024) throw Error('Модель больше 2 MiB')
                  const raw = JSON.parse(await f.text())
                  const m = raw.model ?? raw,
                    as = raw.assets ?? []
                  const result = await designApi.validateImport(projectId!, id, m, as)
                  setImported({
                    model: m,
                    assets: as,
                    valid: result.valid,
                    diagnostics: result.diagnostics.map(d => `${d.path}: ${d.message}`)
                  })
                })
              }}
            />
            {imported && (
              <>
                <ul>
                  {imported.diagnostics.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
                <Button
                  disabled={!imported.valid || busy || ops.length > 0}
                  onClick={() =>
                    void action(async () => {
                      await designApi.import(
                        projectId!,
                        id,
                        view.document.revision,
                        imported.model,
                        imported.assets
                      )
                      setImported(null)
                      await refresh()
                    })
                  }
                >
                  Применить проверенный импорт
                </Button>
              </>
            )}
          </section>
          <section className="workspace-card">
            <h2>Передача в разработку</h2>
            <p>
              Снимок содержит сохранённую версию, комментарии и asset refs. SHA содержимого не является Git
              commit.
            </p>
            <div className="workspace-toolbar">
              <label>
                Открыть ранее созданный handoff
                <input
                  value={handoffId}
                  onChange={e => setHandoffId(e.target.value)}
                  placeholder="UUID handoff"
                />
              </label>
              <Button
                disabled={!handoffId || busy}
                onClick={() =>
                  void action(async () => setHandoff(await designApi.getHandoff(projectId!, handoffId)))
                }
              >
                Открыть handoff
              </Button>
            </div>
            <Button
              disabled={busy || ops.length > 0}
              onClick={() =>
                void action(async () =>
                  setHandoff(
                    await designApi.handoff(
                      projectId!,
                      id,
                      view.document.revision,
                      threads.map(t => t.id),
                      []
                    )
                  )
                )
              }
            >
              Создать handoff v{view.document.revision}
            </Button>
            {handoff && (
              <>
                <p>
                  Handoff: <code>{handoff.id}</code>
                </p>
                <p>
                  Снимок: <code>{handoff.screenshot_asset_id}</code>
                </p>
                <p>
                  Model SHA: <code>{handoff.model_sha}</code>
                </p>
                <p>
                  Manifest SHA: <code>{handoff.manifest_sha}</code>
                </p>
                <p>Git commit: {handoff.git_commit_sha ?? 'не создан'}</p>
                <Button onClick={() => download(handoff, `handoff-${handoff.id}.json`)}>
                  Скачать handoff
                </Button>
                {owner && (
                  <div className="workspace-toolbar">
                    <label>
                      Связь
                      <select value={linkKind} onChange={e => setLinkKind(e.target.value)}>
                        {['task', 'research', 'architecture', 'git_commit'].map(k => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <input
                      aria-label="ID связанного артефакта"
                      value={linkTarget}
                      onChange={e => setLinkTarget(e.target.value)}
                    />
                    <Button
                      disabled={!linkTarget || busy}
                      onClick={() =>
                        void action(async () =>
                          setHandoff(await designApi.link(projectId!, handoff.id, linkKind, linkTarget))
                        )
                      }
                    >
                      Добавить проверяемую связь
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
function NodeTree({
  node,
  selection,
  onSelect
}: {
  node: DesignNode
  selection: string
  onSelect: (id: string) => void
}) {
  return (
    <ul>
      <li>
        <button className="btn sm" aria-pressed={selection === node.id} onClick={() => onSelect(node.id)}>
          {String(node.props.text ?? node.type).slice(0, 48)}
        </button>
        {node.children.map(c => (
          <NodeTree key={c.id} node={c} selection={selection} onSelect={onSelect} />
        ))}
      </li>
    </ul>
  )
}
function ComponentStates({
  component,
  disabled,
  onChange
}: {
  component: DesignComponent
  disabled: boolean
  onChange: (c: DesignComponent) => void
}) {
  const [state, setState] = useState<DesignComponent['variants'][number]['state']>('default'),
    v = component.variants.find(v => v.state === state)
  const update = (props: DesignComponent['root']['props']) =>
    onChange({
      ...component,
      variants: [...component.variants.filter(v => v.state !== state), { state, props }]
    })
  return (
    <fieldset disabled={disabled}>
      <legend>{component.name}</legend>
      <label>
        Состояние
        <select value={state} onChange={e => setState(e.target.value as typeof state)}>
          {['default', 'hover', 'focus', 'disabled', 'error'].map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Текст в состоянии
        <input
          value={String(v?.props.text ?? '')}
          onChange={e => update({ ...v?.props, text: e.target.value })}
        />
      </label>
      <label>
        Фон
        <input
          type="color"
          value={typeof v?.props.background === 'string' ? v.props.background : '#3498db'}
          onChange={e => update({ ...v?.props, background: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={v?.props.disabled === true}
          onChange={e => update({ ...v?.props, disabled: e.target.checked })}
        />{' '}
        Отключён
      </label>
    </fieldset>
  )
}
function ThreadView({
  thread: t,
  projectId,
  owner,
  actor,
  onSelect,
  onChanged
}: {
  thread: DesignThread
  projectId: string
  owner: boolean
  actor: string
  onSelect: () => void
  onChanged: () => Promise<void>
}) {
  const [reply, setReply] = useState(''),
    [editing, setEditing] = useState(''),
    [edit, setEdit] = useState(''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      setReply('')
      setEditing('')
      await onChanged()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="design-thread">
      <div className="workspace-toolbar">
        <button className="btn sm" onClick={onSelect}>
          Элемент {t.anchor.element_id.slice(0, 8)} · v{t.anchor.revision}
        </button>
        <span>
          {t.status === 'open' ? 'Открыт' : 'Разрешён'}
          {t.orphaned ? ' · элемент удалён, anchor сохранён' : ''}
        </span>
        {(owner || actor === t.created_by) && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => designApi.threadStatus(projectId, t, t.status === 'open' ? 'resolved' : 'open'))
            }
          >
            {t.status === 'open' ? 'Разрешить' : 'Открыть снова'}
          </Button>
        )}
      </div>
      {t.messages.map(c => (
        <div key={c.id}>
          <small>
            {c.author_id} · {c.created_at}
            {c.edited_at ? ' · изменён' : ''}
          </small>
          {editing === c.id ? (
            <label>
              Редактирование комментария
              <textarea value={edit} maxLength={8000} onChange={e => setEdit(e.target.value)} />
              <Button
                disabled={!edit.trim() || busy}
                onClick={() => void act(() => designApi.editComment(projectId, c, edit))}
              >
                Сохранить
              </Button>
              <Button onClick={() => setEditing('')}>Отмена</Button>
            </label>
          ) : (
            <p>{c.deleted ? 'Комментарий удалён' : c.text}</p>
          )}
          {!c.deleted && actor === c.author_id && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(c.id)
                setEdit(c.text)
              }}
            >
              Изменить
            </Button>
          )}
          {!c.deleted && (owner || actor === c.author_id) && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void act(() => designApi.deleteComment(projectId, c))}
            >
              Удалить комментарий
            </Button>
          )}
        </div>
      ))}
      <label>
        Ответ
        <textarea value={reply} maxLength={8000} onChange={e => setReply(e.target.value)} />
      </label>
      <Button
        disabled={!reply.trim() || busy}
        onClick={() => void act(() => designApi.reply(projectId, t.id, reply))}
      >
        Ответить
      </Button>
      {err && <p role="alert">{err}</p>}
    </article>
  )
}
