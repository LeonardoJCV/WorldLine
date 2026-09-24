import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  const card = useRef<HTMLElement>(null)
  const [mounted, setMounted] = useState(!collapsed)

  // FEAT: aberto, o conteúdo volta ao DOM no mesmo quadro em que a pista de grade cresce
  if (!collapsed && !mounted) setMounted(true)

  useEffect(() => {
    if (!collapsed) return
    // FEAT: encolhido, o conteúdo fica montado enquanto a altura anima e sai do DOM quando o CSS termina
    const node = card.current
    const seconds = node ? Number.parseFloat(getComputedStyle(node).transitionDuration) : 0
    const ms = Number.isFinite(seconds) ? seconds * 1000 : 0
    const timer = window.setTimeout(() => setMounted(false), ms)
    return () => window.clearTimeout(timer)
  }, [collapsed])

  return (
    // FIX: o cartão ganha nome acessível do próprio título, e é grupo em vez de região para não encher a lista de marcos
    <section
      ref={card}
      className={`card card--${id}`}
      role="group"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-labelledby={`card-${id}-name`}
    >
      <h2 className="card__title">
        <button
          type="button"
          className="card__toggle"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'hud.expand' : 'hud.collapse', { panel: title })}
          onClick={() => hudStore.getState().toggle(id)}
        >
          <span className="card__mark" aria-hidden="true" />
          <span id={`card-${id}-name`}>{title}</span>
        </button>
      </h2>
      {mounted && children}
    </section>
  )
}
