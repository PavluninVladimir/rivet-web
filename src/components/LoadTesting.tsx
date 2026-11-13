import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, apiField, type ApplicationSecret, type LoadBinding, type LoadProfile, type LoadRun, type LoadView } from '../api/client'
import { useStore } from '../store'
import { Button, Field, FormNote, NumberInput, Select, TextInput, errText } from './form'
import { defaultLoadProfile, loadActive, loadLabel, loadStageLabel, mergeLoadRuns, sameLoadBinding, validateLoadProfile } from './loadTestingLogic'
import './loadTesting.css'

// Keep the last successful snapshot through SSE reconnects and transient failures.
// Request sequencing prevents another project or an older response replacing it.
function useLoadResource<T>(key:string,fetcher:()=>Promise<T>) {
 const {eventTick,connects}=useStore(),fetchRef=useRef(fetcher);fetchRef.current=fetcher
 const seq=useRef(0),[value,setValue]=useState<T|null>(null),[error,setError]=useState(''),[unavailable,setUnavailable]=useState(false)
 const reload=useCallback(()=>{if(!key)return;const n=++seq.current;void fetchRef.current().then(v=>{if(n===seq.current){setValue(v);setError('');setUnavailable(false)}},e=>{if(n===seq.current){setError(errText(e));setUnavailable(e instanceof ApiError&&e.status===404)}})},[key])
 useEffect(()=>{setValue(null);setError('');setUnavailable(false);return()=>{++seq.current}},[key])
 useEffect(reload,[reload,eventTick,connects])
 return {value,error,unavailable,reload}
}

export function ProjectLoadBanner({projectId}:{projectId:string}) {
 const {value,error,unavailable,reload}=useLoadResource(projectId,()=>api.projectLoadTesting(projectId))
 if(unavailable||!value)return null
 const visible=value.filter(v=>v.supported&&(v.prompt?.state==='awaiting_target'||!!v.latest_run))
 if(!visible.length)return null
 return <div className="load-project" aria-label="Нагрузочное тестирование проекта">
  {error&&<FormNote err={`Не удалось обновить данные: ${error}. Показан последний снимок.`}/>}
  {visible.map(v=><section className="load-banner" key={v.environment_id}>
   <div><strong>{v.name} · Нагрузочное тестирование</strong><p>{loadActive(v.latest_run)?'Явно запрошенная проверка нагрузки':v.prompt?.state==='awaiting_target'?'Первый рабочий релиз готов. Какую нагрузку должно выдерживать приложение?':'Проверка завершена. Отчёт и следующий явный запуск доступны здесь.'}</p></div>
   <LoadStatus run={v.latest_run}/>
   <LoadControls view={v} disabled={!!error} onChanged={reload}/>
   {v.latest_run&&!loadActive(v.latest_run)&&<LoadRunReport run={v.latest_run}/>}
  </section>)}
 </div>
}

function LoadStatus({run}:{run:LoadRun|null}) {
 if(!run)return null
 return <div className="load-status" role="status" aria-live="polite">
  <b>{run.stopping?'Останавливается нагрузка':loadLabel(run.state)}</b>
  {run.stage&&loadActive(run)&&<span>{run.stage==='target'?'Проверка target':run.stage==='preflight'?'Проверка сценария':run.stage.startsWith('capacity_')?'Поиск границы нагрузки':run.stage}</span>}
  {run.reason&&<span>{run.reason.message}</span>}
  <span className="mono">Версия {run.version.slice(0,12)} · поколение {run.generation}</span>
  {run.deadline_at&&loadActive(run)&&<span>Дедлайн {new Date(run.deadline_at).toLocaleTimeString()}</span>}
 </div>
}

