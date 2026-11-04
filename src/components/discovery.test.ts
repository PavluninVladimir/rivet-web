import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analystName, backlogField, decomposeText, depOptions, droppedSummary, emptyEpic, highlightRange, linkLabel,
  needsByPersona, nextHumanKey, progressPct, progressText, quoteLines, removeEpic, usageText, validateRow, waitingText,
  runIsOlder, withMissing,
} from './discovery.ts'

const run = (over: Record<string, unknown> = {}) => ({
  status: 'running' as const, stage: 'summaries' as const, progress: { done: 2, total: 5 },
  role: { id: 'analyst', title: 'Аналитик' }, agent: { id: 'vera', name: 'Вера' }, ...over,
})

test('ход анализа по этапам', () => {
  assert.equal(progressText(run()), 'Аналитик Вера конспектирует: 2 из 5')
  assert.equal(progressText(run({ stage: 'synthesis' })), 'Аналитик Вера синтезирует результат')
  assert.equal(progressText(run({ status: 'ready', stage: 'done' })), 'готова')
  assert.equal(analystName(run({ agent: null })), 'Аналитик')
  assert.equal(progressPct(run()), 32)
  assert.equal(progressPct(run({ stage: 'synthesis' })), 90)
})

test('стоимость: неизвестная не ноль', () => {
  assert.equal(usageText({ duration_s: 3 }), 'стоимость неизвестна')
  assert.match(usageText({ tokens_in: 1000, tokens_out: 200, cost_usd: 0.036, duration_s: 3 }), /\$0\.04$/)
})

test('потребности по персонам, без персоны в конце', () => {
  const personas = [{ id: 'p1', name: 'Менеджер', description: '', interviews: [] }]
  const needs = [
    { id: 'n1', title: 'a', kind: 'pain' as const, persona: 'p1', importance: 'high' as const, evidence: [] },
    { id: 'n2', title: 'b', kind: 'need' as const, persona: 'p9', importance: 'low' as const, evidence: [] },
  ]
  const g = needsByPersona(personas, needs)
  assert.equal(g.length, 2)
  assert.equal(g[0].needs[0].id, 'n1')
  assert.equal(g[1].persona, null)
})

test('ключ нового Epic’а и удаление со снятием ссылок', () => {
  assert.equal(nextHumanKey([{ key: 'e1' }, { key: 'h2' }, { key: 'h1' }]), 'h3')
  assert.equal(nextHumanKey([]), 'h1')
  const a = { ...emptyEpic('e1') }
  const b = { ...emptyEpic('e2'), depends_on: ['e1'] }
  const out = removeEpic([a, b], 'e1')
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].depends_on, [])
})

test('варианты зависимостей: бэклог и Epic’и проекта без архивных и связанных', () => {
  const backlog = [{ ...emptyEpic('e1'), title: 'Сделки' }, { ...emptyEpic('e2'), existing_epic: 'x2' }]
  const project = [
    { ID: 'x1', Title: 'Контакты', Status: 'done' as const },
    { ID: 'x2', Title: 'Связанный', Status: 'planned' as const },
    { ID: 'x3', Title: 'Старый', Status: 'archived' as const },
  ]
  const opts = depOptions(backlog, 'e2', project).map(o => o.value)
  assert.deepEqual(opts, ['e1', 'x1'])
  // Выбранный архивный Epic не теряется: вариант с пометкой.
  const all = withMissing(depOptions(backlog, 'e2', project), ['x3', 'gone'], project)
  assert.deepEqual(all.map(o => o.value), ['e1', 'x1', 'x3', 'gone'])
  assert.match(all[2].label, /в архиве/)
  assert.match(all[3].label, /не найден/)
})

test('проверка полей строки как на сервере', () => {
  assert.deepEqual(validateRow({ ...emptyEpic('h1'), title: 'A', goal: 'x'.repeat(40) }), {})
  const errs = validateRow({ ...emptyEpic('h1'), goal: 'коротко' })
  assert.equal(errs.title, 'укажите название')
  assert.match(errs.goal ?? '', /не короче 40/)
})

test('поле ошибки API бэклога', () => {
  assert.deepEqual(backlogField('epics[2].depends_on'), { index: 2, field: 'depends_on' })
  assert.deepEqual(backlogField('epics[0]'), { index: 0, field: 'title' })
  assert.equal(backlogField('depends_on'), null)
})

test('декомпозиция, ожидание, отметка связи, отброшенное', () => {
  assert.equal(decomposeText({ status: 'running' }), 'декомпозиция…')
  assert.equal(decomposeText({ status: 'failed', detail: 'план не принят' }), 'план не составлен: план не принят')
  assert.equal(decomposeText(null), '')
  assert.equal(waitingText([{ id: '1', title: 'Сделки и воронка', status: 'running' }]), 'ждёт Epic «Сделки и воронка»')
  assert.match(waitingText([{ id: '1', title: 'Старый', status: 'archived' }]), /в архиве/)
  assert.equal(linkLabel({ existing_epic: null }, []), 'новый')
  assert.equal(linkLabel({ existing_epic: 'x1' }, [{ ID: 'x1', Title: 'Контакты' }]), 'связан с Epic «Контакты»')
  assert.equal(droppedSummary([{ kind: 'quote', ref: 'a', reason: 'r' }, { kind: 'quote', ref: 'b', reason: 'r' }, { kind: 'need', ref: 'c', reason: 'r' }]),
    'цитата 2 · потребность 1')
})

test('подсветка цитаты в тексте интервью', () => {
  const q = { line: 3, text: 'забываю перезвонить' }
  assert.deepEqual(quoteLines(q), { from: 3, to: 3 })
  assert.deepEqual(highlightRange('**Р:** Я забываю перезвонить клиенту', 3, q), [9, 28])
  assert.equal(highlightRange('другая строка', 2, q), null)
  const multi = { line: 5, text: 'конец первой\nначало второй' }
  assert.deepEqual(quoteLines(multi), { from: 5, to: 6 })
  assert.deepEqual(highlightRange('текст конец первой', 5, multi), [6, 18])
  assert.deepEqual(highlightRange('начало второй и дальше', 6, multi), [0, 13])
})

test('версия из ответа сохранения не заменяется отставшим ответом GET', () => {
  const saved = { id: 'r1', backlog_rev: 2, status: 'ready' as const }
  assert.equal(runIsOlder({ id: 'r1', backlog_rev: 1, status: 'ready' }, saved), true)
  assert.equal(runIsOlder({ id: 'r1', backlog_rev: 3, status: 'ready' }, saved), false)
  assert.equal(runIsOlder({ id: 'r1', backlog_rev: 2, status: 'ready' }, { id: 'r1', backlog_rev: 2, status: 'approved' }), true)
  assert.equal(runIsOlder({ id: 'r2', backlog_rev: 1, status: 'running' }, saved), false)
})
