import { describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { formatCompact, formatDecimal, formatVariable, formatYear } from './format.ts'
import { detectLocale, translate } from './index.ts'
import { ptBR } from './pt-BR.ts'

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
