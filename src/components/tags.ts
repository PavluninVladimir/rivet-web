// Добавление тегов из черновика поля-тегов. Без split черновик даёт один
// тег (хвостовые запятые срезаются). С split черновик режется на куски, и
// каждый становится отдельным тегом: вставка «local-worker, local-reviewer»
// в поле идентификаторов даёт два тега. Повторы не добавляются.
export function addTags(value: string[], draft: string, split?: RegExp): string[] {
  const parts = split ? draft.split(split) : [draft.trim().replace(/,+$/, '')]
  const out = [...value]
  for (const p of parts.map(x => x.trim()).filter(Boolean)) {
    if (!out.includes(p)) out.push(p)
  }
  return out
}
