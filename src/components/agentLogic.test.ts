import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentNetworkOpen, agentRunnerStats, dropOverride, fieldShown, isDeployRunner, limitsDraft, parseLimits, parseTokens, presetConnectionId, presetForSave, presetInUse, refKey, refOf, staleOverrides } from './agentLogic.ts'

test('runner выкатки и сеть команд агента', () => {
  assert.equal(isDeployRunner({ Agent: '' }), true)
  assert.equal(isDeployRunner({ Agent: 'rivet' }), false)
  assert.equal(agentNetworkOpen({ Agent: 'rivet', NetworkIsolated: false }), true)
  assert.equal(agentNetworkOpen({ Agent: 'rivet' }), true, 'старый бэкенд без поля — сеть открыта')
  assert.equal(agentNetworkOpen({ Agent: 'rivet', NetworkIsolated: true }), false)
  assert.equal(agentNetworkOpen({ Agent: '', NetworkIsolated: false }), false, 'у runner’а выкатки агента нет')
})

test('счётчики runner’ов агента Rivet', () => {
  const s = agentRunnerStats([
    { Agent: 'rivet', Status: 'idle', NetworkIsolated: true },
    { Agent: 'rivet', Status: 'offline', NetworkIsolated: true },
    { Agent: 'rivet', Status: 'running', NetworkIsolated: false },
    { Agent: '', Status: 'idle', NetworkIsolated: false },
    { Agent: 'legacy', Status: 'offline', NetworkIsolated: false },
  ])
  assert.deepEqual(s, { total: 3, online: 2, isolated: 2, deploy: 1 })
  assert.deepEqual(agentRunnerStats([]), { total: 0, online: 0, isolated: 0, deploy: 0 })
})

test('лимиты: пусто — по умолчанию, только целые больше нуля', () => {
  assert.deepEqual(limitsDraft({ max_turns: 40, max_minutes: 15 }), { turns: '40', tokens: '', minutes: '15' })
  assert.deepEqual(limitsDraft(undefined), { turns: '', tokens: '', minutes: '' })
  assert.deepEqual(parseLimits({ turns: '40', tokens: ' 2 000 000 ', minutes: '' }), { limits: { max_turns: 40, max_tokens: 2_000_000 }, errors: {} })
  const bad = parseLimits({ turns: '0', tokens: '1.5', minutes: '-3' })
  assert.deepEqual(bad.limits, {})
  assert.deepEqual(Object.keys(bad.errors).sort(), ['minutes', 'tokens', 'turns'])
})

test('пара модели: ключ туда и обратно, «/» в имени модели', () => {
  const m = { connection_id: 'openrouter', model: 'anthropic/claude-sonnet' }
  assert.equal(refKey(m), 'openrouter/anthropic/claude-sonnet')
  assert.deepEqual(refOf(refKey(m)), m)
  assert.equal(refOf(''), null)
  assert.equal(refOf('/model'), null)
  assert.equal(refOf('conn/'), null)
})

test('пресет подключения: свободный идентификатор и признак «подключено»', () => {
  assert.equal(presetConnectionId({ id: 'deepseek' }, []), 'deepseek')
  assert.equal(presetConnectionId({ id: 'deepseek' }, ['deepseek', 'deepseek-2']), 'deepseek-3')
  assert.equal(presetInUse({ base_url: 'http://localhost:1234/v1' }, [{ base_url: 'http://LOCALHOST:1234/v1/' }]), true)
  assert.equal(presetInUse({ base_url: 'https://api.deepseek.com' }, [{ base_url: 'https://api.openai.com/v1' }]), false)
})

