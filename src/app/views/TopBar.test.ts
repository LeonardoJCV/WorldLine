import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Era } from '../../engine/state.ts'
import { workIndex } from '../../engine/work.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { translate } from '../i18n/index.ts'
import { MODES, type SimulationState } from '../sim/store.ts'

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1000,
    values: {
      population: 1_000_000,
      food: 200_000,
      energy: 5,
      technology: 40,
      economy: 6,
      environment: 60,
      stability: 70,
    },
    previous: null,
    eras: Era.agricultural,
    active: [],
    allocation: { agriculture: 25, industry: 20, research: 25, conservation: 25, works: 5 },
    status: 'running',
    home: null,
    debts: [],
    works: [],
    building: null,
    rate: 0,
    ...over,
  }
}

// FIX: a barra real (não um mundo em memória) evita ligar a um Worker que o Node não sabe abrir
const present: { value: Snapshot | null } = { value: null }
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
    useSimulation: (selector: (state: Partial<SimulationState>) => unknown) =>
      selector({ ...state, present: present.value }),
  }
})

const { TopBar } = await import('./TopBar.tsx')

function render(over: Partial<Snapshot> | null): string {
  present.value = over === null ? null : snapshot(over)
  try {
    return renderToStaticMarkup(createElement(TopBar, { onLeave: () => {} }))
  } finally {
    present.value = null
  }
}

// FEAT: lê só os botões do grupo de modo, sem depender da marcação ao redor deles
function modeButtonLabels(html: string): readonly string[] {
  const group = /<div class="mode"[^>]*>([\s\S]*?)<\/div>/.exec(html)
  const inner = group?.[1] ?? ''
  return [...inner.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1] ?? '')
}

function buildButton(html: string): string {
  const group = /<div class="mode"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const match = /<button[^>]*>Build(?:<span[^>]*><\/span>)?<\/button>/.exec(group)
  if (match === null) throw new Error('no Build button in the mode group')
  return match[0]
}

describe('TopBar', () => {
  it('offers a button for every mode there is, not a hand-copied guess at the list', () => {
    const html = render(null)
    expect(modeButtonLabels(html)).toEqual(MODES.map((mode) => translate('en', `mode.${mode}`)))
  })

  // FEAT: canteiro livre e algo ao alcance — as mesmas duas condições que build.test.ts prova na
  // função pura, aqui vistas do lado de fora, através do próprio botão que o jogador vê
  it('marks the Build button when the yard is free and something can be started', () => {
    const html = render({ works: [] })
    expect(buildButton(html)).toContain('mode__ready')
  })

  it('leaves the Build button unmarked before any era has opened', () => {
    const html = render({ eras: 0 })
    expect(buildButton(html)).not.toContain('mode__ready')
  })

  it('leaves the Build button unmarked while the yard is busy', () => {
    const html = render({
      building: { def: workIndex('irrigation'), progress: 10, since: 900 },
    })
    expect(buildButton(html)).not.toContain('mode__ready')
  })
})
