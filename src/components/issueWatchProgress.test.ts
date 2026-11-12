import test from 'node:test'
import assert from 'node:assert/strict'
import type { IssueSource } from '../api/client.ts'
import { issueSourceProgress } from './issueWatchProgress.ts'
const config = { enabled: true, auto_research: true, label: 'rivet' }
const source = (patch: Partial<IssueSource> = {}) => ({ epics: [], attempts: 1, ...patch }) as IssueSource

test('completed linked work stays completed when research is superseded', () => {
  const done = { id: 'e', title: 'Result', status: 'done' }
  assert.equal(issueSourceProgress(source({ research_status: 'superseded', epics: [done] }), config).status, 'Связанная работа завершена')
  assert.equal(issueSourceProgress(source({ research_status: 'superseded', epics: [done, { ...done, id: 'e2', status: 'running' }] }), config).status, 'Версия исследования заменена')
  assert.notEqual(issueSourceProgress(source({ research_status: 'superseded' }), config).status, 'Связанная работа завершена')
  for (const research_status of ['running', 'ready', 'failed', ''])
    assert.notEqual(issueSourceProgress(source({ research_status, epics: [done] }), config).status, 'Связанная работа завершена')
})
test('pending and failed sources do not promise automatic handoff when disabled', () => {
  for (const research_status of ['', 'failed']) {
    assert.match(issueSourceProgress(source({ research_status }), { ...config, enabled: false }).next, /передача остановлена/)
    assert.match(issueSourceProgress(source({ research_status }), { ...config, auto_research: false }).next, /исследование выключено/)
  }
  assert.match(issueSourceProgress(source({ research_status: 'failed' }), config).next, /повторной передачи/)
  assert.match(issueSourceProgress(source({ research_status: 'failed', attempts: 3 }), config).next, /Лимит повторов исчерпан/)
})
test('running and approval are real source work even when intake is disabled', () => {
  const disabled = { ...config, enabled: false, auto_research: false }
  assert.equal(issueSourceProgress(source({ research_status: 'running' }), disabled).status, 'Аналитик исследует обращение')
  assert.match(issueSourceProgress(source({ research_status: 'ready' }), disabled).next, /утвердить бэклог/)
})
