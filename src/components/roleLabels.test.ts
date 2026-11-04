import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentModelLabel, agentVerdictNote, isAgentWorkEvent, mergeDraft, performerParts, refText, roleColorVar, runnerName, stepVerb, tripleKey, tripleOf, verdictLabel } from './roleLabels.ts'

test('занятость агента: только два события установки', () => {
  assert.equal(isAgentWorkEvent('team.agent_busy'), true)
  assert.equal(isAgentWorkEvent('team.agent_free'), true)
  assert.equal(isAgentWorkEvent('team.agent_updated'), false)
  assert.equal(isAgentWorkEvent('task.assign'), false)
})

test('имя runner’а: отображаемое имя, иначе id', () => {
  assert.equal(runnerName({ ID: 'claude-sonnet-1', DisplayName: 'mac-1' }), 'mac-1')
  assert.equal(runnerName({ ID: 'claude-sonnet-1', DisplayName: '  ' }), 'claude-sonnet-1')
  assert.equal(runnerName(undefined, 'r-9'), 'r-9')
})

test('подпись исполнителя: роль и агент, runner мелко', () => {
  assert.deepEqual(performerParts('Разработчик', 'Макс', 'mac-1'), { main: 'Разработчик Макс', sub: 'mac-1' })
  assert.deepEqual(performerParts('Разработчик', '', 'mac-1'), { main: 'Разработчик', sub: 'mac-1' })
  assert.deepEqual(performerParts(undefined, '', 'claude-sonnet-1'), { main: 'claude-sonnet-1', sub: '' })
  assert.deepEqual(performerParts(undefined, 'Макс', ''), { main: 'Макс', sub: '' })
})

test('глагол по виду шага и входу', () => {
  assert.equal(stepVerb('code', 'ok'), 'пишет код')
  assert.equal(stepVerb('code', 'changes'), 'исправляет')
  assert.equal(stepVerb('test'), 'пишет тесты')
  assert.equal(stepVerb('review'), 'проверяет')
  assert.equal(stepVerb('prompt'), 'выполняет шаг')
  assert.equal(stepVerb('decompose'), 'составляет план')
  assert.equal(stepVerb(''), 'работает')
})

test('цвет роли: токен палитры или приглушённый', () => {
  assert.equal(roleColorVar('indigo'), 'var(--role-indigo)')
  assert.equal(roleColorVar('#ff0000'), 'var(--muted)')
  assert.equal(roleColorVar(undefined), 'var(--muted)')
})

test('тройка модели: ключ туда и обратно, пустая — «как в шаблоне»', () => {
  const t = { agent: 'claude-code', connection_id: 'anthropic', model: 'claude-opus-5' }
  assert.deepEqual(tripleOf(tripleKey(t)), t)
  assert.equal(tripleKey({ agent: '', connection_id: '', model: '' }), '')
  assert.deepEqual(tripleOf(''), { agent: '', connection_id: '', model: '' })
  assert.equal(agentModelLabel({ agent: '', connection_id: '', model: '' }, { agent: '', model: 'sonnet' }), 'sonnet (шаблон)')
  assert.equal(agentModelLabel({ agent: 'claude-code', connection_id: 'a', model: 'opus' }, undefined), 'claude-code / opus')
})

test('ссылки на шаблон по видам', () => {
  assert.equal(refText({ scope: 'project', kind: 'participant', project_name: 'Бюджет', step: 'review' }), 'проект Бюджет, шаг review')
  assert.equal(refText({ scope: 'installation', kind: 'participant', step: 'test' }), 'установка, шаг test')
  assert.equal(refText({ scope: 'project', kind: 'role_model', project_name: 'Бюджет' }), 'проект Бюджет: переопределение модели роли')
  assert.equal(refText({ scope: 'installation', kind: 'agent', agent_name: 'Лев' }), 'агент команды Лев')
})

test('черновик: свои правки поверх актуальной версии, конфликт виден', () => {
  const base = { title: 'Ревьюер', instruction: 'старая', agent: 'a', model: '' }
  const fresh = { ...base, instruction: 'новая' }
  const r1 = mergeDraft(base, fresh, { ...base, title: 'Ревьюер 2' })
  assert.deepEqual(r1.fields, { title: 'Ревьюер 2', instruction: 'новая', agent: 'a', model: '' })
  assert.deepEqual(r1.conflicts, [])
  assert.deepEqual(mergeDraft(base, fresh, { ...base, instruction: 'моя' }).conflicts, ['instruction'])
  assert.deepEqual(mergeDraft(base, fresh, { ...base, instruction: 'новая' }).conflicts, [])
})

test('черновик: профиль и модель сливаются группой', () => {
  const base = { title: 'Р', agent: 'a', model: '' }
  const r = mergeDraft(base, { ...base, agent: 'b' }, { ...base, model: 'conn/m-a' }, [['agent', 'model']])
  assert.deepEqual(r.conflicts, ['agent', 'model'])
  assert.deepEqual(r.fields, { title: 'Р', agent: 'a', model: 'conn/m-a' })
  const r2 = mergeDraft(base, { ...base, agent: 'b', model: 'conn/m-b' }, { ...base, title: 'Р2' }, [['agent', 'model']])
  assert.deepEqual(r2.conflicts, [])
  assert.deepEqual(r2.fields, { title: 'Р2', agent: 'b', model: 'conn/m-b' })
})

test('вердикт тестировщика и проверок: подписи и сбой инфраструктуры', () => {
  assert.equal(agentVerdictNote('ok', 'changes'), 'одобрил, проверки не прошли')
  assert.equal(agentVerdictNote('changes', 'changes'), 'вернул замечания')
  assert.equal(agentVerdictNote('error', 'changes'), 'сбой инфраструктуры')
  assert.equal(agentVerdictNote('ok', 'ok'), '')
  assert.equal(agentVerdictNote(undefined, 'changes'), '')
  assert.equal(verdictLabel('error'), 'сбой инфраструктуры')
  assert.equal(verdictLabel(''), 'ждёт')
  assert.equal(verdictLabel('changes'), 'changes')
})
