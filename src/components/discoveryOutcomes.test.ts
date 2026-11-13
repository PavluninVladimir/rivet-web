import assert from 'node:assert/strict'
import test from 'node:test'
import { answerMaterial, canEditDiscovery, discoveryOutcome } from './discoveryOutcomes.ts'
const backlog=[{key:'e1',title:'Договор',goal:'Достаточно подробная цель изменения существующего продукта и критерий результата',priority:'must',size:'S'}] as never
for(const outcome of ['needs_clarification','no_development_recommended','future','',null])test(`non-actionable ${outcome}`,()=>{assert.equal(canEditDiscovery({outcome,backlog,status:'ready',outdated:false}),false)})
test('legacy fallback only usable nonempty backlog, never explicit null/error',()=>{
 assert.equal(discoveryOutcome({backlog}),'backlog_ready')
 assert.equal(discoveryOutcome({backlog:[]} ),null)
 assert.equal(discoveryOutcome({backlog,outcome:null}),null)
 assert.equal(discoveryOutcome({backlog,outcome:'backlog_ready',outcome_error:'bad'}),null)
 assert.equal(discoveryOutcome({backlog:[{key:'x',title:'x',goal:'short'}] as never}),null)
})
test('outdated/failed approved outcome cannot be edited',()=>{
 assert.equal(canEditDiscovery({outcome:'backlog_ready',backlog,status:'ready',outdated:false}),true)
 assert.equal(canEditDiscovery({outcome:'backlog_ready',backlog,status:'ready',outdated:true}),false)
 assert.equal(canEditDiscovery({outcome:'backlog_ready',backlog,status:'failed',outdated:false}),false)
})
test('answer is a new immutable material with version/question provenance',()=>{
 const text=answerMaterial({id:'run123',version:3},{id:'q1',text:'В какой системе договор?'})
 assert.match(text,/run123/);assert.match(text,/v3/);assert.match(text,/q1/);assert.match(text,/В какой системе/)
})
