import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { InstallationProcessSection } from './ProcessSection'
import { processHandlers } from './installationProcess'
import { api, apiField, defaultProcess, type ModelChoice, type Overrides, type PolicyEngine, type PolicyVersion, type Presets, type ProjectPolicy, type RoleModelRef } from '../api/client'
import { choiceLabel, tripleKey, tripleOf } from './roleLabels'
import { useStore } from '../store'
import { fmtDate, fmtTokens } from './ui'
import { Button, Checkbox, FormNote, NumberInput, Select, Switch, TagsInput, errText } from './form'

// Политики конвейера пресетами (спека web «Политики в консоли», change
// add-policy-presets). Строки set-row с переключателями и числовыми полями
// по прототиповскому Settings (orchestrator policy); сверх прототипа —
// пути, требующие человека, разрешение автопубликации, хэш версии и
// история (их требует спека аудита). «Escalate blocked tasks» и «Notify»
// из прототипа не делаются (design, сверка с прототипом).

type PresetKey = 'auto_merge' | 'human_review_paths' | 'attempt_limit' | 'review_limit' | 'daily_token_budget' | 'auto_publish'
  | 'tester_agent' | 'test_paths'

// Значения по умолчанию новых пресетов (api-contract add-agent-roles):
// старый бэкенд их не отдаёт, форма показывает действующие по умолчанию.
export const DEFAULT_TEST_PATHS = ['test/**', 'tests/**', '**/*_test.*', '**/*.test.*', '**/*.spec.*']
const PRESET_DEFAULTS: Partial<Record<PresetKey, Presets[PresetKey]>> = { tester_agent: true, test_paths: DEFAULT_TEST_PATHS }
function presetValue(p: Presets, k: PresetKey): Presets[PresetKey] {
  return p[k] ?? PRESET_DEFAULTS[k] ?? p[k]
}

const ROWS: { key: PresetKey; label: string; hint: string }[] = [
  { key: 'auto_merge', label: 'Авто-merge после review', hint: 'мержить PR, когда review и проверки пройдены' },
  { key: 'human_review_paths', label: 'Пути, требующие человека', hint: 'PR с такими файлами ждёт подтверждения: infra/**, **/*.sql, deploy/prod/*' },
  { key: 'attempt_limit', label: 'Лимит попыток', hint: 'задача проваливается после N неуспешных циклов' },
  { key: 'review_limit', label: 'Лимит отказов review', hint: 'эскалация человеку после N отказов review' },
  { key: 'daily_token_budget', label: 'Дневной бюджет токенов', hint: 'пауза планирования при превышении, пусто — без ограничения' },
  { key: 'auto_publish', label: 'Автопубликация после merge', hint: 'разрешить окружениям с автозапуском публиковаться' },
  { key: 'tester_agent', label: 'Тестировщик на шаге test', hint: 'агент-тестировщик дописывает тесты по критериям; выкл: только проверки проекта. Действует на процесс по умолчанию, в своём процессе тестировщик задаётся участником шага test' },
  { key: 'test_paths', label: 'Шаблоны тестовых файлов', hint: 'тестировщик меняет только такие файлы, правки вне них откатываются' },
]

export function shortHash(h: string | undefined | null): string {
  return h ? h.slice(0, 12) : '—'
}

export { Switch }

function PathsInput({ value, disabled, onChange, placeholder = 'infra/**, **/*.sql' }: { value: string[]; disabled?: boolean; onChange: (v: string[]) => void; placeholder?: string }) {
  return <div style={{ minWidth: 260 }}><TagsInput value={value} disabled={disabled} onChange={onChange} placeholder={placeholder} /></div>
}

function NumInput({ value, disabled, width = 72, min = 1, onChange, placeholder }: {
  value: number | null; disabled?: boolean; width?: number; min?: number; placeholder?: string
  onChange: (v: number | null) => void
}) {
  return (
    <NumberInput min={min} width={width} disabled={disabled} placeholder={placeholder}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  )
}