type Repeat={profile:LoadProfile;key:number}
function LoadControls({view,disabled,onChanged,repeat}:{view:LoadView;disabled?:boolean;onChanged:()=>void;repeat?:Repeat|null}) {
 const [form,setForm]=useState<Repeat|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),button=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(repeat)setForm(repeat)},[repeat])
 const close=()=>{setForm(null);queueMicrotask(()=>button.current?.focus())}
 const act=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await fn();onChanged()}catch(e){setError(errText(e))}finally{setBusy(false)}}
 const active=loadActive(view.latest_run)
 if(!view.supported)return <p className="muted">{view.reason?.message}</p>
 if(!view.can_manage)return <p className="muted">Профиль, запуск и отмена доступны владельцу проекта.</p>
 return <>
  <div className="load-actions">
   <button type="button" ref={button} className="btn sm" disabled={disabled||active||!view.ready} onClick={()=>setForm({profile:view.saved_profile??defaultLoadProfile(view.limits),key:Date.now()})}>{view.saved_profile?'Настроить и запустить снова':'Задать нагрузку'}</button>
   {view.prompt?.state==='awaiting_target'&&!active&&<Button size="sm" busy={busy} disabled={disabled} onClick={()=>void act(()=>api.deferLoadTesting(view.environment_id))}>Позже</Button>}
   {active&&view.latest_run&&<Button size="sm" busy={busy} disabled={disabled||view.latest_run.stopping} onClick={()=>void act(()=>api.cancelLoadTest(view.latest_run!.id))}>{view.latest_run.stopping?'Остановка…':'Отменить тест'}</Button>}
  </div>
  {!view.ready&&<p className="muted">{view.reason?.message??'Для запуска нужна рабочая публикация.'}</p>}
  {error&&<FormNote err={error}/>}
  {form&&<LoadProfileForm key={form.key} view={view} initial={form.profile} disabled={disabled||active} onClose={close} onDone={()=>{close();onChanged()}} onRefresh={onChanged}/>}
 </>
}

