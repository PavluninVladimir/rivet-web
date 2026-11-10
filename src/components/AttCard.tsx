import type { ReactNode } from 'react'

// Карточка эскалации или решения (fix-console-rivetd-tails, спека web
// «Ссылки внутри экранов»): контейнер, а не ссылка или кнопка целиком.
// Переход — ссылка на тексте карточки, растянутая на всю карточку через
// ::after, поэтому щелчок в любом месте карточки открывает экран, а Enter,
// средняя кнопка и новая вкладка работают как у ссылки. «Взять в работу» —
// настоящая кнопка поверх ссылки: интерактивного внутри ссылки нет. Без
// адреса (задача ещё не загрузилась, решение без экрана) текст обычный.
export function AttCard({ href, kind, tid, reason, msg, act }: {
  href?: string; kind?: string; tid?: ReactNode; reason: ReactNode; msg: ReactNode; act: ReactNode
}) {
  return (
    <div className="att-card" data-kind={kind}>
      <div className="att-top">
        {tid != null && <span className="tid mono">{tid}</span>}
        <span className="att-reason">{reason}</span>
      </div>
      {href
        ? <a className="att-msg att-open" href={href}>{msg}</a>
        : <div className="att-msg">{msg}</div>}
      <div className="att-act">{act}</div>
    </div>
  )
}
