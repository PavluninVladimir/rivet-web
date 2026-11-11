import {test} from 'node:test'
import assert from 'node:assert/strict'
import {localListenURL,parseLocalEnv,publicationActions} from './localDockerLogic.ts'
import type {LocalPublication} from '../api/client.ts'
const p=(status:LocalPublication['status'])=>({status,desired_state:status==='stopped'?'stopped':'running',container_id:'container'}) as LocalPublication

test('активная публикация блокирует повторные действия',()=>{for(const status of ['queued','building','starting','verifying','stopping'] as const){const a=publicationActions(p(status));assert.equal(a.busy,true);assert.equal(a.publish,false);assert.equal(a.restart,false);assert.equal(a.stop,false)}})
test('остановленное окружение публикуется заново, пауза блокирует сборку',()=>{assert.deepEqual(publicationActions(p('stopped')),{busy:false,publish:true,redeploy:false,restart:false,stop:false});assert.equal(publicationActions(p('running'),true).publish,false);assert.equal(publicationActions(p('running'),true).stop,true);assert.equal(publicationActions(p('failed')).redeploy,true)})
test('ссылка открывает только loopback адрес публикации',()=>{assert.equal(localListenURL('127.0.0.1:20123'),'http://127.0.0.1:20123');for(const value of ['0.0.0.0:20123','example.com','javascript:alert(1)','127.0.0.1:20123@evil.test'])assert.equal(localListenURL(value),null)})
test('переменные имеют строковые значения',()=>{assert.deepEqual(parseLocalEnv('{"PORT":"8080"}'),{PORT:'8080'});for(const v of ['[]','null','{"PORT":8080}','{broken'])assert.throws(()=>parseLocalEnv(v))})
