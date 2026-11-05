import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineText, linkKind, parseInline, parseMarkdown } from './mdParse.ts'

test('HLD: комментарий генератора убран, заголовки, таблица и mermaid', () => {
  const md = [
    '<!-- Сгенерировано командой rivet architecture views. -->',
    '',
    '# HLD: CRM',
    '',
    'Обзор. Подробности в [C4-схемах](c4/context.md).',
    '',
    '| Принцип | Формулировка |',
    '|---|---|',
    '| `p.simple` | Просто \\| понятно |',
    '',
    '```mermaid',
    'C4Context',
    '  title Контекст',
    '```',
  ].join('\n')
  const b = parseMarkdown(md)
  assert.deepEqual(b.map(x => x.t), ['h', 'p', 'table', 'code'])
  assert.equal(b[0].t === 'h' && b[0].level, 1)
  const t = b[2]
  assert.ok(t.t === 'table')
  assert.equal(t.rows.length, 1)
  assert.deepEqual(t.rows[0][0], [{ t: 'code', v: 'p.simple' }])
  assert.equal(inlineText(t.rows[0][1]), 'Просто | понятно')
  const c = b[3]
  assert.ok(c.t === 'code')
  assert.equal(c.lang, 'mermaid')
  assert.equal(c.v, 'C4Context\n  title Контекст\n')
})

test('HTML в тексте остаётся текстом', () => {
  const b = parseMarkdown('Текст <script>alert(1)</script> и <img src=x onerror=alert(1)>')
  assert.equal(b.length, 1)
  assert.ok(b[0].t === 'p')
  assert.equal(inlineText(b[0].c), 'Текст <script>alert(1)</script> и <img src=x onerror=alert(1)>')
  assert.ok(b[0].c.every(x => x.t === 'text'))
})

test('списки с вложенностью и продолжением, цитата, разделитель', () => {
  const b = parseMarkdown('- один\n  продолжение\n  - вложенный\n- два\n\n1. первый\n2. второй\n\n> цитата\n> дальше\n\n---\n')
  assert.deepEqual(b.map(x => x.t), ['list', 'list', 'quote', 'hr'])
  const l = b[0]
  assert.ok(l.t === 'list' && !l.ordered)
  assert.deepEqual(l.items.map(i => [i.depth, inlineText(i.c)]), [[0, 'один продолжение'], [1, 'вложенный'], [0, 'два']])
  assert.ok(b[1].t === 'list' && b[1].ordered)
  assert.ok(b[2].t === 'quote' && inlineText(b[2].c) === 'цитата дальше')
})

test('строчная разметка: код, жирный, курсив, ссылки, snake_case', () => {
  assert.deepEqual(parseInline('**Решение**: хранить в *JSON* `data.json`'), [
    { t: 'strong', c: [{ t: 'text', v: 'Решение' }] },
    { t: 'text', v: ': хранить в ' },
    { t: 'em', c: [{ t: 'text', v: 'JSON' }] },
    { t: 'text', v: ' ' },
    { t: 'code', v: 'data.json' },
  ])
  assert.deepEqual(parseInline('поле company_id и user_name'), [{ t: 'text', v: 'поле company_id и user_name' }])
  const l = parseInline('см. [ADR 1](../adr/0001-json.md) и https://example.com/x.')
  assert.deepEqual(l[1], { t: 'link', href: '../adr/0001-json.md', c: [{ t: 'text', v: 'ADR 1' }] })
  assert.deepEqual(l[3], { t: 'link', href: 'https://example.com/x', c: [{ t: 'text', v: 'https://example.com/x' }] })
  assert.equal(inlineText(parseInline('a \\*b\\* c')), 'a *b* c')
})

test('ссылки: внешние только http(s) и mailto, опасные схемы — текст', () => {
  assert.equal(linkKind('https://github.com/x'), 'external')
  assert.equal(linkKind('mailto:a@b.c'), 'external')
  assert.equal(linkKind('c4/context.md'), 'relative')
  assert.equal(linkKind('../adr/1.md'), 'relative')
  assert.equal(linkKind('javascript:alert(1)'), 'unsafe')
  assert.equal(linkKind(' JavaScript:alert(1)'), 'unsafe')
  assert.equal(linkKind('data:text/html,x'), 'unsafe')
  assert.equal(linkKind('//evil.example'), 'unsafe')
})

test('незакрытый блок кода не теряет текст', () => {
  const b = parseMarkdown('```\nкод без конца')
  assert.deepEqual(b, [{ t: 'code', lang: '', v: 'код без конца\n' }])
})

test('заголовок: завершающие решётки сняты, C# цел, длинная строка пробелов не вешает разбор', () => {
  const h = (md: string) => { const b = parseMarkdown(md)[0]; return b.t === 'h' ? inlineText(b.c) : null }
  assert.equal(h('## Решение ##'), 'Решение')
  assert.equal(h('# Язык C#'), 'Язык C#')
  assert.equal(h('###'), null)
  const t0 = Date.now()
  const b = parseMarkdown('# a' + ' '.repeat(20000) + 'x\n' + '# b' + ' '.repeat(20000))
  assert.ok(Date.now() - t0 < 500, `разбор занял ${Date.now() - t0} мс`)
  assert.equal(b.length, 2)
})

test('глубокая вложенность ссылок не переполняет стек, глубже лимита — текст', () => {
  // 6000 уровней длиннее лимита строки: текстом целиком, без рекурсии.
  const huge = '['.repeat(6000) + 'x' + '](y)'.repeat(6000)
  const h = parseMarkdown(huge)
  assert.ok(h[0].t === 'p' && h[0].c.length === 1 && h[0].c[0].t === 'text')
  // 3000 уровней в пределах лимита: 32 уровня ссылок, глубже текст.
  const md = '['.repeat(3000) + 'x' + '](y)'.repeat(3000)
  const b = parseMarkdown(md)
  assert.ok(b[0].t === 'p')
  let depth = 0
  let cur = b[0].c
  while (cur.length && cur[0].t === 'link') { depth++; cur = (cur[0] as { c: typeof cur }).c }
  assert.equal(depth, 32)
  assert.ok(inlineText(b[0].c).includes('x'))
})

test('разбор линеен на длинных строках: ограждение, скобки, бэктики, разделитель таблицы', () => {
  const N = 20000
  const cases = [
    '```' + ' '.repeat(N) + '!',
    '['.repeat(N),
    '`'.repeat(N) + 'x' + '``'.repeat(10),
    '| a |\n|' + ' '.repeat(N) + '-',
    '[a](' + 'x'.repeat(N),
    'http://a '.repeat(N / 9),
    '`a'.repeat(N / 2),
  ]
  for (const c of cases) {
    const t0 = Date.now()
    parseMarkdown(c)
    assert.ok(Date.now() - t0 < 300, `${JSON.stringify(c.slice(0, 12))}: ${Date.now() - t0} мс`)
  }
  // Длиннее лимита — текстом без разметки.
  const long = '**a** '.repeat(4000)
  const b = parseMarkdown(long)
  assert.ok(b[0].t === 'p' && b[0].c.length === 1 && b[0].c[0].t === 'text')
})

test('бэктики: серия без пары остаётся текстом, пара той же длины — код', () => {
  assert.deepEqual(parseInline('``a` b``'), [{ t: 'code', v: 'a` b' }])
  assert.deepEqual(parseInline('```x'), [{ t: 'text', v: '```x' }])
  assert.deepEqual(parseInline('a ` b ` c'), [{ t: 'text', v: 'a ' }, { t: 'code', v: 'b' }, { t: 'text', v: ' c' }])
})