// Контрол одного пресета: значение и обработчик без привязки к уровню.
function PresetControl({ k, value, disabled, onChange }: {
  k: PresetKey; value: Presets[PresetKey]; disabled?: boolean
  onChange: (v: Presets[PresetKey]) => void
}) {
  switch (k) {
    case 'auto_merge':
    case 'auto_publish':
    case 'tester_agent':
      return <Switch on={Boolean(value)} disabled={disabled} onChange={onChange} />
    case 'human_review_paths':
      return <PathsInput value={(value as string[]) ?? []} disabled={disabled} onChange={onChange} />
    case 'test_paths':
      return <PathsInput value={(value as string[]) ?? []} disabled={disabled} onChange={onChange} placeholder="test/**, **/*.test.*" />
    case 'daily_token_budget':
      return <NumInput value={value as number | null} disabled={disabled} width={120} min={0}
        placeholder="без лимита" onChange={onChange} />
    default:
      return <NumInput value={value as number} disabled={disabled} onChange={v => onChange(Math.max(1, v ?? 1))} />
  }
}

function fmtValue(k: PresetKey, v: Presets[PresetKey]): string {
  if (k === 'auto_merge' || k === 'auto_publish' || k === 'tester_agent') return v ? 'вкл' : 'выкл'
  // Пустые шаблоны тестов на сервере значат «по умолчанию», а не «нет».
  if (k === 'test_paths') return (v as string[] | undefined)?.length ? (v as string[]).join(', ') : `по умолчанию (${DEFAULT_TEST_PATHS.join(', ')})`
  if (k === 'human_review_paths') return (v as string[] | undefined)?.length ? (v as string[]).join(', ') : 'нет'
  if (k === 'daily_token_budget') return v == null ? 'без лимита' : fmtTokens(v as number)
  return String(v)
}

