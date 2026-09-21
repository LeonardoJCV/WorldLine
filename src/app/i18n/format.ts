import type { Variable } from '../../engine/state.ts'
import type { Locale } from './index.ts'

const compact = new Map<Locale, Intl.NumberFormat>()
const decimal = new Map<string, Intl.NumberFormat>()

export function formatYear(tick: number): string {
  return String(Math.max(0, Math.floor(tick))).padStart(4, '0')
}

export function formatCompact(value: number, locale: Locale): string {
  let format = compact.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
    compact.set(locale, format)
  }
  return format.format(value)
}

export function formatDecimal(value: number, locale: Locale, digits = 1): string {
  const key = `${locale}:${digits}`
  let format = decimal.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    decimal.set(key, format)
  }
  return format.format(value)
}

export function formatVariable(
  variable: Variable,
  values: Readonly<Record<Variable, number>>,
  locale: Locale,
): string {
  const value = values[variable]
  switch (variable) {
    case 'population':
    case 'food':
      return formatCompact(value, locale)
    case 'energy':
    case 'economy':
      return formatDecimal(value, locale, 1)
    case 'technology':
    case 'environment':
    case 'stability':
      return formatDecimal(value, locale, 0)
  }
}
