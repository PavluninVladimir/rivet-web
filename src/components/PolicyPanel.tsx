import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { InstallationProcessSection } from './ProcessSection'
import { DEFAULT_PROCESS } from '../api/client'
import { api, type Overrides, type PolicyEngine, type PolicyVersion, type Presets, type ProjectPolicy } from '../api/client'
import { fmtDate, fmtTokens } from './ui'
import { Button, Checkbox, FormNote, NumberInput, Switch, TagsInput, errText } from './form'

// Политики конвейера пресетами (спека web «Политики в консоли», change
// add-policy-presets). Строки set-row с переключателями и числовыми полями
// по прототиповскому Settings (orchestrator policy); сверх прототипа —
// пути, требующие человека, разрешение автопубликации, хэш версии и
// история (их требует спека аудита). «Escalate blocked tasks» и «Notify»
// из прототипа не делаются (design, сверка с прототипом).

type PresetKey = 'auto_merge' | 'human_review_paths' | 'attempt_limit' | 'review_limit' | 'daily_token_budget' | 'auto_publish'

const ROWS: { key: PresetKey; label: string; hint: string }[] = [
  { key: 'auto_merge', label: 'Авто-merge после review', hint: 'мержить PR, когда review и проверки пройдены' },
  { key: 'human_review_paths', label: 'Пути, требующие человека', hint: 'PR с такими файлами ждёт подтверждения: infra/**, **/*.sql, deploy/prod/*' },
  { key: 'attempt_limit', label: 'Лимит попыток', hint: 'задача проваливается после N неуспешных циклов' },
  { key: 'review_limit', label: 'Лимит отказов review', hint: 'эскалация человеку после N отказов review' },
  { key: 'daily_token_budget', label: 'Дневной бюджет токенов', hint: 'пауза планирования при превышении, пусто — без ограничения' },
  { key: 'auto_publish', label: 'Автопубликация после merge', hint: 'разрешить окружениям с автозапуском публиковаться' },
]

export function shortHash(h: string | undefined | null): string {
  return h ? h.slice(0, 12) : '—'
}

export { Switch }

function PathsInput({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (v: string[]) => void }) {
  return <div style={{ minWidth: 260 }}><TagsInput value={value} disabled={disabled} onChange={onChange} placeholder="infra/**, **/*.sql" /></div>
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
      return <Switch on={Boolean(value)} disabled={disabled} onChange={onChange} />
    case 'human_review_paths':
      return <PathsInput value={(value as string[]) ?? []} disabled={disabled} onChange={onChange} />
    case 'daily_token_budget':
      return <NumInput value={value as number | null} disabled={disabled} width={120} min={0}
        placeholder="без лимита" onChange={onChange} />
    default:
      return <NumInput value={value as number} disabled={disabled} onChange={v => onChange(Math.max(1, v ?? 1))} />
  }
}

function fmtValue(k: PresetKey, v: Presets[PresetKey]): string {
  if (k === 'auto_merge' || k === 'auto_publish') return v ? 'вкл' : 'выкл'
  if (k === 'human_review_paths') return (v as string[]).length ? (v as string[]).join(', ') : 'нет'
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

function useBanner() {
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const banner: ReactNode = (err || note) ? <div style={{ marginBottom: 8 }}><FormNote err={err || undefined} ok={note || undefined} /></div> : null
  return { banner, setErr, setNote }
}

// ─── пресеты установки (вкладка «Политики» раздела управления) ──────────

export function InstallationPolicyPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const [presets, setPresets] = useState<Presets | null>(null)
  const [engine, setEngine] = useState<PolicyEngine | null>(null)
  const [version, setVersion] = useState<PolicyVersion | null>(null)
  const [versions, setVersions] = useState<PolicyVersion[]>([])
  const [dirty, setDirty] = useState(false)
  const { banner, setErr, setNote } = useBanner()

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
    setErr(''); setNote('')
    try {
      const r = await api.putSystemPolicy(presets)
      setPresets(r.presets); setVersion(r.version); setDirty(false)
      const saved = `сохранена версия ${r.version?.version} (${shortHash(r.version?.hash)})`
      setNote(r.violations?.length
        ? `${saved}; процессы не соответствуют ограничениям: ${r.violations.map(v => `${v.project} (${v.reason})`).join('; ')}`
        : saved)
      api.systemPolicyVersions().then(v => setVersions(v ?? [])).catch(() => {})
      onSaved?.()
    } catch (e) { setErr(errText(e)) }
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
                <PresetControl k={r.key} value={presets[r.key]} disabled={external} onChange={set(r.key)} />
              </div>
            </div>
          ))}
        </div>
        <InstallationProcessSection doc={presets.process ?? DEFAULT_PROCESS} locks={presets.process_locks ?? {}} readOnly={external}
          onChange={(d, l) => { setPresets(prev => ({ ...(prev ?? presets), process: d, process_locks: Object.keys(l).length ? l : null })); setDirty(true) }} />
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
  const { banner, setErr, setNote } = useBanner()

  const refresh = useCallback(() => {
    api.projectPolicy(projectId).then(p => {
      setPP(p)
      // Правки владельца не затираются фоновым обновлением.
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
      setPP(r); setOverrides(r.overrides); setDirty(false)
      setNote(kind === 'git' ? 'политика читается из репозитория' : 'политика правится в консоли')
    } catch (e) { setErr(errText(e)) }
  }
  const setOv = (k: PresetKey, v: Overrides[PresetKey]) => { setOverrides({ ...overrides, [k]: v }); setDirty(true) }
  // Значение строки в форме: переопределение, если задано, иначе действующее.
  // Бюджет 0 в переопределении — «без ограничения», в поле показывается пустым.
  const shown = (k: PresetKey): Presets[PresetKey] => {
    const v = overrides[k] !== null && overrides[k] !== undefined ? (overrides[k] as Presets[PresetKey]) : pp.effective[k]
    return k === 'daily_token_budget' && v === 0 ? null : v
  }
  const save = async () => {
    setErr(''); setNote('')
    try {
      const r = await api.putProjectPolicy(projectId, overrides)
      setPP(r); setOverrides(r.overrides); setDirty(false)
      setNote(`сохранена версия проекта ${r.version?.version} (${shortHash(r.version?.hash)})`)
      api.projectPolicyVersions(projectId).then(v => setVersions(v ?? [])).catch(() => {})
    } catch (e) { setErr(errText(e)) }
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
                <span>{r.hint}{inherited && <> · действует: {fmtValue(r.key, pp.effective[r.key])}</>}</span>
              </div>
              <div className="ctl">
                {editable && (
                  <Checkbox checked={!inherited} label={<span className="muted" style={{ fontSize: 12 }}>переопределить</span>}
                    onChange={on => setOv(r.key, on
                      ? (r.key === 'daily_token_budget' && pp.effective[r.key] == null ? 0 : pp.effective[r.key])
                      : null)} />
                )}
                <PresetControl k={r.key} value={shown(r.key)} disabled={!editable || inherited}
                  onChange={v => setOv(r.key, r.key === 'daily_token_budget' && v == null ? 0 : v)} />
              </div>
            </div>
          )
        })}
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
