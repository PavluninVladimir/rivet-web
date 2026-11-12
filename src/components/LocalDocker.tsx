import { ApplicationSecrets } from './ApplicationSecrets'
import { useEffect, useState } from 'react'
import { api, ApiError, type Environment, type LocalDockerConfig, type LocalPublication } from '../api/client'
import { Button, Field, NumberInput, Select, TextInput, TextArea, FormNote, errText } from './form'
import { localListenURL, parseLocalEnv, publicationActions } from './localDockerLogic'
const labels:Record<string,string>={queued:'в очереди',building:'сборка',starting:'запуск',verifying:'проверка',running:'работает',unhealthy:'не отвечает',stopping:'останавливается',stopped:'остановлено',failed:'ошибка',unknown:'состояние неизвестно'}
export function LocalDockerCard({env,tick,isAdmin,onSettings}:{env:Environment;tick:number;isAdmin:boolean;onSettings:()=>void}){
 const [pub,setPub]=useState<LocalPublication|null>(null),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const [log,setLog]=useState<string|null>(null),[stream,setStream]=useState<'builder'|'container'>('builder'),[secretsOpen,setSecretsOpen]=useState(false)
 useEffect(()=>{let live=true;let timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const p=await api.localPublication(env.id);if(live)setPub(p)}catch(e){if(live&&!(e instanceof ApiError&&e.status===404))setErr(errText(e))}finally{if(live)timer=setTimeout(load,3000)}};void load();return()=>{live=false;clearTimeout(timer)}},[env.id,tick,refresh])
 const a=publicationActions(pub,env.paused),url=pub?.status==='stopped'?null:localListenURL(pub?.listen??null)
 const act=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setErr('');try{const p=await fn();if(p&&typeof p==='object'&&'generation' in p)setPub(p as LocalPublication);setRefresh(n=>n+1)}catch(e){setErr(errText(e))}finally{setBusy(false)}}
 const logs=async(s:'builder'|'container')=>{setStream(s);setLog('Загрузка…');try{setLog(await api.localLogs(env.id,s))}catch(e){setLog(errText(e))}}
 return <div className="env-card">
  <div className="env-top"><b>{env.name}</b><span className="mono muted">локальный Docker</span>{env.paused&&<span className="env-paused">пауза</span>}</div>
  <div className="env-status"><span className="sess-stage">{pub?labels[pub.status]:env.preparation==='waiting_artifact'?'Docker готов, ожидается первый проверенный артефакт':env.preparation==='failed'?'подготовка стенда не выполнена':env.preparation?'инженер по выпуску готовит Docker-стенд':'публикаций не было'}</span>{pub&&<><span className="mono" title={pub.version}>{pub.version.slice(0,12)}</span><span className="muted">поколение {pub.generation}</span></>}</div>
  {url&&<div className="dw-actions"><a href={url} target="_blank" rel="noreferrer">{pub!.listen} ↗</a><Button size="sm" onClick={()=>{void navigator.clipboard.writeText(pub!.listen!).catch(()=>setErr('Не удалось скопировать адрес'))}}>Копировать</Button></div>}
  {pub?.reason&&<div className="env-detail">{pub.reason.message} <button className="btn sm" onClick={()=>void logs('builder')}>Лог сборки</button></div>}
  <FormNote err={err||undefined}/>
  <div className="dw-actions" style={{marginTop:8}}>
   {env.paused?<Button size="sm" disabled={busy} onClick={()=>void act(()=>api.resumeEnv(env.id))}>Возобновить</Button>:<Button size="sm" variant="primary" disabled={busy||!a.publish} onClick={()=>void act(()=>api.publishLocal(env.id))}>Опубликовать</Button>}
   {pub?.status!=='stopped'&&<Button size="sm" disabled={busy||!a.redeploy} onClick={()=>void act(()=>api.redeployLocal(env.id))}>Пересобрать</Button>}
   {pub?.status!=='stopped'&&<><Button size="sm" disabled={busy||!a.restart} onClick={()=>void act(()=>api.restartLocal(env.id))}>Перезапустить</Button><Button size="sm" disabled={busy||!a.stop} onClick={()=>void act(()=>api.stopLocal(env.id))}>Остановить</Button></>}
   <Button size="sm" disabled={!pub} onClick={()=>log===null?void logs(stream):setLog(null)}>Логи</Button>
   {isAdmin&&<><Button size="sm" onClick={onSettings}>Настроить</Button><Button size="sm" aria-expanded={secretsOpen} onClick={()=>setSecretsOpen(v=>!v)}>Секреты приложения</Button></>}
  </div>
  {secretsOpen&&isAdmin&&<ApplicationSecrets env={env} />}
  {log!==null&&<><div className="dw-actions"><Button size="sm" onClick={()=>void logs('builder')}>Сборка</Button><Button size="sm" disabled={!pub?.container_id||pub.status==='stopped'} onClick={()=>void logs('container')}>Приложение</Button></div><pre className="term sess-term">{log||'Вывода нет'}</pre></>}
 </div>
}
export function LocalDockerFields({value,onChange,error,onValidityChange}:{value:LocalDockerConfig;onChange:(v:LocalDockerConfig)=>void;error:(field:string)=>string|undefined;onValidityChange:(valid:boolean)=>void}){
 const c=value??{container_port:8080},set=(patch:Partial<LocalDockerConfig>)=>onChange({...c,...patch})
 const [envText,setEnvText]=useState(()=>JSON.stringify(c.env??{},null,2)),[envError,setEnvError]=useState('')
 const number=(label:string,key:'container_port'|'startup_timeout_s'|'stop_timeout_s',min:number,max:number,fallback:number)=><Field label={label} error={error('config.local_docker.'+key)}>{ids=><NumberInput ids={ids} min={min} max={max} value={c[key]??fallback} onChange={e=>set({[key]:Number(e.target.value)})}/>}</Field>
 return <>
  {number('Порт приложения','container_port',1,65535,8080)}
  <Field label="Путь проверки" error={error('config.local_docker.health_path')}>{ids=><TextInput ids={ids} value={c.health_path??'/'} onChange={e=>set({health_path:e.target.value})}/>}</Field>
  <Field label="Сборка" error={error('config.local_docker.recipe')}>{ids=><Select ids={ids} value={c.recipe??'auto'} onChange={e=>set({recipe:e.target.value as LocalDockerConfig['recipe']})}><option value="auto">Определить автоматически</option><option value="go">Go</option><option value="node">Node.js</option><option value="static">Статический сайт</option></Select>}</Field>
  <Field label="Каталог приложения" hint="Относительно корня репозитория" error={error('config.local_docker.build_context')}>{ids=><TextInput ids={ids} value={c.build_context??'.'} onChange={e=>set({build_context:e.target.value})}/>}</Field>
  <div className="f-grid">{number('Ожидание запуска, с','startup_timeout_s',10,600,120)}{number('Ожидание остановки, с','stop_timeout_s',1,120,10)}</div>
  <Field label="Переменные приложения" hint="JSON-объект с открытыми значениями. Пароли и ключи задаются отдельно кнопкой «Секреты приложения» после создания окружения." error={envError||error('config.local_docker.env')}>{ids=><TextArea ids={ids} value={envText} onChange={e=>{setEnvText(e.target.value);try{set({env:parseLocalEnv(e.target.value)});setEnvError('');onValidityChange(true)}catch{setEnvError('Введите JSON-объект со строковыми значениями');onValidityChange(false)}}}/>}</Field>
  <div className="muted">Адрес появится после публикации. Приложение доступно только на этой машине.</div>
 </>
}
