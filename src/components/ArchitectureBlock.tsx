import { routeHash, useStore } from '../store'
import { shownSnapshot } from './archModel'
import { ArchErrorText, ArchStatus, DescribeAction } from './ArchitectureParts'
import { Mermaid } from './Mermaid'
import { useArchitecture } from './useArchitecture'

// Блок «Архитектура проекта» в правой колонке дашборда Epic (спека web
// «Архитектура на дашборде Epic»): схема контекста текущего снимка и
// переход к полной архитектуре одним кликом. Без описания — статус задачи
// описания или кнопка. Целевые схемы изменения с подсветкой появятся с
// add-epic-explore: у бэкенда пока нет снимка изменения Epic.
export function ArchitectureBlock({ projectId }: { projectId: string }) {
  const { nav } = useStore()
  const { arch, err, refresh, live } = useArchitecture(projectId)
  const shown = shownSnapshot(arch)
  // Архитектура открывается в проекте Epic'а: проект — часть адреса.
  const target = { view: 'architecture', pid: projectId, tab: 'c4' } as const
  const href = routeHash(target)
  const open = () => nav(target)
  return (
    <section className="arch-block" aria-label="Архитектура проекта">
      <div className="rail-head">
        <h2>Архитектура проекта</h2>
        <a className="arch-open" href={href}>открыть →</a>
      </div>
      <div className="arch-block-body">
        {!arch && <div className="muted">{err || 'Загрузка…'}</div>}
        {arch && shown && (
          <>
            {/* Миниатюра — щелчок мышью вдобавок к ссылке «открыть →» с тем
                же адресом: с клавиатуры и для скринридера есть ссылка, а
                миниатюра из дерева доступности убрана. */}
            <div className="arch-thumb" title="Открыть схемы C4" onClick={open} aria-hidden="true">
              <Mermaid code={shown.data.views.context.mermaid} label={shown.data.views.context.title} zoomable={false} />
            </div>
            <div className="arch-block-note">
              {shown.lastValid ? <><ArchStatus s={arch.status} /> последняя корректная версия</> : <ArchStatus s={arch.status} />}
              <span className="mono muted" title={shown.sha ?? ''}>{shown.sha?.slice(0, 7)}</span>
              <span className="muted">{shown.data.views.context.title}</span>
            </div>
          </>
        )}
        {arch && !shown && (
          arch.status === 'pending'
            ? <div className="muted">Снимок архитектуры строится…</div>
            : <>
              <div className="muted arch-block-note">
                {arch.status === 'absent' ? 'Описания архитектуры в репозитории нет.'
                  : arch.status === 'error' ? <ArchErrorText arch={arch} projectId={projectId} compact />
                  : <><ArchStatus s={arch.status} /> корректного описания нет.</>}
              </div>
              <DescribeAction arch={arch} projectId={projectId} onStarted={refresh} compact />
            </>
        )}
        {arch && !live && <div className="muted arch-block-note">Epic из другого проекта: блок обновится при следующем открытии.</div>}
      </div>
    </section>
  )
}