test('пресет уходит серверу только со своим типом API и адресом', () => {
  const deepseek = { id: 'deepseek', api: 'openai' as const, base_url: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-flash' }] }
  assert.equal(presetForSave(deepseek, { api: 'openai', base_url: 'https://api.deepseek.com/' }), 'deepseek')
  assert.equal(presetForSave(deepseek, { api: 'openai', base_url: 'http://localhost:8283/v1' }), undefined, 'модели DeepSeek не приклеиваются к другому адресу')
  assert.equal(presetForSave(deepseek, { api: 'anthropic', base_url: 'https://api.deepseek.com' }), undefined)
  const ollama = { id: 'ollama', api: 'openai' as const, base_url: 'http://localhost:11434/v1', models: [] }
  assert.equal(presetForSave(ollama, { api: 'openai', base_url: 'http://gpu-box:11434/v1' }), 'ollama', 'у пресета без моделей адрес можно менять')
})

test('токены каталога моделей: целое больше нуля или пусто', () => {
  assert.deepEqual(parseTokens(''), {})
  assert.deepEqual(parseTokens(' 32 768 '), { value: 32768 })
  assert.ok(parseTokens('0').error)
  assert.ok(parseTokens('1.5').error)
  assert.ok(parseTokens('-1').error)
})

test('ошибка поля: нарисованное поле, вложенное или общая заметка', () => {
  const shown = ['default_model', 'secrets', 'limits']
  assert.equal(fieldShown('limits', shown), true)
  assert.equal(fieldShown('limits.max_turns', shown), true)
  assert.equal(fieldShown('models[0].id', ['models']), true)
  assert.equal(fieldShown('adapter', shown), false, 'поля нет в форме — общая заметка')
  assert.equal(fieldShown('limitsx', shown), false)
  assert.equal(fieldShown(undefined, shown), false)
})

test('устаревшие переопределения: агент вне каталога и роль без строки', () => {
  const ov = {
    agent_models: { 'claude-code': { connection_id: 'anthropic', model: 'claude-sonnet' }, rivet: { connection_id: 'e2e-llm', model: 'fake-small' } },
    role_models: { tester: { agent: 'rivet', connection_id: 'e2e-llm', model: 'fake-small' }, old: { agent: 'claude-code', connection_id: 'a', model: 'b' } },
  }
  const agents = { rivet: { models: [{}] } }
  const stale = staleOverrides(ov, agents, ['tester'])
  assert.deepEqual(stale.map(s => s.path), ['agent_models.claude-code', 'role_models.old'])
  assert.equal(stale[0].value, 'anthropic/claude-sonnet')
  assert.match(stale[0].reason, /нет в каталоге/)
  assert.deepEqual(stale.map(s => s.blocking), [true, true])
  // Пока роли грузятся или выбор моделей не загрузился, роли не проверяются.
  assert.deepEqual(staleOverrides(ov, agents, null).map(s => s.path), ['agent_models.claude-code'])
  // Агент есть, но моделей нет: переопределение тоже не рисуется.
  const noModels = staleOverrides({ agent_models: { rivet: ov.agent_models.rivet } }, { rivet: { models: [] } }, null)
  assert.match(noModels[0].reason, /нет моделей/)
  assert.equal(noModels[0].blocking, true)
  // Агент Rivet выключен: в каталоге политики его нет, но сервер
  // переопределение принимает — оно видно без блокировки, не как удалённый агент.
  const disabled = staleOverrides({ agent_models: { rivet: ov.agent_models.rivet } }, {}, null)
  assert.deepEqual(disabled.map(s => [s.path, s.blocking]), [['agent_models.rivet', false]])
  assert.match(disabled[0].reason, /выключен/)
  assert.doesNotMatch(disabled[0].reason, /нет в каталоге/)
  assert.deepEqual(staleOverrides({}, undefined, []), [])

  const dropped = dropOverride(ov, stale[0])
  assert.deepEqual(Object.keys(dropped.agent_models ?? {}), ['rivet'])
  assert.equal(ov.agent_models['claude-code'].model, 'claude-sonnet', 'исходные переопределения не меняются')
  assert.equal(dropOverride({ role_models: { old: ov.role_models.old } }, stale[1]).role_models, null, 'пустой словарь — null')
})
