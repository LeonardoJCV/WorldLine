import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n/index.ts'
import { MODES, type SimulationState } from '../sim/store.ts'

// FIX: a barra real (não um mundo em memória) evita ligar a um Worker que o Node não sabe abrir
vi.mock('../sim/runtime.ts', () => {
  const state: Partial<SimulationState> = {
    seed: 1,
    now: 0,
    cursor: null,
    playing: false,
    speed: 1,
    ended: null,
    mode: 'observe',
  }
  return {
    simulation: { getState: () => state },
    useSimulation: (selector: (state: Partial<SimulationState>) => unknown) => selector(state),
  }
})

const { TopBar } = await import('./TopBar.tsx')

// FEAT: lê só os botões do grupo de modo, sem depender da marcação ao redor deles
function modeButtonLabels(html: string): readonly string[] {
  const group = /<div class="mode"[^>]*>([\s\S]*?)<\/div>/.exec(html)
  const inner = group?.[1] ?? ''
  return [...inner.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1] ?? '')
}

describe('TopBar', () => {
  it('offers a button for every mode there is, not a hand-copied guess at the list', () => {
    const html = renderToStaticMarkup(createElement(TopBar, { onLeave: () => {} }))
    expect(modeButtonLabels(html)).toEqual(MODES.map((mode) => translate('en', `mode.${mode}`)))
  })
})
