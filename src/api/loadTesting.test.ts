import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, subscribe, type Event } from './client.ts'
import { planRefresh } from '../components/eventBatch.ts'
test('project load API unwraps environments and sends explicit binding/idempotency profile',async()=>{
 const previous=globalThis.fetch,calls:{url:string;init:RequestInit|undefined}[]=[]
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json(String(url).endsWith('/load-testing')?{environments:[{environment_id:'env'}]}:{id:'run'})}
 try{
  assert.deepEqual(await api.projectLoadTesting('project'),[{environment_id:'env'}])
  const binding={release_id:'r',publication_id:'p',version:'v',generation:1}
  await api.startLoadTest('env',{request_id:'explicit',binding,profile:{unit:'rps',target:1,capacity_ceiling:1,target_duration_s:10,max_vus:1,think_time_ms:0,p95_ms:1,max_error_rate_pct:0,routes:[{path:'/',weight:1,expected_status:200}]}})
  assert.equal(calls[0].url,'/api/v1/projects/project/load-testing')
  const sent=JSON.parse(String(calls[1].init?.body));assert.deepEqual(sent.binding,binding);assert.equal(sent.request_id,'explicit');assert.equal(sent.profile.p95_ms,1);assert.equal('auth_value' in sent.profile,false)
 }finally{globalThis.fetch=previous}
})
test('exact durable load SSE events trigger refresh and runner occupancy, with reconnect state',()=>{
 const original=globalThis.EventSource,listeners=new Map<string,(event:MessageEvent)=>void>();let closed=false
 class Source {onopen:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(_url:string){source=this}addEventListener(name:string,fn:(event:MessageEvent)=>void){listeners.set(name,fn)}close(){closed=true}}
 let source:Source|undefined
 globalThis.EventSource=Source as unknown as typeof EventSource
 const seen:Event[]=[],states:boolean[]=[]
 try{
  const stop=subscribe('p',{onEvent:e=>seen.push(e),onState:v=>states.push(v)})
  for(const [i,name]of ['load_test.prompt_changed','load_test.status','load_test.progress'].entries()){
   assert.ok(listeners.has(name));listeners.get(name)!({data:JSON.stringify({ID:i+1,ProjectID:'p',Type:name})} as MessageEvent)
  }
  source!.onopen!();source!.onopen!();assert.deepEqual(states,[true,true])
  assert.equal(seen.length,3);assert.equal(planRefresh(seen,()=>false).runners,true)
  assert.equal(listeners.has('load_test.prompt'),false)
  stop();assert.equal(closed,true)
 }finally{globalThis.EventSource=original}
})
