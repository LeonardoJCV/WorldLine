import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Era } from '../../engine/state.ts'
import { PRESENTATION_ORDER, WORKS, workIndex } from '../../engine/work.ts'
import type { MessageKey } from '../i18n/en.ts'
import { eraKey } from '../i18n/format.ts'
import { translate, type Locale, type Params } from '../i18n/index.ts'
import { ERAS, effectsOf } from './build.ts'
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

const locale: { value: Locale } = { value: 'en' }

// FIX: o painel real sem Worker, como a barra já faz; só o presente muda de um caso para o outro
vi.mock('../sim/runtime.ts', () => ({
  simulation: { getState: () => ({}) },
  useSimulation: (selector: (state: Partial<SimulationState>) => unknown) =>
    selector({ present: present.value }),
}))

// FIX: em render de servidor o `useStore` do zustand lê o estado INICIAL da store, então trocar o
// idioma pela store não mudaria nada aqui; o dicionário é o de verdade, só a escolha vem do teste
vi.mock('../i18n/index.ts', async () => {
  const real = await vi.importActual<typeof import('../i18n/index.ts')>('../i18n/index.ts')
  return {
    ...real,
    useLocale: () => locale.value,
    useT: () => (key: MessageKey, params?: Params) => real.translate(locale.value, key, params),
  }
})

const { BuildPanel } = await import('./BuildPanel.tsx')

function render(over: Partial<Snapshot> = {}, at: Locale = 'en'): string {
  const kept = present.value
  present.value = { ...kept, ...over }
  locale.value = at
  try {
    return renderToStaticMarkup(createElement(BuildPanel))
  } finally {
    present.value = kept
    locale.value = 'en'
  }
}

// FEAT: um bloco por era, com o texto do cabeçalho e os nomes que estão DENTRO da lista dele — é o
// que separa "os nomes e as eras estão na página" de "cada obra está sob a era dela"
function eraBlocks(html: string): readonly { readonly head: string; readonly names: string[] }[] {
  return html
    .split('<section class="build__era"')
    .slice(1)
    .map((chunk) => {
      const list = /<ul class="build__list">([\s\S]*?)<\/ul>/.exec(chunk)?.[1] ?? ''
      return {
        head: (/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(chunk)?.[1] ?? '').replace(/<[^>]*>/g, ''),
        names: [...list.matchAll(/<span class="build__name">([\s\S]*?)<\/span>/g)].map(
          (match) => match[1] ?? '',
        ),
      }
    })
}

describe('BuildPanel', () => {
  it('renders each of the five eras, and every work inside the era it belongs to', () => {
    const blocks = eraBlocks(render())
    expect(blocks).toHaveLength(ERAS.length)
    for (const [at, era] of ERAS.entries()) {
      const block = blocks[at]
      if (block === undefined) throw new Error(`no block for era ${era}`)
      expect(block.head, String(era)).toContain(translate('en', eraKey(era)))
      // FEAT: a lista esperada sai de PRESENTATION_ORDER, então ela fixa o grupo E a ordem dentro dele
      const expected = PRESENTATION_ORDER.flatMap((def) => {
        const work = WORKS[def]
        return work !== undefined && work.era === era ? [translate('en', `work.${work.id}`)] : []
      })
      expect(block.names, String(era)).toEqual(expected)
    }
    expect(blocks.flatMap((block) => block.names)).toHaveLength(WORKS.length)
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

  it('says what the rocket opens, because its effect is empty by design', () => {
    const html = render({ eras: Era.space })
    expect(effectsOf(workIndex('rocket'))).toEqual([])
    expect(html).toContain('lets this history settle another world')
    expect(html).not.toContain('Changes nothing on its own')
  })

  it('stops repeating "out of reach" on every row of an era that is out of reach', () => {
    const blocks = render().split('<section class="build__era"').slice(1)
    const industrial = blocks[2]
    const classical = blocks[1]
    if (industrial === undefined || classical === undefined) throw new Error('no era blocks')
    expect(industrial).toContain('Not within reach yet')
    expect(industrial).not.toContain('Out of reach')
    expect(industrial).not.toContain('Needs ')
    // FEAT: na era aberta o que falta é acionável, e continua dito obra por obra
    expect(classical).toContain('Out of reach')
    expect(classical).toContain('Needs Writing')
  })

  it('renders the same catalogue in Portuguese, with Portuguese numbers', () => {
    const html = render({}, 'pt-BR')
    for (const work of WORKS) {
      expect(html, work.id).toContain(translate('pt-BR', `work.${work.id}`))
    }
    for (const era of ERAS) expect(html).toContain(translate('pt-BR', eraKey(era)))
    // FEAT: a vírgula do termo e o "mil" do prazo são o que um formatador preso em 'en' não produz
    // (o espaço antes de "mil" é inquebrável, como o teste do formato compacto em i18n.test.ts já viu)
    expect(html).toContain('Perda de comida -0,08')
    expect(html).toMatch(/4,6\s?mil anos neste ritmo/u)
    expect(html).toContain('25% dela já está de pé')
    expect(html).toContain('Precisa de Escrita')
    expect(html).not.toContain('Harvest')
    expect(html).toContain('Comissionar Celeiro')
    // FIX: a troca é dita só depois de um clique confirmar; o primeiro render nunca a antecipa
    expect(html).not.toContain('substituiria')
  })

  it('offers a way to commission every work within reach, named for the work it starts', () => {
    const html = render()
    expect(html).toContain('aria-label="Commission Granary"')
    expect(html).toContain('aria-label="Commission Pottery"')
    // FEAT: a obra no canteiro e as já de pé não oferecem o gesto de novo
    expect(html).not.toContain('aria-label="Commission Plough"')
    expect(html).not.toContain('aria-label="Commission Irrigation"')
  })

  // FIX: a troca é a única que pede confirmação, e o primeiro render nunca a adianta — o texto real
  // (quem substitui quem e quantos anos) é provado à parte, em build.test.ts, sem depender de um clique
  it('keeps the replace warning behind a confirm click, on every open work, not just one', () => {
    const html = render()
    expect(html).not.toContain('would replace')
    expect(html).toContain('aria-label="Commission Granary"')
    expect(html).toContain('aria-label="Commission Pottery"')
  })

  it('says nothing about replacing when the yard is empty', () => {
    const html = render({ building: null })
    expect(html).toContain('Commission')
    expect(html).not.toContain('would replace')
  })
})
