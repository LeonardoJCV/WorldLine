import { describe, expect, it } from 'vitest'
import { EVENTS, EVENT_IDS } from '../../engine/events.ts'
import { Era, type EraValue } from '../../engine/state.ts'
import { FACTOR_KEYS, TERM_KEYS, WORKS, type WorkKey } from '../../engine/work.ts'
import { en } from './en.ts'
import {
  embedLabel,
  eraKey,
  formatChange,
  formatCompact,
  formatComparison,
  formatCondition,
  formatDecimal,
  formatMetric,
  formatPercent,
  formatVariable,
  formatYear,
  metricKey,
  workKey,
} from './format.ts'
import { detectLocale, translate } from './index.ts'
import { ptBR } from './pt-BR.ts'

// FEAT: o rótulo esperado de cada coeficiente, escrito à mão nos dois idiomas — é a única coisa que
// prova que a junção aponta para o nome certo e não só para um nome que existe
const EFFECT_LABELS: Readonly<Record<WorkKey, readonly [string, string]>> = {
  harvest: ['Harvest', 'Colheita'],
  production: ['Production', 'Produção'],
  research: ['Research', 'Pesquisa'],
  energy: ['Energy', 'Energia'],
  economy: ['Economy', 'Economia'],
  capacity: ['Carrying capacity', 'Capacidade de suporte'],
  colonyCost: ['Colony upkeep', 'Manutenção das colônias'],
  smoke: ['Pollution', 'Poluição'],
  mortality: ['Mortality rate', 'Taxa de mortalidade'],
  spoil: ['Food spoilage', 'Perda de comida'],
  harvestNoise: ['Harvest variance', 'Variação das safras'],
  pollution: ['Extra pollution', 'Poluição extra'],
}

const ERA_LABELS: Readonly<Record<EraValue, readonly [string, string]>> = {
  [Era.agricultural]: ['Agricultural age', 'Era agrícola'],
  [Era.classical]: ['Classical age', 'Era clássica'],
  [Era.industrial]: ['Industrial age', 'Era industrial'],
  [Era.electric]: ['Electric age', 'Era elétrica'],
  [Era.space]: ['Space age', 'Era espacial'],
}

const values = {
  population: 4_200_000,
  food: 900_000,
  energy: 3.456,
  technology: 57.4,
  economy: 6.12,
  environment: 88.6,
  stability: 71.2,
}

describe('dictionaries', () => {
  it('translate every key in both languages', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort())
    for (const text of [...Object.values(en), ...Object.values(ptBR)])
      expect(text.trim()).not.toBe('')
  })

  // FIX: paridade de chaves não é paridade de parâmetros — soltar {survivor} da frase da comida em
  // pt-BR deixava a suíte verde, e a tradução passava a esconder de quem era o número
  it('fills the same named parameters in both languages, key by key', () => {
    const named = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((hit) => hit[1]).sort()
    const keys = Object.keys(en) as (keyof typeof en)[]
    const parameterised = keys.filter((key) => named(en[key]).length > 0)
    // FEAT: sem uma frase parametrizada na lista o portão passaria de graça
    expect(parameterised.length).toBeGreaterThan(20)
    for (const key of keys) {
      expect(named(ptBR[key]), key).toEqual(named(en[key]))
    }
  })

  // FEAT: a cobertura por acontecimento já é total no tipo — faltar `event.<id>` é erro de compilação
  // em en.ts e em pt-BR.ts, e em execução `translate` indexa o dicionário e lançaria em vez de mostrar
  // a chave crua; o que este teste acrescenta é o que o tipo não vê: quantas eras existem e que
  // `work_done` está na união.
  it('names every event, era included, in both languages', () => {
    for (const id of EVENT_IDS) {
      expect(translate('en', `event.${id}`).trim(), id).not.toBe('')
      expect(translate('pt-BR', `event.${id}`).trim(), id).not.toBe('')
    }
    const eras = EVENTS.filter((def) => def.kind === 'era')
    expect(eras).toHaveLength(Object.keys(Era).length)
    expect(EVENT_IDS).toContain('work_done')
  })

  // FEAT: o nome da obra é conteúdo traduzido e o efeito dela é renderizado do catálogo, então o
  // que precisa de tradução são os doze coeficientes — e três deles já tinham nome em outra tela
  it('names every work, every coefficient a work moves and every era of the catalogue', () => {
    for (const work of WORKS) {
      expect(translate('en', `work.${work.id}`).trim(), work.id).not.toBe('')
      expect(translate('pt-BR', `work.${work.id}`).trim(), work.id).not.toBe('')
    }
    for (const key of [...FACTOR_KEYS, ...TERM_KEYS]) {
      expect(translate('en', workKey(key)).trim(), key).not.toBe('')
      expect(translate('pt-BR', workKey(key)).trim(), key).not.toBe('')
    }
    for (const era of Object.values(Era)) {
      expect(translate('en', eraKey(era)).trim(), String(era)).not.toBe('')
      expect(translate('pt-BR', eraKey(era)).trim(), String(era)).not.toBe('')
    }
    expect(new Set(WORKS.map((work) => translate('en', `work.${work.id}`)))).toHaveLength(
      WORKS.length,
    )
    expect(new Set(WORKS.map((work) => translate('pt-BR', `work.${work.id}`)))).toHaveLength(
      WORKS.length,
    )
  })

  // FEAT: `workKey` e `eraKey` são tabelas de junção, e o tipo só garante que o destino EXISTE —
  // apontar `research` para o rótulo da indústria compila e tem texto. Esta tabela diz qual é o certo
  it('points every coefficient and every era at the label that means it', () => {
    for (const key of [...FACTOR_KEYS, ...TERM_KEYS]) {
      const [english, portuguese] = EFFECT_LABELS[key]
      expect(translate('en', workKey(key)), key).toBe(english)
      expect(translate('pt-BR', workKey(key)), key).toBe(portuguese)
    }
    for (const era of Object.values(Era)) {
      const [english, portuguese] = ERA_LABELS[era]
      expect(translate('en', eraKey(era)), String(era)).toBe(english)
      expect(translate('pt-BR', eraKey(era)), String(era)).toBe(portuguese)
    }
    // FEAT: duas entradas na mesma chave dariam o mesmo nome a dois coeficientes, e uma era sumiria
    const coefficients = [...FACTOR_KEYS, ...TERM_KEYS].map(workKey)
    expect(new Set(coefficients)).toHaveLength(coefficients.length)
    const eras = Object.values(Era).map(eraKey)
    expect(new Set(eras)).toHaveLength(eras.length)
  })
})

