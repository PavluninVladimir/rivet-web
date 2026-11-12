import type { LocalPublication } from '../api/client.ts'
export function publicationActions(p: LocalPublication|null,paused=false){
 const busy=!!p&&['queued','building','starting','verifying','stopping'].includes(p.status)
 return {busy,publish:!busy&&!paused,redeploy:!busy&&!paused&&!!p&&p.status!=='stopped',restart:!busy&&!!p&&['running','unhealthy','unknown'].includes(p.status)&&p.desired_state==='running',stop:!busy&&!!p&&p.status!=='stopped'&&!!p.container_id}
}
export function parseLocalEnv(text:string):Record<string,string>{
 if(!text.trim())return {}
 const value:unknown=JSON.parse(text)
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(v=>typeof v!=='string'))throw Error('Переменные задаются JSON-объектом со строковыми значениями')
 return value as Record<string,string>
}
export function localListenURL(listen:string|null):string|null{return listen&&/^(127\.0\.0\.1:\d{1,5}|\[::1\]:\d{1,5})$/.test(listen)?`http://${listen}`:null}