function LoadProfileForm({view,initial,disabled,onClose,onDone,onRefresh}:{view:LoadView;initial:LoadProfile;disabled?:boolean;onClose:()=>void;onDone:()=>void;onRefresh:()=>void}) {
 const [p,setP]=useState<LoadProfile>(()=>structuredClone(initial)),[binding]=useState<LoadBinding|null>(view.binding),[secrets,setSecrets]=useState<ApplicationSecret[]>([]),[secretError,setSecretError]=useState(''),[secretsLoaded,setSecretsLoaded]=useState(false)
 const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState(''),[serverField,setServerField]=useState(''),[serverMessage,setServerMessage]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{let live=true;api.applicationSecrets(view.environment_id).then(v=>{if(live){setSecrets(v);setSecretsLoaded(true)}},e=>{if(live){setSecretError(errText(e));setSecretsLoaded(true)}});return()=>{live=false}},[view.environment_id])
 const errors=attempted?validateLoadProfile(p,view.limits):{}
 if(attempted&&p.auth&&secretsLoaded&&!secrets.some(s=>s.name===p.auth!.secret_name))errors.auth='Выбранный тестовый секрет недоступен. Выберите существующий секрет окружения.'
 const stale=!sameLoadBinding(binding,view.binding)
 const fieldError=(name:string)=>errors[name]||(serverField===name?serverMessage:undefined)
 const set=(patch:Partial<LoadProfile>)=>{setP(v=>({...v,...patch}));setServerField('');setError('')}
 const route=(i:number,patch:Partial<LoadProfile['routes'][number]>)=>set({routes:p.routes.map((r,n)=>n===i?{...r,...patch}:r)})
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setAttempted(true);setError('');setServerField('')
  const validation=validateLoadProfile(p,view.limits)
  if(p.auth&&!secrets.some(s=>s.name===p.auth!.secret_name))validation.auth='Выберите существующий тестовый секрет'
  if(Object.keys(validation).length||!binding||disabled||stale||busy)return
  setBusy(true)
  const fingerprint=JSON.stringify({binding,profile:p});if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()}
  try{await api.startLoadTest(view.environment_id,{request_id:request.current.id,binding,profile:p});onDone()}
  catch(e){setError(errText(e));setServerField(apiField(e)??'');setServerMessage(errText(e));if(e instanceof ApiError&&e.code==='version_changed')onRefresh()}
  finally{setBusy(false)}
 }
 const numeric=(name:keyof Pick<LoadProfile,'target'|'capacity_ceiling'|'target_duration_s'|'max_vus'|'think_time_ms'|'p95_ms'|'max_error_rate_pct'>,label:string,min:number,max:number,hint?:string)=><Field key={name} label={label} hint={hint} error={fieldError(name)}>{ids=><NumberInput ids={ids} value={p[name]||p[name]===0?p[name]:''} min={min} max={max} step={name==='max_error_rate_pct'?0.1:1} onChange={e=>set({[name]:Number(e.target.value)})}/>}</Field>
 return <form className="load-form" onSubmit={submit} noValidate aria-label="Профиль нагрузочного теста">
  <h4>Проверить версию {binding?.version.slice(0,12)} · поколение {binding?.generation}</h4>
  <p className="muted">Только выбранная GET-смесь чтения. Сначала target, затем до трёх ступеней по 20 с до заданного предела. Это не оценка мощности всех операций приложения.</p>
  <p className="muted">Лимиты установки: {view.limits.max_vus} VUs · {view.limits.max_rps} RPS · target до {view.limits.max_target_duration_s} с · попытка до {view.limits.max_run_duration_s} с.</p>
  <fieldset disabled={busy}>
   <div className="load-fields">
    <Field label="Единица нагрузки">{ids=><Select ids={ids} value={p.unit} onChange={e=>{const unit=e.target.value as LoadProfile['unit'];set({unit,think_time_ms:unit==='vus'?1000:0})}}><option value="rps">RPS · запросы в секунду</option><option value="vus">VUs · виртуальные пользователи</option></Select>}</Field>
    {numeric('target','Целевая нагрузка (target)',1,p.unit==='vus'?view.limits.max_vus:view.limits.max_rps)}
    {numeric('capacity_ceiling','Предел поиска нагрузки',p.target,p.unit==='vus'?view.limits.max_vus:view.limits.max_rps,'Равен target — диапазон выше цели не исследуется.')}
    {numeric('target_duration_s','Длительность target, с',10,view.limits.max_target_duration_s)}
    {numeric('max_vus','Бюджет генератора, VUs',1,view.limits.max_vus)}
    {p.unit==='vus'&&numeric('think_time_ms','Пауза пользователя, мс',1000,10000)}
    {numeric('p95_ms','SLO p95, мс',1,5000)}
    {numeric('max_error_rate_pct','Допустимые ошибки, %',0,10,'Нулевой бюджет проходит при фактическом нуле ошибок.')}
   </div>
   <h4>GET-сценарий</h4>
   {p.routes.map((r,i)=><fieldset className="load-route" key={i}><legend>GET {i+1}</legend>
    <Field label="Относительный путь" error={fieldError(`routes.${i}.path`)}>{ids=><TextInput ids={ids} value={r.path} maxLength={200} placeholder="/api/companies" onChange={e=>route(i,{path:e.target.value})}/>}</Field>
    <div className="load-fields">
     <Field label="Вес" error={fieldError(`routes.${i}.weight`)}>{ids=><NumberInput ids={ids} min={1} max={10} value={r.weight} onChange={e=>route(i,{weight:Number(e.target.value)})}/>}</Field>
     <Field label="Ожидаемый статус" error={fieldError(`routes.${i}.expected_status`)}>{ids=><NumberInput ids={ids} min={200} max={299} value={r.expected_status} onChange={e=>route(i,{expected_status:Number(e.target.value)})}/>}</Field>
     <Field label="Content-Type" optional error={fieldError(`routes.${i}.expected_content_type`)}>{ids=><TextInput ids={ids} value={r.expected_content_type??''} placeholder="application/json" onChange={e=>route(i,{expected_content_type:e.target.value.trim()})}/>}</Field>
    </div>
    {p.routes.length>1&&<Button size="sm" aria-label={`Удалить GET ${i+1}`} onClick={()=>set({routes:p.routes.filter((_,n)=>n!==i)})}>Удалить путь</Button>}
   </fieldset>)}
   {p.routes.length<5&&<Button size="sm" onClick={()=>set({routes:[...p.routes,{path:'',weight:1,expected_status:200}]})}>Добавить GET-путь</Button>}
   {fieldError('routes')&&<FormNote err={fieldError('routes')}/>}
   <div className="load-fields">
    <Field label="Тестовая авторизация" hint="Только явно выбранный секрет окружения с полным значением заголовка.">{ids=><Select ids={ids} value={p.auth?.header??''} onChange={e=>set({auth:e.target.value?{header:e.target.value as 'Authorization'|'Cookie',secret_name:''}:undefined})}><option value="">Без авторизации</option><option value="Authorization">Authorization</option><option value="Cookie">Cookie</option></Select>}</Field>
    {p.auth&&<Field label="Существующий тестовый секрет" error={fieldError('auth')}>{ids=><Select ids={ids} value={p.auth!.secret_name} onChange={e=>set({auth:{...p.auth!,secret_name:e.target.value}})}><option value="">Выберите секрет</option>{p.auth!.secret_name&&!secrets.some(s=>s.name===p.auth!.secret_name)&&<option value={p.auth!.secret_name}>{p.auth!.secret_name} · недоступен</option>}{secrets.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</Select>}</Field>}
   </div>
  </fieldset>
  {p.auth&&secretError&&<FormNote err={`Не удалось прочитать имена секретов: ${secretError}`}/>}
  {errors.budget&&<FormNote err={errors.budget}/>}
  {stale&&<FormNote err="Публикация изменилась. Закройте форму и проверьте профиль для текущей версии."/>}
  {error&&<FormNote err={error}/>}
  <div className="load-actions"><Button type="submit" variant="primary" busy={busy} disabled={disabled||stale||!view.ready||!!p.auth&&!secretsLoaded}>Запустить тест этой версии</Button><Button disabled={busy} onClick={onClose}>Закрыть</Button></div>
 </form>
}

