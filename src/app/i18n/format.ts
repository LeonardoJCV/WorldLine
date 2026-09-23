import type { Metric } from '../../engine/events.ts'
import type { Variable } from '../../engine/state.ts'
import type { Locale } from './index.ts'
import type { MessageKey } from './en.ts'

const compact = new Map<Locale, Intl.NumberFormat>()
const decimal = new Map<string, Intl.NumberFormat>()
const signedFormats = new Map<Locale, Intl.NumberFormat>()
const percentFormats = new Map<Locale, Intl.NumberFormat>()
const RELATIVE: ReadonlySet<Variable> = new Set(['population', 'food', 'energy', 'economy'])

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

// FIX: rótulos como cross.kind.* são Title Case para botões avulsos; embutidos numa frase em inglês pedem minúscula
export function embedLabel(locale: Locale, label: string): string {
  return locale === 'en' ? label.charAt(0).toLowerCase() + label.slice(1) : label
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

export function formatMetric(metric: Metric, value: number, locale: Locale): string {
  switch (metric) {
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
    case 'foodSecurity':
    case 'crowding':
    case 'energyRatio':
    case 'economyTrend':
    case 'debtRatio':
      return formatDecimal(value, locale, 2)
    case 'birthRate':
      return `${formatDecimal(value * 100, locale, 1)}%`
    case 'paradoxActive':
    case 'paradoxOverdue':
      return formatDecimal(value, locale, 0)
  }
}

export function formatCondition(metric: Metric, value: number, locale: Locale): string {
  switch (metric) {
    case 'population':
    case 'food':
      return formatCompact(value, locale)
    case 'technology':
    case 'environment':
    case 'stability':
      return formatDecimal(value, locale, 1)
    case 'energy':
    case 'economy':
    case 'foodSecurity':
    case 'crowding':
    case 'energyRatio':
    case 'economyTrend':
    case 'debtRatio':
      return formatDecimal(value, locale, 2)
    case 'birthRate':
      return `${formatDecimal(value * 100, locale, 2)}%`
    case 'paradoxActive':
    case 'paradoxOverdue':
      return formatDecimal(value, locale, 0)
  }
}

function conditionNumber(metric: Metric, value: number, locale: Locale, digits: number): string {
  return metric === 'birthRate'
    ? `${formatDecimal(value * 100, locale, digits)}%`
    : formatDecimal(value, locale, digits)
}

export function formatComparison(
  metric: Metric,
  value: number,
  threshold: number,
  locale: Locale,
): readonly [string, string] {
  if (metric === 'population' || metric === 'food') {
    return [formatCondition(metric, value, locale), formatCondition(metric, threshold, locale)]
  }
  const base = metric === 'technology' || metric === 'environment' || metric === 'stability' ? 1 : 2
  let pair: readonly [string, string] = ['', '']
  for (let digits = base; digits <= base + 3; digits++) {
    pair = [
      conditionNumber(metric, value, locale, digits),
      conditionNumber(metric, threshold, locale, digits),
    ]
    if (pair[0] !== pair[1]) break
  }
  return pair
}

export function formatVariable(
  variable: Variable,
  values: Readonly<Record<Variable, number>>,
  locale: Locale,
): string {
  return formatMetric(variable, values[variable], locale)
}

export type Direction = 'up' | 'down' | 'flat'

export interface Change {
  readonly text: string
  readonly direction: Direction
}

export function formatChange(
  variable: Variable,
  value: number,
  previous: number | undefined,
  locale: Locale,
): Change | null {
  if (previous === undefined || !Number.isFinite(previous)) return null
  const relative = RELATIVE.has(variable)
  if (relative && previous === 0) return null
  const delta = relative ? ((value - previous) / Math.abs(previous)) * 100 : value - previous
  if (!Number.isFinite(delta)) return null
  const rounded = Math.round(delta * 10) / 10
  let format = signedFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    })
    signedFormats.set(locale, format)
  }
  return {
    text: `${format.format(rounded)}${relative ? '%' : ''}`,
    direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat',
  }
}

export function formatPercent(value: number, locale: Locale): string {
  let format = percentFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
    percentFormats.set(locale, format)
  }
  return format.format(value / 100)
}

const METRIC_KEYS: Readonly<Record<Metric, MessageKey>> = {
  population: 'variable.population',
  food: 'variable.food',
  energy: 'variable.energy',
  technology: 'variable.technology',
  economy: 'variable.economy',
  environment: 'variable.environment',
  stability: 'variable.stability',
  foodSecurity: 'metric.foodSecurity',
  crowding: 'metric.crowding',
  energyRatio: 'metric.energyRatio',
  economyTrend: 'metric.economyTrend',
  birthRate: 'metric.birthRate',
  debtRatio: 'metric.debtRatio',
  paradoxActive: 'metric.paradoxActive',
  paradoxOverdue: 'metric.paradoxOverdue',
}

export function metricKey(metric: Metric): MessageKey {
  return METRIC_KEYS[metric]
}
