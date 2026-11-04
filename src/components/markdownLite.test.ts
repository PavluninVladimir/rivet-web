import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown } from './markdownLite.ts'

test('release notes: заголовки и списки разделов', () => {
  const md = '# Релиз 01234567 · Демо\n\n## Новое\n\n- Воронка продаж (task-7)\n- Импорт\n\n## Исправления\n\n- Список листается (task-9)\n'
  const b = parseMarkdown(md)
  assert.deepEqual(b.map(x => x.t), ['h', 'h', 'ul', 'h', 'ul'])
  assert.equal(b[2].t === 'ul' && b[2].items.length, 2)
})

test('код с ограждением и строчная разметка', () => {
  const b = parseMarkdown('Текст **важно** и `code`\n\n````\nстрока ```\n````\n1. первый\n2. второй')
  assert.equal(b[0].t, 'p')
  assert.deepEqual(b[1], { t: 'code', text: 'строка ```' })
  assert.equal(b[2].t, 'ol')
})

test('ссылки только http(s) и внутренние', () => {
  assert.deepEqual(parseInline('[PR](https://x.test/1)'), [{ t: 'link', v: 'PR', href: 'https://x.test/1' }])
  assert.deepEqual(parseInline('[злая](javascript:alert(1))'), [{ t: 'text', v: 'злая' }, { t: 'text', v: ')' }])
})
