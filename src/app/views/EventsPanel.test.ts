import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EventRecord } from '../../engine/events.ts'
import { NEVER } from '../../engine/state.ts'
import { workIndex, type Work } from '../../engine/work.ts'
import type { MessageKey } from '../i18n/en.ts'
import { translate, type Locale, type Params } from '../i18n/index.ts'
import type { SimulationState, WorldView } from '../sim/store.ts'

const state: {
  events: readonly EventRecord[]
  works: readonly Work[]
} = { events: [], works: [] }
const locale: { value: Locale } = { value: 'en' }

const world = {
  info: { id: 'A', parent: null, fork: 0, generation: 0 },
  crossings: [],
} as unknown as WorldView

// FIX: o painel real sem Worker; só eventos, obras e idioma mudam de um caso para o outro
vi.mock('../sim/runtime.ts', () => ({
  simulation: { getState: () => ({ select: () => {}, setCursor: () => {} }) },
  useSimulation: (selector: (state: Partial<SimulationState>) => unknown) =>
    selector({
      events: state.events,
      present: { works: state.works } as SimulationState['present'],
      selected: null,
      worlds: [world],
      focus: 'A',
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

const { EventsPanel } = await import('./EventsPanel.tsx')

function render(events: readonly EventRecord[], works: readonly Work[], at: Locale = 'en'): string {
  state.events = events
  state.works = works
  locale.value = at
  try {
    return renderToStaticMarkup(createElement(EventsPanel))
  } finally {
    state.events = []
    state.works = []
    locale.value = 'en'
  }
}

describe('EventsPanel', () => {
  it('names the work a work_done record belongs to', () => {
    const events: readonly EventRecord[] = [{ event: 'work_done', start: 10, end: 10, causes: [] }]
    const works: readonly Work[] = [{ def: workIndex('granary'), done: 10, record: 0 }]
    const html = render(events, works)
    expect(html).toContain('Built: Granary')
    // FEAT: sem a obra, o painel nunca diria "concluída" sem dizer qual — a frase genérica some
    expect(html).not.toContain('>Work completed<')
  })

  // FIX: depois de uma confluência um work_done já registrado pode ficar sem dono — o Work que o
  // reivindicava passa a carregar NEVER, e é isto que o painel vê: um índice que nenhuma obra tem.
  // (o sentinela em si, passado direto, já é testado em build.test.ts; aqui `row.index` é sempre um
  // índice real, nunca NEVER — o painel nunca lhe passa o sentinela)
  it('falls back to the generic text when no work in state claims the record', () => {
    const events: readonly EventRecord[] = [
      { event: 'work_done', start: 10, end: 10, causes: [] },
      { event: 'work_done', start: 20, end: 20, causes: [] },
    ]
    const works: readonly Work[] = [
      { def: workIndex('granary'), done: 10, record: NEVER },
      { def: workIndex('irrigation'), done: 20, record: NEVER },
    ]
    const html = render(events, works)
    expect(html).toContain('Work completed')
    expect(html).not.toContain('Built: Granary')
    expect(html).not.toContain('Built: Irrigation')
  })

  it('leaves an unrelated event exactly as before', () => {
    const events: readonly EventRecord[] = [{ event: 'famine', start: 5, end: null, causes: [] }]
    const html = render(events, [])
    expect(html).toContain('Famine')
  })

  it('names the work in Portuguese too', () => {
    const events: readonly EventRecord[] = [{ event: 'work_done', start: 10, end: 10, causes: [] }]
    const works: readonly Work[] = [{ def: workIndex('granary'), done: 10, record: 0 }]
    const html = render(events, works, 'pt-BR')
    expect(html).toContain(translate('pt-BR', 'event.work_done.named', { work: 'Celeiro' }))
  })
})
