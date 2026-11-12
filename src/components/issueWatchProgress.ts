import type { IssueIntakeConfig, IssueSource } from '../api/client.ts'

// Source state describes this handoff, while linked Epics describe its result.
// A completed Epic remains completed when its research version is superseded.
export function issueSourceProgress(source: IssueSource, config: IssueIntakeConfig) {
  if (['approved', 'superseded'].includes(source.research_status ?? '')
    && source.epics.length > 0 && source.epics.every(epic => epic.status === 'done'))
    return { status: 'Связанная работа завершена', next: 'Результат — в связанных Epic ниже.' }
  switch (source.research_status) {
    case 'running': return { status: 'Аналитик исследует обращение', next: 'Следующий шаг — результат исследования и утверждение бэклога.' }
    case 'ready': return { status: 'Результат исследования ждёт утверждения', next: 'Откройте исследование, чтобы проверить и утвердить бэклог.' }
    case 'approved': return { status: 'Исследование утверждено', next: source.epics.length ? 'Дальнейшая работа — в связанных Epic ниже.' : 'Откройте исследование для просмотра утверждённого бэклога.' }
    case 'superseded': return { status: 'Версия исследования заменена', next: 'Откройте исследование и проверьте актуальную версию.' }
    case 'failed':
      if (source.attempts >= 3) return { status: 'Исследование завершилось ошибкой', next: 'Лимит повторов исчерпан. Откройте исследование.' }
      return { status: 'Исследование завершилось ошибкой', next: handoffNext(config, true) }
    case undefined: case '': return { status: 'Материал принят', next: handoffNext(config, false) }
    default: return { status: source.research_status, next: 'Откройте исследование для проверки состояния.' }
  }
}

function handoffNext(config: IssueIntakeConfig, retry: boolean) {
  if (!config.enabled) return 'Наблюдение выключено; автоматическая передача остановлена. Откройте исследование или включите наблюдение.'
  if (!config.auto_research) return 'Автоматическое исследование выключено. Откройте исследование для запуска.'
  return retry ? 'Ожидает повторной передачи Аналитику.' : 'Ожидает автоматической передачи Аналитику.'
}