const metric=(v:number|null,digits=1)=>v===null?'—':v.toLocaleString(undefined,{maximumFractionDigits:digits})
function LoadRunReport({run,onRepeat}:{run:LoadRun;onRepeat?:()=>void}) {
 return <details className="load-report"><summary>{loadLabel(run.state)} · {run.version.slice(0,12)} · {new Date(run.created_at).toLocaleString()}</summary>
  <LoadStatus run={run}/>
  <details><summary>Профиль и критерии этого прогона</summary><p>Target {run.profile.target} {run.profile.unit.toUpperCase()} · предел {run.profile.capacity_ceiling} · target {run.profile.target_duration_s} с · p95 ≤ {run.profile.p95_ms} мс · ошибки ≤ {run.profile.max_error_rate_pct}%</p><p>Бюджет генератора {run.profile.max_vus} VUs{run.profile.unit==='vus'?` · пауза ${run.profile.think_time_ms} мс`:''}</p>{run.profile.routes.map(r=><p key={r.path}><span className="mono">GET {r.path}</span> · вес {r.weight} · статус {r.expected_status}{r.expected_content_type?` · ${r.expected_content_type}`:''}</p>)}<p>Авторизация: {run.profile.auth?`${run.profile.auth.header} · секрет ${run.profile.auth.secret_name}`:'без авторизации'}</p></details>
  {run.report&&<>
   <p><b>Target: {loadLabel(run.report.target_result)}</b> · {loadLabel(run.report.capacity_result)}</p>
   <p>Высшая проверенная точка: {run.report.highest_passing??'—'} {run.profile.unit.toUpperCase()} · первая не прошедшая: {run.report.first_failing??'—'}</p>
   <p className="muted">{run.report.scope} k6 {run.report.k6_version||'версия не получена'}.</p>
   {run.report.warnings?.map((w,i)=><p className="muted" key={i}>{w}</p>)}
   <div className="load-table" role="region" aria-label="Таблица измеренных ступеней" tabIndex={0}><table className="tbl"><caption>Измеренные ступени</caption><thead><tr><th>Ступень</th><th>Нагрузка</th><th>Результат</th><th>RPS</th><th>VUs / max</th><th>p95 / p99, мс</th><th>Ошибки</th><th>Пропуски</th><th>Запросы</th><th>Длительность, с</th></tr></thead><tbody>{run.report.stages.map(s=><tr key={s.stage}><td>{loadStageLabel(s.stage)}</td><td>{s.load} {s.unit.toUpperCase()}</td><td>{loadLabel(s.status)}{s.reason&&<div className="muted">{loadLabel(s.reason)}</div>}</td><td>{metric(s.achieved_rps)}</td><td>{metric(s.active_vus,0)} / {metric(s.max_vus,0)}</td><td>{metric(s.p95_ms)} / {metric(s.p99_ms)}</td><td>{s.error_rate===null?'—':metric(s.error_rate*100,2)+'%'}</td><td>{s.dropped_iterations}</td><td>{s.requests}</td><td>{metric(s.duration_s)}</td></tr>)}</tbody></table></div>
   {run.report.stages.map(s=><details key={s.stage}><summary>Покрытие GET-смеси · {s.stage}</summary><p>Пороги: {Object.entries(s.thresholds).map(([name,ok])=>`${name}: ${ok?'пройден':'не пройден'}`).join(' · ')}</p>{s.per_route.map(r=><p key={r.path}><span className="mono">{r.path}</span> · {r.requests} запросов · p95 {metric(r.p95_ms)} мс · p99 {metric(r.p99_ms)} мс · ошибки {r.error_rate===null?'—':metric(r.error_rate*100,2)+'%'}</p>)}</details>)}
  </>}
  {onRepeat&&<Button size="sm" onClick={onRepeat}>Проверить текущую версию с этим профилем</Button>}
 </details>
}

