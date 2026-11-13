import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultLoadProfile, loadActive, loadPhases, mergeLoadRuns, sameLoadBinding, validateLoadProfile } from './loadTestingLogic.ts'
import { agentRunnerStats, isDeployRunner, isLoadRunner } from './agentLogic.ts'
import type { LoadBinding, LoadLimits, LoadRun } from '../api/client.ts'
const limits:LoadLimits={max_vus:100,max_rps:500,max_target_duration_s:120,max_run_duration_s:300}
test('profile accepts inclusive 1ms/zero-error bounds and installation limits above defaults',()=>{
 const p=defaultLoadProfile(limits);p.p95_ms=1;p.max_error_rate_pct=0
 assert.deepEqual(validateLoadProfile(p,limits),{})
 p.target=700;p.capacity_ceiling=900
 assert.ok(validateLoadProfile(p,limits).target)
 assert.deepEqual(validateLoadProfile(p,{...limits,max_rps:1000}),{})
})
test('profile rejects unbounded load, origins, unsafe/duplicate paths and nonrepresentative auth',()=>{
 const p=defaultLoadProfile(limits)
 for(const path of ['https://example.test/','//example.test/','/%0d%0aHeader:yes','/x#fragment','/bad\\path']){p.routes[0].path=path;assert.ok(validateLoadProfile(p,limits)['routes.0.path'],path)}
 p.routes=[{path:'/api',weight:1,expected_status:200},{path:'/api',weight:1,expected_status:200}]
 assert.ok(validateLoadProfile(p,limits)['routes.1.path'])
 p.routes=[{path:'/api',weight:1,expected_status:200}];p.target=Infinity;p.capacity_ceiling=Infinity
 assert.ok(validateLoadProfile(p,limits).target)
 p.target=1;p.capacity_ceiling=1;p.auth={header:'Authorization',secret_name:''}
 assert.ok(validateLoadProfile(p,limits).auth)
})
test('finite phase budget and VUs think time remain explicit',()=>{
 const p=defaultLoadProfile(limits);p.unit='vus';p.target=1;p.capacity_ceiling=5;p.think_time_ms=1000
 assert.equal(loadPhases(p).length,4);assert.equal(loadPhases(p).at(-1)?.load,5)
 assert.ok(validateLoadProfile({...p,think_time_ms:0},limits).think_time_ms)
 assert.ok(validateLoadProfile(p,{...limits,max_run_duration_s:30}).budget)
})
test('binding changes fence stale forms; pending cancellation stays active even after terminal state',()=>{
 const b:LoadBinding={release_id:'r',publication_id:'p',version:'v',generation:1}
 assert.ok(sameLoadBinding(b,{...b}));assert.equal(sameLoadBinding(b,{...b,generation:2}),false);assert.equal(sameLoadBinding(b,{...b,publication_id:'new'}),false)
 assert.ok(loadActive({state:'cancelled',stopping:true} as LoadRun));assert.equal(loadActive({state:'cancelled',stopping:false} as LoadRun),false)
})
test('history retains newest server state when older pagination contains the same run',()=>{
 const stale={id:'a',created_at:'2026-11-13T10:00:00Z',state:'running'} as LoadRun
 const fresh={...stale,state:'passed'} as LoadRun,older={id:'b',created_at:'2026-11-12T10:00:00Z'} as LoadRun
 assert.deepEqual(mergeLoadRuns([fresh],[stale,older]),[fresh,older])
})
test('dedicated load runner is neither deploy-only nor a model runner',()=>{
 const load={Agent:'',Capabilities:['load'],Features:['k6_load_v1'],Status:'idle'}
 assert.ok(isLoadRunner(load));assert.equal(isDeployRunner(load),false)
 assert.equal(isLoadRunner({...load,Capabilities:['load','deploy']}),false)
 assert.deepEqual(agentRunnerStats([load]),{total:0,online:0,isolated:0,deploy:0})
})
