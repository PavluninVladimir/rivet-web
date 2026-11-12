import test from 'node:test'
import assert from 'node:assert/strict'
import type { Task, TeamAgent } from '../api/client.ts'
import { taskWork } from './epicWork.ts'

const task = (patch: Partial<Task> = {}) => ({ ID: 't', EpicID: 'e', Status: 'review', Step: 'review',
  RunnerID: 'historical-coder', WaitReason: '', BlockReason: '', ...patch }) as Task

test('historical coder and developer pin never imply current review work', () => {
  const work = taskWork(task({ DeveloperAgentID: 'eva', DeveloperAgentName: 'Ева' }), [])
  assert.equal(work.assigned, false)
  assert.match(work.label, /Ожидает/)
})

test('current reviewer is active, merge and explicit wait are not', () => {
  const current = task({ AgentID: 'irina', AgentName: 'Ирина', RoleID: 'reviewer', RunnerName: 'current-reviewer' })
  assert.equal(taskWork(current, []).assigned, true)
  assert.equal(taskWork(current, []).runnerName, 'current-reviewer')
  assert.deepEqual([taskWork({ ...current, Step: 'merge' }, []).assigned, taskWork({ ...current, Step: 'merge' }, []).label], [false, 'Ожидает слияния'])
  assert.equal(taskWork({ ...current, WaitReason: 'модель недоступна' }, []).label, 'модель недоступна')
  assert.equal(taskWork({ ...current, WaitReason: 'модель недоступна' }, []).assigned, false)
})

test('human prompt wait and terminal stale metadata do not claim work', () => {
  assert.equal(taskWork(task({ Status: 'running', Step: 'prompt' }), []).assigned, false)
  assert.equal(taskWork(task({ Status: 'running', Step: 'prompt' }), []).label, 'Ожидает участника шага')
  assert.equal(taskWork(task({ Status: 'done', AgentID: 'irina' }), []).assigned, false)
})

test('custom step uses matching current team kind and otherwise keeps its ID', () => {
  const custom = task({ Status: 'testing', Step: 'verify-results', AgentID: 'lev' })
  const agent = { id: 'lev', name: 'Лев', role_id: 'tester', busy: true, task_id: 't', epic_id: 'e', step: 'test' } as TeamAgent
  assert.equal(taskWork(custom, [agent]).label, 'Проверки')
  assert.equal(taskWork(custom, [{ ...agent, task_id: 'other' }]).label, 'verify-results')
})