export function LoadTestingPanel(props:{environmentId:string;releaseId?:string}) {
 return <LoadTestingScope key={`${props.environmentId}/${props.releaseId??''}`} {...props}/>
}
function LoadTestingScope({environmentId,releaseId}:{environmentId:string;releaseId?:string}) {
 const {value,error,unavailable,reload}=useLoadResource(`${environmentId}/${releaseId??''}`,async()=>({view:await api.environmentLoadTesting(environmentId),history:releaseId?await api.releaseLoadTests(releaseId):await api.loadTests(environmentId)}))
 const scopeEpoch=useRef(0)
 useEffect(()=>()=>{++scopeEpoch.current},[])
 const [repeat,setRepeat]=useState<Repeat|null>(null),[extra,setExtra]=useState<LoadRun[]>([]),[cursor,setCursor]=useState<string|null|undefined>(undefined),[moreError,setMoreError]=useState(''),[moreBusy,setMoreBusy]=useState(false)
 if(unavailable)return <section className="load-panel" aria-label="Нагрузочное тестирование окружения"><h4>Нагрузочное тестирование</h4><p className="muted">Нагрузочные тесты недоступны на этом сервере.</p></section>
 if(!value)return <div className="load-panel"><h4>Нагрузочное тестирование</h4>{error?<FormNote err={error}/>:<span className="muted">Загрузка…</span>}</div>
 const {view,history}=value,oldRelease=!!releaseId&&view.binding?.release_id!==releaseId
 const runs=mergeLoadRuns(history.runs,extra)
 const next=cursor===undefined?('next' in history?history.next as string|null:null):cursor
 const more=async()=>{if(!next||moreBusy)return;const epoch=scopeEpoch.current;setMoreBusy(true);setMoreError('');try{const page=await api.loadTests(environmentId,next);if(epoch!==scopeEpoch.current)return;setExtra(v=>[...v,...page.runs]);setCursor(page.next)}catch(e){if(epoch===scopeEpoch.current)setMoreError(errText(e))}finally{if(epoch===scopeEpoch.current)setMoreBusy(false)}}
 return <section className="load-panel" aria-label="Нагрузочное тестирование окружения">
  <h4>Нагрузочное тестирование</h4>
  {error&&<FormNote err={`Последний сохранённый снимок. Обновление не удалось: ${error}`}/>}
  {view.prompt?.state==='awaiting_target'&&<p>Рабочий релиз готов. Какую нагрузку должно выдерживать приложение?</p>}
  {view.prompt?.state==='deferred'&&<p className="muted">Настройка нагрузки отложена. Её можно начать здесь.</p>}
  <LoadStatus run={!releaseId||view.latest_run?.release_id===releaseId?view.latest_run:null}/>
  {oldRelease?<p className="muted">Это история прежнего релиза. Запуск для текущей версии доступен в окружении проекта.</p>:<LoadControls view={view} disabled={!!error} onChanged={reload} repeat={repeat}/>}
  <h4>{releaseId?'Проверки этого релиза':'История проверок'}</h4>
  {!runs.length&&<p className="muted">Нагрузочных проверок ещё нет. Трафик начинается только после явного запуска владельцем.</p>}
  {runs.map(run=><LoadRunReport key={run.id} run={run} onRepeat={view.can_manage&&view.ready&&!oldRelease&&!loadActive(view.latest_run)&&!error?()=>setRepeat({profile:run.profile,key:Date.now()}):undefined}/>)}
  {!releaseId&&next&&<Button size="sm" busy={moreBusy} onClick={()=>void more()}>Ещё проверки</Button>}
  {moreError&&<FormNote err={moreError}/>}
 </section>
}
