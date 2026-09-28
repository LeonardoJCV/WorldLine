import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MODES, type Mode } from '../sim/store.ts'
import type { PanelId } from './hud.ts'

// FIX: cada painel tem teste próprio para o que mostra; aqui só importa se o cartão certo aparece
vi.mock('./AllocationPanel.tsx', () => ({ AllocationPanel: () => null }))
vi.mock('./CrossPanel.tsx', () => ({ CrossPanel: () => null }))
vi.mock('./MergePanel.tsx', () => ({ MergePanel: () => null }))

const { ModePanels } = await import('./ModePanels.tsx')

// FEAT: um `Record` sobre Mode, não um `Partial`: um sexto modo sem entrada aqui não compila
const PANEL_FOR: Readonly<Record<Mode, PanelId | null>> = {
  observe: null,
  intervene: 'allocation',
  cross: 'cross',
  merge: 'merge',
  build: 'build',
}

describe('ModePanels', () => {
  for (const mode of MODES) {
    const panel = PANEL_FOR[mode]
    it(
      panel === null
        ? `shows nothing for ${mode}, the mode that has no panel of its own`
        : `renders the real ${panel} card for ${mode} mode`,
      () => {
        const html = renderToStaticMarkup(
          createElement(ModePanels, { mode, worldFocus: 'A', remount: 'k' }),
        )
        if (panel === null) expect(html).toBe('')
        else expect(html).toContain(`card card--${panel}`)
      },
    )
  }
})