function VersionHistory({ versions }: { versions: PolicyVersion[] }) {
  const [open, setOpen] = useState(false)
  if (!versions.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <Button size="sm" variant="quiet" onClick={() => setOpen(o => !o)}>
        {open ? 'Скрыть историю' : `История версий (${versions.length})`}
      </Button>
      {open && (
        <div className="sess-list" style={{ marginTop: 6 }}>
          {versions.map(v => (
            <div className="sess-row" key={v.id} title={JSON.stringify(v.content)}>
              <span className="mono">v{v.version}</span>
              <span className="mono muted">{shortHash(v.hash)}</span>
              <span className="sess-agent">{v.created_by}</span>
              <span className="muted">{fmtDate(v.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Баннер ошибок и заметок. Ошибка API с полем (test_paths,
// role_models.<роль>.model) показывается у поля, а не только баннером.
function useBanner() {
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [errField, setErrField] = useState<string | undefined>(undefined)
  const banner: ReactNode = (err || note) ? <div style={{ marginBottom: 8 }}><FormNote err={err || undefined} ok={note || undefined} /></div> : null
  const fail = (e: unknown) => { setErr(errText(e)); setErrField(apiField(e)) }
  const clear = () => { setErr(''); setNote(''); setErrField(undefined) }
  const fieldErr = (name: string) => errField && (errField === name || errField.startsWith(name + '.') || errField.startsWith(name + '[')) ? err : undefined
  return { banner, setErr, setNote, fail, clear, fieldErr }
}

// ─── пресеты установки (вкладка «Политики» раздела управления) ──────────

export function InstallationPolicyPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const [presets, setPresets] = useState<Presets | null>(null)
  const [engine, setEngine] = useState<PolicyEngine | null>(null)
  const [version, setVersion] = useState<PolicyVersion | null>(null)
  const [versions, setVersions] = useState<PolicyVersion[]>([])
  const [dirty, setDirty] = useState(false)
  const { banner, setErr, setNote, fail, clear, fieldErr } = useBanner()

  const refresh = useCallback(() => {
    api.systemPolicy()
      .then(p => { setPresets(p.presets); setVersion(p.version); setEngine(p.engine ?? null); setDirty(false) })
      .catch(e => setErr(errText(e)))
    api.systemPolicyVersions().then(v => setVersions(v ?? [])).catch(() => {})
  }, [setErr])
  useEffect(refresh, [refresh])

  if (!presets) return <>{banner}</>
  // В external-режиме пресеты живут вне Rivet: показываем значения, но не
  // даём их менять (спека web «Политики управляются извне»).
  const external = engine?.mode === 'external'
  const set = (k: PresetKey) => (v: Presets[PresetKey]) => { setPresets({ ...presets, [k]: v }); setDirty(true) }
  const save = async () => {
    clear()
    try {
      const r = await api.putSystemPolicy(presets)
      setPresets(r.presets); setVersion(r.version); setDirty(false)
      const saved = `сохранена версия ${r.version?.version} (${shortHash(r.version?.hash)})`
      setNote(r.violations?.length
        ? `${saved}; процессы не соответствуют ограничениям: ${r.violations.map(v => `${v.project} (${v.reason})`).join('; ')}`
        : saved)
      api.systemPolicyVersions().then(v => setVersions(v ?? [])).catch(() => {})
      onSaved?.()
    } catch (e) { fail(e) }
  }

  return (
    <>
      {banner}
      <div className="dw-sec">
        <h3>Политики конвейера</h3>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
          Значения по умолчанию для всех проектов; владелец проекта может переопределить каждое в настройках проекта.
          Каждое сохранение создаёт новую версию, решения движка ссылаются на её хэш.
        </div>
        {engine && (
          <div className="budget-pause" style={{ marginBottom: 8 }}>
            Движок политик: <b>{engine.mode === 'external' ? 'внешний OPA' : 'встроенный'}</b>
            {' · '}{engine.state === 'ok' ? 'отвечает' : 'не отвечает'}
            {engine.detail ? <span className="muted"> — {engine.detail}</span> : null}
            {external && <div className="muted">Пресеты управляются вне Rivet: значения показаны только для чтения.</div>}
          </div>
        )}
        <div className="panel" style={{ maxWidth: 720 }}>
          {ROWS.map(r => (
            <div className="set-row" key={r.key}>
              <div className="lbl"><b>{r.label}</b><span>{r.hint}</span></div>
              <div className="ctl">
                <PresetControl k={r.key} value={presetValue(presets, r.key)} disabled={external} onChange={set(r.key)} />
                {fieldErr(r.key) && <div className="f-error" role="alert">{fieldErr(r.key)}</div>}
              </div>
            </div>
          ))}
        </div>
        {/* Без явного процесса показывается встроенный по умолчанию, но в
            пресеты он попадает только правкой графа: галочки ограничений
            оставляют process как был, в том числе null. */}
        <InstallationProcessSection doc={presets.process ?? defaultProcess(presets.tester_agent)} locks={presets.process_locks ?? {}} readOnly={external}
          explicit={presets.process != null}
          {...processHandlers(edit => { setPresets(prev => edit(prev ?? presets)); setDirty(true) })} />
        <div className="dw-sec">
          <div className="set-row" style={{ border: 0 }}>
            <div className="lbl">
              <b>Активная версия</b>
              <span>{version
                ? <>v{version.version} · <span className="mono">{shortHash(version.hash)}</span> · {version.created_by} · {fmtDate(version.created_at)}</>
                : 'версий нет — действуют значения по умолчанию'}</span>
            </div>
            <div className="ctl">
              <Button size="sm" variant="primary" disabled={!dirty || external}
                title={external ? 'политики управляются вне Rivet' : ''} onClick={save}>Сохранить версию</Button>
            </div>
          </div>
        </div>
        <VersionHistory versions={versions} />
      </div>
    </>
  )
}

// ─── секция «Политики» в настройках проекта ──────────────────────────────

export function ProjectPolicySection({ projectId, isOwner, tick }: { projectId: string; isOwner: boolean; tick: number }) {
  const [pp, setPP] = useState<ProjectPolicy | null>(null)
  const [overrides, setOverrides] = useState<Overrides | null>(null)
  const [versions, setVersions] = useState<PolicyVersion[]>([])
  const [dirty, setDirty] = useState(false)
  const { banner, setErr, setNote, fail, clear, fieldErr } = useBanner()
  // Черновик планового бюджета месяца строкой: поле не теряет «12.» при
  // вводе дробной части. null — показывается сохранённое значение.
  const [monthDraft, setMonthDraft] = useState<string | null>(null)
  // Модели ролей проекта (add-agent-roles): тройка «профиль, подключение,
  // модель» из выбора установки; у шаблона с профилем — его привязки.
  // Плановый бюджет месяца есть только у бэкенда с обзором проекта: старый
  // поле не знает и молча его отбросил бы.
  const { roles, overviewAvailable } = useStore()
  const [choices, setChoices] = useState<ModelChoice[]>([])
  useEffect(() => { api.modelChoices().then(r => setChoices(r?.choices ?? [])).catch(() => {}) }, [])

  const refresh = useCallback(() => {
    api.projectPolicy(projectId).then(p => {
      setPP(p)
      // Правки владельца не затираются фоновым обновлением. Черновик
      // бюджета уходит вместе с заменой переопределений ответом сервера.
      if (!dirty) setMonthDraft(null)
      setOverrides(cur => (cur && dirty) ? cur : p.overrides)
    }).catch(e => setErr(errText(e)))
    api.projectPolicyVersions(projectId).then(v => setVersions(v ?? [])).catch(() => {})
  }, [projectId, dirty, setErr])
  useEffect(refresh, [refresh, tick])

  if (!pp || !overrides) return <div className="dw-sec"><h3>Политики</h3>{banner}</div>

  // Внешний движок: пресеты живут вне Rivet, локальная правка отклоняется
  // бэкендом — форма показывает значения и не даёт их менять. То же самое,
  // когда источник политики — репозиторий: там её меняют коммитом.
  const external = pp.engine?.mode === 'external'
  const fromGit = pp.source?.kind === 'git'
  const editable = isOwner && !external && !fromGit
  const switchSource = async (kind: string) => {
    setErr(''); setNote('')
    try {
      const r = await api.putProjectPolicySource(projectId, kind)
      setPP(r); setOverrides(r.overrides); setDirty(false); setMonthDraft(null)
      setNote(kind === 'git' ? 'политика читается из репозитория' : 'политика правится в консоли')
    } catch (e) { setErr(errText(e)) }
  }
  const setOv = (k: PresetKey, v: Overrides[PresetKey]) => { setOverrides({ ...overrides, [k]: v }); setDirty(true) }
  // Значение строки в форме: переопределение, если задано, иначе действующее.
  // Бюджет 0 в переопределении — «без ограничения», в поле показывается пустым.
  const shown = (k: PresetKey): Presets[PresetKey] => {
    const v = overrides[k] !== null && overrides[k] !== undefined ? (overrides[k] as Presets[PresetKey]) : presetValue(pp.effective, k)
    return k === 'daily_token_budget' && v === 0 ? null : v
  }
  const save = async () => {
    clear()
    // NaN в JSON стал бы null и молча снял бы бюджет.
    if (overrides.monthly_budget_usd != null && !Number.isFinite(overrides.monthly_budget_usd)) {
      setErr('плановый бюджет месяца — число больше 0')
      return
    }
    try {
      // Пустые шаблоны тестов значат «по умолчанию»: переопределение снимается.
      const body = overrides.test_paths && overrides.test_paths.length === 0 ? { ...overrides, test_paths: null } : overrides
      const r = await api.putProjectPolicy(projectId, body)
      setPP(r); setOverrides(r.overrides); setDirty(false); setMonthDraft(null)
      setNote(`сохранена версия проекта ${r.version?.version} (${shortHash(r.version?.hash)})`)
      api.projectPolicyVersions(projectId).then(v => setVersions(v ?? [])).catch(() => {})
    } catch (e) { fail(e) }
  }

  return (
    <div className="dw-sec">
      <h3>Политики</h3>
      {banner}
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
        Пресеты наследуются от установки; владелец может переопределить любой и вернуть наследование.
        Действующая политика: <span className="mono">{shortHash(pp.effective_hash)}</span>
        {pp.version ? <> · версия проекта v{pp.version.version}</> : ' · переопределений нет'}
        {pp.installation_version ? <> · установка v{pp.installation_version.version}</> : ' · установка по умолчанию'}
      </div>
      {external && (
        <div className="budget-pause" style={{ marginBottom: 8 }}>
          Политики управляются вне Rivet: установка работает с внешним движком, значения показаны только для чтения.
        </div>
      )}
      {!external && (
        <div className="set-row">
          <div className="lbl">
            <b>Источник политики</b>
            <span>{fromGit
              ? <>файл <span className="mono">{pp.source?.file}</span> в ветке <span className="mono">{pp.source?.ref}</span>: значения меняются коммитом</>
              : 'хранилище Rivet: значения правятся здесь'}</span>
          </div>
          <div className="ctl">
            {isOwner && (
              <Button size="sm" onClick={() => switchSource(fromGit ? 'store' : 'git')}>
                {fromGit ? 'Вернуть в консоль' : 'Хранить в репозитории'}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="panel" style={{ maxWidth: 760 }}>
        {ROWS.map(r => {
          const inherited = overrides[r.key] === null || overrides[r.key] === undefined
          return (
            <div className="set-row" key={r.key}>
              <div className="lbl">
                <b>{r.label}
                  <span className="chip" style={{ marginLeft: 8 }}>
                    <span className="n">{inherited ? 'наследуется' : 'переопределено'}</span>
                  </span>
                </b>
                <span>{r.hint}{inherited && <> · действует: {fmtValue(r.key, presetValue(pp.effective, r.key))}</>}</span>
              </div>
              <div className="ctl">
                {editable && (
                  <Checkbox checked={!inherited} label={<span className="muted" style={{ fontSize: 12 }}>переопределить</span>}
                    onChange={on => setOv(r.key, on
                      ? (r.key === 'daily_token_budget' && pp.effective[r.key] == null ? 0 : presetValue(pp.effective, r.key))
                      : null)} />
                )}
                <PresetControl k={r.key} value={shown(r.key)} disabled={!editable || inherited}
                  onChange={v => setOv(r.key, r.key === 'daily_token_budget' && v == null ? 0 : v)} />
                {fieldErr(r.key) && <div className="f-error" role="alert">{fieldErr(r.key)}</div>}
              </div>
            </div>
          )
        })}
        {Object.entries(pp.agent_models ?? {}).filter(([, am]) => am.models.length > 0).map(([id, am]) => {
          const ov = overrides.agent_models?.[id]
          const inherited = !ov
          const refLabel = (m: { connection_id: string; model: string } | null) => m ? `${m.connection_id}/${m.model}` : 'не задана'
          const setAgent = (v: { connection_id: string; model: string } | null) => {
            const next = { ...(overrides.agent_models ?? {}) }
            if (v) next[id] = v; else delete next[id]
            setOverrides({ ...overrides, agent_models: Object.keys(next).length ? next : null }); setDirty(true)
          }
          return (
            <div className="set-row" key={'agent-' + id} data-agent-model={id}>
              <div className="lbl">
                <b>Модель агента {am.name}
                  <span className="chip" style={{ marginLeft: 8 }}><span className="n">{inherited ? 'наследуется' : 'переопределено'}</span></span>
                </b>
                <span>модель по умолчанию участников <span className="mono">{id}</span> без явной модели · действует: <span className="mono">{refLabel(am.effective)}</span></span>
              </div>
              <div className="ctl">
                {editable && (
                  <Checkbox checked={!inherited} label={<span className="muted" style={{ fontSize: 12 }}>переопределить</span>}
                    onChange={on => setAgent(on ? (am.installation ?? am.models[0] ?? null) : null)} />
                )}
                <Select size="sm" aria-label={`модель агента ${id}`} disabled={!editable || inherited}
                  value={ov ? `${ov.connection_id}/${ov.model}` : am.installation ? `${am.installation.connection_id}/${am.installation.model}` : ''}
                  onChange={e => { const m = am.models.find(x => `${x.connection_id}/${x.model}` === e.target.value); if (m) setAgent({ connection_id: m.connection_id, model: m.model }) }}>
                  {am.models.length === 0 && <option value="">привязок нет</option>}
                  {am.models.map(m => <option key={`${m.connection_id}/${m.model}`} value={`${m.connection_id}/${m.model}`}>{m.connection_id}/{m.model}</option>)}
                </Select>
              </div>
            </div>
          )
        })}
        {roles.filter(r => r.enabled && !r.control_plane).map(r => {
          // Варианты: привязки профиля шаблона, без профиля — всех включённых.
          const opts = choices.filter(c => !r.agent || c.agent === r.agent)
          if (opts.length === 0) return null
          const ov = overrides.role_models?.[r.id]
          const inherited = !ov
          const own: RoleModelRef | null = r.model ? { agent: r.agent, connection_id: r.connection_id, model: r.model } : null
          // Без модели шаблона действует модель профиля с учётом
          // переопределения агента в проекте.
          const profEff = r.agent ? pp.agent_models?.[r.agent]?.effective : null
          const effLabel = ov ? `${ov.agent || r.agent || 'профиль шаблона'} / ${ov.connection_id}/${ov.model}`
            : own ? `${own.agent || 'любой профиль'} / ${own.connection_id}/${own.model}`
            : profEff ? `${r.agent} / ${profEff.connection_id}/${profEff.model} (профиль)` : 'по умолчанию профиля'
          const setRole = (v: RoleModelRef | null) => {
            const next = { ...(overrides.role_models ?? {}) }
            if (v) next[r.id] = v; else delete next[r.id]
            setOverrides({ ...overrides, role_models: Object.keys(next).length ? next : null }); setDirty(true)
          }
          const cur = tripleKey(ov ?? own)
          const fErr = fieldErr(`role_models.${r.id}`)
          return (
            <div className="set-row" key={'role-' + r.id} data-role-model={r.id}>
              <div className="lbl">
                <b>Модель роли {r.title}
                  <span className="chip" style={{ marginLeft: 8 }}><span className="n">{inherited ? 'наследуется' : 'переопределено'}</span></span>
                </b>
                <span>агенты и участники роли <span className="mono">{r.id}</span> без своей модели · действует: <span className="mono">{effLabel}</span></span>
              </div>
              <div className="ctl">
                {editable && (
                  <Checkbox checked={!inherited} label={<span className="muted" style={{ fontSize: 12 }}>переопределить</span>}
                    onChange={on => setRole(on ? (own ?? { agent: opts[0].agent, connection_id: opts[0].connection_id, model: opts[0].model }) : null)} />
                )}
                <Select size="sm" aria-label={`модель роли ${r.id}`} disabled={!editable || inherited} aria-invalid={fErr ? true : undefined}
                  value={cur} onChange={e => { if (e.target.value) setRole(tripleOf(e.target.value)) }}>
                  {!cur && <option value="">по умолчанию профиля</option>}
                  {cur && !opts.some(c => tripleKey(c) === cur) && <option value={cur}>{effLabel}</option>}
                  {opts.map(c => <option key={tripleKey(c)} value={tripleKey(c)}>{choiceLabel(c)}{c.runner_online ? '' : ' · нет runner’а'}</option>)}
                </Select>
                {fErr && <div className="f-error" role="alert">{fErr}</div>}
              </div>
            </div>
          )
        })}
        {/* Плановый бюджет месяца (add-project-lead-view): только у проекта,
            наследования от установки нет. На него ведёт ссылка из «Денег»
            обзора проекта. */}
        {overviewAvailable && <div className="set-row" id="monthly-budget" data-preset="monthly_budget_usd">
          <div className="lbl">
            <b>Плановый бюджет месяца, $</b>
            <span>только для прогноза: обзор проекта сравнивает с ним расход месяца, работа по нему не останавливается. Пусто — не задан</span>
          </div>
          <div className="ctl">
            <NumberInput min={0} step="0.01" width={120} placeholder="не задан" disabled={!editable}
              aria-label="плановый бюджет месяца" aria-invalid={fieldErr('monthly_budget_usd') ? true : undefined}
              value={monthDraft ?? (overrides.monthly_budget_usd != null ? String(overrides.monthly_budget_usd) : '')}
              onChange={e => {
                const v = e.target.value
                setMonthDraft(v)
                setOverrides({ ...overrides, monthly_budget_usd: v.trim() === '' ? null : Number(v) }); setDirty(true)
              }} />
            {fieldErr('monthly_budget_usd') && <div className="f-error" role="alert">{fieldErr('monthly_budget_usd')}</div>}
          </div>
        </div>}
        {editable && (
          <div className="set-row" style={{ border: 0 }}>
            <div className="lbl"><b>Сохранить</b><span>создаёт новую версию политики проекта</span></div>
            <div className="ctl">
              <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Сохранить версию</Button>
            </div>
          </div>
        )}
      </div>
      <VersionHistory versions={versions} />
    </div>
  )
}
