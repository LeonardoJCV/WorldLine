import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Era } from '../../engine/state.ts'
import { WORKS, workIndex } from '../../engine/work.ts'
import { translate } from '../i18n/index.ts'
import type { SimulationState } from '../sim/store.ts'
import type { Snapshot } from '../../worker/protocol.ts'

const present: { value: Snapshot } = {
  value: {
    tick: 1200,
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
    eras: Era.agricultural | Era.classical,
    active: [],
    allocation: { agriculture: 25, industry: 20, research: 25, conservation: 20, works: 10 },
    status: 'running',
    home: null,
    debts: [],
    works: [{ def: workIndex('irrigation'), done: 900, record: 0 }],
    building: { def: workIndex('plough'), progress: 200, since: 1100 },
    rate: 100,
  },
}

// FIX: o painel real sem Worker, como a barra já faz; só o presente muda de um caso para o outro
vi.mock('../sim/runtime.ts', () => ({
  simulation: { getState: () => ({}) },
  useSimulation: (selector: (state: Partial<SimulationState>) => unknown) =>
    selector({ present: present.value }),
}))

const { BuildPanel } = await import('./BuildPanel.tsx')

function render(over: Partial<Snapshot> = {}): string {
  const kept = present.value
  present.value = { ...kept, ...over }
  try {
    return renderToStaticMarkup(createElement(BuildPanel))
  } finally {
    present.value = kept
  }
}

describe('BuildPanel', () => {
  it('names every work in the catalogue, under the era it belongs to', () => {
    const html = render()
    for (const work of WORKS) {
      expect(html, work.id).toContain(translate('en', `work.${work.id}`))
    }
    for (const era of ['Agricultural age', 'Classical age', 'Industrial age', 'Space age']) {
      expect(html).toContain(era)
    }
  })

  it('shows what stands, what is on the site and how far along it is', () => {
    const html = render()
    expect(html).toContain('Standing')
    expect(html).toContain('On the site')
    // FEAT: 200 de 800 já erguidos, e os 600 que faltam a 100 por ano
    expect(html).toContain('25% of it is standing')
    expect(html).toContain('6 years at this pace')
  })

  it('says what a locked work is still waiting for', () => {
    const html = render()
    expect(html).toContain('Needs Writing')
  })

  it('writes a dash, never an infinity, when nothing is allotted to works', () => {
    const html = render({ rate: 0 })
    expect(html).toContain('Nothing is allotted to works')
    expect(html).toContain('—')
    expect(html).not.toContain('Infinity')
    expect(html).not.toContain('∞')
  })

  it('renders what each work changes from the catalogue numbers', () => {
    const html = render()
    // FEAT: irrigação é harvest 1,12 e celeiro é spoil -0,08 — fator em percentagem, termo cru
    expect(html).toContain('Harvest +12%')
    expect(html).toContain('Food spoilage -0.08')
  })
})
