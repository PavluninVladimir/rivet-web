import type { Overrides, Presets, ProcessDoc, ProcessLocks } from '../api/client'

// Процесс по умолчанию и ограничения в пресетах установки: чистые функции
// без React, чтобы проверяться юнит-тестом.

// Ограничения без пустых ключей: снятое ограничение исчезает из объекта,
// а пустой объект становится null.
export function cleanLocks(l: ProcessLocks): ProcessLocks | null {
  const clean: ProcessLocks = {}
  if (l.required_kinds?.length) clean.required_kinds = l.required_kinds
  if (l.min_participants && Object.keys(l.min_participants).length) clean.min_participants = l.min_participants
  if (l.human_review) clean.human_review = true
  return Object.keys(clean).length ? clean : null
}

// Новые ограничения не трогают процесс. Без явного процесса (null или нет
// ключа) действует встроенный процесс по умолчанию: только к нему сервер
// применяет tester_agent, и только так до установки доходят будущие правки
// встроенного процесса. Показанный в редакторе процесс по умолчанию
// поэтому не должен становиться явным.
export function withLocks(p: Presets, l: ProcessLocks): Presets {
  return { ...p, process_locks: cleanLocks(l) }
}

// Правка графа делает процесс установки явным.
export function withProcess(p: Presets, doc: ProcessDoc): Presets {
  return { ...p, process: doc }
}

// Возврат к встроенному процессу: явный процесс снимается, ограничения
// остаются.
export function withDefaultProcess(p: Presets): Presets {
  return { ...p, process: null }
}

// Колбэки секции процесса для панели политик установки: update получает
// правку пресетов. Связка вынесена сюда, чтобы тест ловил и её, а не только
// чистые функции.
export function processHandlers(update: (edit: (p: Presets) => Presets) => void): {
  onProcessChange: (doc: ProcessDoc) => void
  onLocksChange: (locks: ProcessLocks) => void
  onResetProcess: () => void
} {
  return {
    onProcessChange: doc => update(p => withProcess(p, doc)),
    onLocksChange: locks => update(p => withLocks(p, locks)),
    onResetProcess: () => update(withDefaultProcess),
  }
}

// Тело PUT политики проекта при правке процесса. Сервер заменяет
// переопределения проекта целиком тем, что пришло (кроме ключа process),
// поэтому процесс отправляется вместе с текущими переопределениями: иначе
// сохранение графа молча стирало бы бюджеты, авто-merge, модели ролей и
// прочие настройки проекта. process: null возвращает процесс установки.
export function withProjectProcess(current: Overrides, process: ProcessDoc | null): Overrides {
  return { ...current, process }
}
