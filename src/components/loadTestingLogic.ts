import type { LoadBinding, LoadLimits, LoadProfile, LoadRun } from '../api/client'
export const loadLabels:Record<string,string>={queued:'В очереди',running:'Выполняется',passed:'Цель выдержана',failed:'SLO не выдержан',inconclusive:'Недостаточно данных',config_needed:'Нужна настройка',cancelled:'Отменён',interrupted:'Прерван',not_run:'Не проверено',ceiling_reached:'Достигнут заданный предел',slo_boundary:'Найдена граница SLO'}
export const loadLabel=(s:string)=>loadLabels[s]??s
export const loadActive=(r:LoadRun|null|undefined)=>!!r&&(r.state==='queued'||r.state==='running'||r.stopping)
export const sameLoadBinding=(a:LoadBinding|null,b:LoadBinding|null)=>!!a&&!!b&&a.release_id===b.release_id&&a.publication_id===b.publication_id&&a.version===b.version&&a.generation===b.generation
export function defaultLoadProfile(l:LoadLimits):LoadProfile{return {unit:'rps',target:Math.min(10,l.max_rps),capacity_ceiling:Math.min(10,l.max_rps),target_duration_s:Math.min(30,l.max_target_duration_s),max_vus:Math.min(10,l.max_vus),think_time_ms:0,p95_ms:500,max_error_rate_pct:0,routes:[{path:'/',weight:1,expected_status:200}]}}
export function loadPhases(p:LoadProfile){const out=[{load:p.target,duration:p.target_duration_s}];for(let i=1;i<=3&&p.capacity_ceiling>p.target;i++){const n=p.target+Math.ceil((p.capacity_ceiling-p.target)*i/3);if(n>out[out.length-1].load)out.push({load:n,duration:20})}return out}
export function validateLoadProfile(p:LoadProfile,l:LoadLimits):Record<string,string>{
 const e:Record<string,string>={},integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max,limit=p.unit==='vus'?l.max_vus:l.max_rps
 if(!integer(p.target,1,limit))e.target=`Целое число от 1 до ${limit}`
 if(!integer(p.capacity_ceiling,p.target,limit))e.capacity_ceiling=`От target до ${limit}`
 if(!integer(p.target_duration_s,10,l.max_target_duration_s))e.target_duration_s=`От 10 до ${l.max_target_duration_s} секунд`
 if(!integer(p.max_vus,p.unit==='vus'?p.capacity_ceiling:1,l.max_vus))e.max_vus=`До ${l.max_vus} VUs; для VUs не меньше предела поиска`
 if(p.unit==='vus'&&!integer(p.think_time_ms,1000,10000))e.think_time_ms='От 1000 до 10000 мс'
 if(!integer(p.p95_ms,1,5000))e.p95_ms='От 1 до 5000 мс'
 if(!Number.isFinite(p.max_error_rate_pct)||p.max_error_rate_pct<0||p.max_error_rate_pct>10)e.max_error_rate_pct='От 0 до 10 процентов'
 if(p.routes.length<1||p.routes.length>5)e.routes='От 1 до 5 GET-путей'
 const paths=new Set<string>()
 p.routes.forEach((r,i)=>{
  let decoded='';try{decoded=decodeURIComponent(r.path)}catch{e[`routes.${i}.path`]='Некорректное URL-кодирование'}
  if(!r.path.startsWith('/')||r.path.startsWith('//')||r.path.length>200||/[\r\n\0\\#]/.test(decoded)||paths.has(r.path))e[`routes.${i}.path`]='Уникальный относительный GET-путь, например /api/companies'
  paths.add(r.path)
  if(!integer(r.weight,1,10))e[`routes.${i}.weight`]='Вес от 1 до 10'
  if(!integer(r.expected_status,200,299))e[`routes.${i}.expected_status`]='Ожидается статус 200–299'
  if(r.expected_content_type&&!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(r.expected_content_type))e[`routes.${i}.expected_content_type`]='Например application/json, без параметров'
 })
 if(p.auth&&!p.auth.secret_name)e.auth='Выберите существующий тестовый секрет'
 const budget=p.routes.length*5+10+loadPhases(p).reduce((s,ph)=>s+ph.duration+5,0)
 if(budget>l.max_run_duration_s)e.budget=`Профиль требует до ${budget} с; лимит попытки ${l.max_run_duration_s} с`
 return e
}

export const loadStageLabel=(stage:string)=>stage==='target'?'Target':stage.startsWith('capacity_')?`Ступень поиска ${stage.slice(9)}`:stage==='preflight'?'Проверка сценария':stage==='stopping'?'Остановка':stage
export function mergeLoadRuns(fresh:LoadRun[],older:LoadRun[]):LoadRun[]{return Array.from(new Map([...older,...fresh].map(r=>[r.id,r])).values()).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))}
Object.assign(loadLabels,{generator_or_sut_limited:'Генератор не обеспечил заданную нагрузку',vus_not_reached:'Заданное число VUs не достигнуто',insufficient_samples:'Недостаточно измерений',incomplete_metrics:'Неполные измерения',slo_failed:'Нарушен порог SLO',k6_execution_failed:'k6 не завершил измерение',invalid_summary:'Измерения не прошли проверку'})