describe('translate', () => {
  it('fills named parameters', () => {
    expect(translate('en', 'planet.label', { year: '0247' })).toBe('The world in year 0247')
    expect(translate('pt-BR', 'planet.label', { year: '0247' })).toBe('O mundo no ano 0247')
  })

  it('leaves unknown placeholders visible', () => {
    expect(translate('en', 'planet.label')).toBe('The world in year {year}')
  })
})

describe('detectLocale', () => {
  it('prefers a stored choice', () => {
    expect(detectLocale('pt-BR', ['en-US'])).toBe('pt-BR')
    expect(detectLocale('en', ['pt-BR'])).toBe('en')
  })

  it('falls back to the browser languages', () => {
    expect(detectLocale(null, ['pt-PT', 'en'])).toBe('pt-BR')
    expect(detectLocale('xx', ['fr-FR'])).toBe('en')
  })
})

describe('formatting', () => {
  it('pads years to four digits', () => {
    expect(formatYear(7)).toBe('0007')
    expect(formatYear(2471)).toBe('2471')
    expect(formatYear(12345)).toBe('12345')
  })

  it('formats compact numbers per locale', () => {
    expect(formatCompact(4_200_000, 'en')).toBe('4.2M')
    expect(formatCompact(4_200_000, 'pt-BR')).toMatch(/^4,2\s?mi$/u)
  })

  it('formats decimals per locale', () => {
    expect(formatDecimal(3.456, 'en', 1)).toBe('3.5')
    expect(formatDecimal(3.456, 'pt-BR', 1)).toBe('3,5')
  })

  it('formats each variable with its own convention', () => {
    expect(formatVariable('population', values, 'en')).toBe('4.2M')
    expect(formatVariable('food', values, 'en')).toBe('900K')
    expect(formatVariable('energy', values, 'en')).toBe('3.5')
    expect(formatVariable('technology', values, 'en')).toBe('57')
    expect(formatVariable('environment', values, 'pt-BR')).toBe('89')
  })
})

describe('interaction formatting', () => {
  it('formats yearly changes as percentages or points', () => {
    expect(formatChange('population', 1100, 1000, 'en')).toEqual({
      text: '+10.0%',
      direction: 'up',
    })
    expect(formatChange('technology', 40, 42.3, 'pt-BR')).toEqual({
      text: '-2,3',
      direction: 'down',
    })
    expect(formatChange('stability', 60.01, 60, 'en')).toEqual({ text: '0.0', direction: 'flat' })
    expect(formatChange('energy', 2, undefined, 'en')).toBeNull()
    expect(formatChange('food', 10, 0, 'en')).toBeNull()
  })

  it('formats metrics by their nature', () => {
    expect(formatMetric('foodSecurity', 0.8234, 'en')).toBe('0.82')
    expect(formatMetric('birthRate', 0.0234, 'pt-BR')).toBe('2,3%')
    expect(formatMetric('population', 4_200_000, 'en')).toBe('4.2M')
  })

  it('formats whole percentages', () => {
    expect(formatPercent(40, 'en')).toBe('40%')
    expect(formatPercent(5, 'pt-BR')).toMatch(/^5\s?%$/u)
  })

  it('maps metrics to their labels', () => {
    expect(metricKey('crowding')).toBe('metric.crowding')
    expect(metricKey('environment')).toBe('variable.environment')
  })

  it('formats conditions with enough precision to distinguish close values', () => {
    expect(formatCondition('technology', 40.3, 'en')).toBe('40.3')
    expect(formatCondition('energy', 1.2, 'pt-BR')).toBe('1,20')
    expect(formatCondition('birthRate', 0.0199, 'en')).toBe('1.99%')
  })

  it('formats condition comparisons with just enough precision to differ', () => {
    expect(formatComparison('technology', 40.03, 40, 'en')).toEqual(['40.03', '40.00'])
    expect(formatComparison('foodSecurity', 1.67, 1.1, 'pt-BR')).toEqual(['1,67', '1,10'])
    expect(formatComparison('technology', 40, 40, 'en')).toEqual(['40.0000', '40.0000'])
  })

  it('formats compact conditions', () => {
    expect(formatCondition('population', 4_200_000, 'en')).toBe('4.2M')
  })

  it('lowercases a Title Case label for embedding in an English sentence, but not in pt-BR', () => {
    expect(embedLabel('en', 'Knowledge')).toBe('knowledge')
    expect(embedLabel('pt-BR', 'Conhecimento')).toBe('Conhecimento')
  })
})
