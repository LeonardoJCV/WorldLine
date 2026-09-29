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
    // FEAT: só a linha dobrada é um botão que abre; nenhum outro nó anuncia abrir e fechar
    expect(html).not.toContain('aria-expanded')
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

  // FIX: uma causa pode apontar para um registro que esta história não tem — o sentinela que a
  // confluência deixa, ou um índice fora da fila — e desenhá-la como botão convidava a um clique
  // que zerava o cartão sem mover o ano; a store recusa o índice e o nó deixa de ser botão
  it('draws a cause whose record does not exist as no button at all', () => {
    const events: readonly EventRecord[] = [
      {
        event: 'famine',
        start: 10,
        end: 10,
        causes: [
          { kind: 'event', record: NEVER },
          { kind: 'event', record: 7 },
          // FEAT: uma causa que existe de verdade, senão o portão não sabe distinguir "sem
          // registro" de "não é a raiz", e apagar o botão de toda causa passaria por conserto
          { kind: 'event', record: 1 },
          { kind: 'condition', metric: 'foodSecurity', op: '<', threshold: 1, value: 0.4 },
        ],
      },
      { event: 'golden_age', start: 4, end: 9, causes: [] },
    ]
    const html = render(events, [], 0)
    expect(html).toContain('Unknown event')
    expect(html).toContain('Golden age')
    // FEAT: a raiz e a causa que tem registro são botões; o sentinela, o índice fora da fila e a
    // condição não são
    expect(html.match(/<button/g) ?? []).toHaveLength(2)
    expect(html).toMatch(/<div class="causal__node" data-kind="event"/)
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
