import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTION_LABEL, projectEvidenceHref } from './assistantLogic.ts'
test('evidence is internal and project scoped',()=>{
 assert.equal(projectEvidenceHref('#/p/a/tasks','a'),'#/p/a/tasks')
 for(const url of ['javascript:alert(1)','https://evil.test/#/p/a/tasks','#/p/b/tasks','//evil.test','#/p/a/\\evil','#/p/a/\nscript'])assert.equal(projectEvidenceHref(url,'a'),null)
})
test('action acceptance is distinct from completing product task',()=>{
 assert.equal(ACTION_LABEL.succeeded,'Действие принято');assert.equal(ACTION_LABEL.unknown,'Результат неизвестен');assert.equal(ACTION_LABEL.requires_human,'Нужно решение человека')
})
