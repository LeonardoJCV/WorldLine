import type { ReactNode } from 'react'
import { useT } from '../i18n/index.ts'
import type { PanelId } from './hud.ts'
import { hudStore, useCollapsed } from './hudStore.ts'

export function PanelCard({
  id,
  title,
  children,
}: {
  readonly id: PanelId
  readonly title: string
  readonly children: ReactNode
}) {
  const t = useT()
  const collapsed = useCollapsed(id)

  return (
    <section className={`card card--${id}`} data-collapsed={collapsed ? 'true' : 'false'}>
      <h2 className="card__title">
        <button
          type="button"
          className="card__toggle"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'hud.expand' : 'hud.collapse', { panel: title })}
          onClick={() => hudStore.getState().toggle(id)}
        >
          <span className="card__mark" aria-hidden="true" />
          {title}
        </button>
      </h2>
      {/* FEAT: encolhido, o conteúdo sai do DOM: some do foco e da leitura, e devolve o espaço ao palco */}
      {!collapsed && children}
    </section>
  )
}
