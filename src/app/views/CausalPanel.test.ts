import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EventRecord } from '../../engine/events.ts'
import { NEVER } from '../../engine/state.ts'
import { workIndex, type Work } from '../../engine/work.ts'
import type { MessageKey } from '../i18n/en.ts'
import { type Locale, type Params } from '../i18n/index.ts'
import type { SimulationState } from '../sim/store.ts'

const state: {
  events: readonly EventRecord[]
  works: readonly Work[]
  selected: number | null
} = { events: [], works: [], selected: null }
const locale: { value: Locale } = { value: 'en' }

// FIX: o painel real sem Worker; só eventos, obras e o selecionado mudam de um caso para o outro
vi.mock('../sim/runtime.ts', () => ({
  simulation: { getState: () => ({ select: () => {}, setCursor: () => {} }) },
  useSimulation: (selector: (state: Partial<SimulationState>) => unknown) =>
    selector({
      events: state.events,
      present: { works: state.works } as SimulationState['present'],
      selected: state.selected,
    }),
}))

vi.mock('../i18n/index.ts', async () => {
  const real = await vi.importActual<typeof import('../i18n/index.ts')>('../i18n/index.ts')
  return {
    ...real,
    useLocale: () => locale.value,
    useT: () => (key: MessageKey, params?: Params) => real.translate(locale.value, key, params),
  }
})

const { CausalPanel } = await import('./CausalPanel.tsx')

function render(
  events: readonly EventRecord[],
  works: readonly Work[],
  selected: number | null,
): string {
  state.events = events
  state.works = works
  state.selected = selected
  try {
    return renderToStaticMarkup(createElement(CausalPanel))
  } finally {
    state.events = []
    state.works = []
    state.selected = null
  }
}

describe('CausalPanel', () => {
  it('names the work a selected work_done node belongs to', () => {
    const events: readonly EventRecord[] = [{ event: 'work_done', start: 10, end: 10, causes: [] }]
    const works: readonly Work[] = [{ def: workIndex('granary'), done: 10, record: 0 }]
    const html = render(events, works, 0)
    expect(html).toContain('Built: Granary')
  })

  // FIX: duas obras de confluências diferentes partilham o sentinela NEVER; o cartão causal não pode
  // apontar para nenhuma das duas com confiança — precisa recuar ao texto genérico
  it('refuses to name a work that arrived by confluence, instead of naming the wrong one', () => {
    const events: readonly EventRecord[] = [{ event: 'work_done', start: 10, end: 10, causes: [] }]
    const works: readonly Work[] = [
      { def: workIndex('granary'), done: 10, record: NEVER },
      { def: workIndex('irrigation'), done: 20, record: NEVER },
    ]
    const html = render(events, works, 0)
    expect(html).toContain('>Work completed<')
    expect(html).not.toContain('Built:')
  })
})
