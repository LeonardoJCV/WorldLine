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

  // FIX: depois de uma confluência um work_done registrado pode ficar sem dono; o cartão não pode
  // apontar para nenhuma das obras presentes com confiança — precisa recuar ao texto genérico.
  // (o sentinela em si, passado direto, já é testado em build.test.ts; describe() só chega aqui
  // porque `events[node.record]` existe — node.record nunca é o próprio NEVER)
  it('falls back to the generic text when no work in state claims the record', () => {
    const events: readonly EventRecord[] = [{ event: 'work_done', start: 10, end: 10, causes: [] }]
    const works: readonly Work[] = [
      { def: workIndex('granary'), done: 10, record: NEVER },
      { def: workIndex('irrigation'), done: 20, record: NEVER },
    ]
    const html = render(events, works, 0)
    expect(html).toContain('>Work completed<')
    expect(html).not.toContain('Built:')
  })

  // FEAT: dobradas, as obras não são nomeadas — o cartão diz quantas são e oferece abrir
  it('draws the folded works as one counted line instead of naming any of them', () => {
    const events: readonly EventRecord[] = [
      { event: 'work_done', start: 10, end: 10, causes: [] },
      { event: 'work_done', start: 20, end: 20, causes: [] },
      {
        event: 'space_era',
        start: 30,
        end: null,
        causes: [
          { kind: 'event', record: 0 },
          { kind: 'event', record: 1 },
        ],
      },
    ]
    const works: readonly Work[] = [
      { def: workIndex('granary'), done: 10, record: 0 },
      { def: workIndex('irrigation'), done: 20, record: 1 },
    ]
    const html = render(events, works, 2)
    expect(html).toContain('>2 works, grouped<')
    expect(html).toContain('>show each one<')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Granary')
    expect(html).not.toContain('Irrigation')
  })
})
