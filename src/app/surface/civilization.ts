import type { EventId } from '../../engine/events.ts'
import { Era, type Allocation, type Status, type Variable } from '../../engine/state.ts'
import { BUILT_MAX, MAX_SITES, type Site } from './sites.ts'

export type CityEra = 'village' | 'town' | 'industrial' | 'modern'
export type CityActivity = 'agrarian' | 'industrial' | 'port'

export interface City {
  readonly site: number
  readonly state: 'alive' | 'ruin'
  readonly population: number
  readonly size: number
  readonly founded: number
  readonly activity: CityActivity
}

export interface SurfaceModel {
  readonly era: CityEra
  readonly cities: readonly City[]
  readonly forest: number
  readonly clearing: number
  readonly farm: number
  readonly livestock: number
  readonly fauna: number
  readonly boats: number
  readonly factories: number
  readonly mines: number
  readonly electric: number
  readonly economy: number
  readonly dry: boolean
  readonly burnt: boolean
  readonly unrest: boolean
  readonly extinct: boolean
  readonly collapsed: boolean
}

export interface CivilizationInput {
  readonly sites: readonly Site[]
  readonly values: Readonly<Record<Variable, number>>
  readonly eras: number
  readonly active: readonly EventId[]
  readonly allocation: Allocation
  readonly status: Status
  readonly history: {
    readonly from: number
    readonly to: number
    readonly population: Float32Array
  }
}

export const CITY_BASE = 150_000
export const CITY_GROWTH = 1.12
export const METROPOLIS = 20_000_000
export const TRADE_ECONOMY = 5
const ECONOMY_FULL = 10
const RUIN_SIZE = 0.3
const HEIGHT: Readonly<Record<CityEra, number>> = {
  village: 0.6,
  town: 1,
  industrial: 1.8,
  modern: 3.5,
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function thresholds(count: number): number[] {
  const out: number[] = []
  let value = CITY_BASE
  for (let k = 0; k < count; k++) {
    out.push(value)
    value *= CITY_GROWTH
  }
  return out
}

function eraOf(eras: number, technology: number): CityEra {
  if (technology >= 70) return 'modern'
  if ((eras & Era.industrial) !== 0) return 'industrial'
  if ((eras & Era.agricultural) !== 0) return 'town'
  return 'village'
}

function foundedAt(history: CivilizationInput['history'], threshold: number): number {
  const range = Math.max(0, history.to - history.from)
  const data = history.population
  const last = Math.max(1, data.length - 1)
  for (let i = 0; i < data.length; i++) {
    if ((data[i] ?? 0) >= threshold) {
      return Math.floor(history.from + (range * i) / last + 0.5)
    }
  }
  return history.to
}

export function surfaceModel(input: CivilizationInput): SurfaceModel {
  const { values, allocation, sites } = input
  const extinct = input.status === 'extinct'
  // FEAT: colapso não mata a população — só corta o mundo do resto: o cais fica vazio, o litoral segue
  const collapsed = input.status === 'collapsed'
  const population = extinct
    ? 0
    : Number.isFinite(values.population)
      ? Math.max(0, values.population)
      : 0
  const limits = thresholds(Math.min(sites.length, MAX_SITES))
  let peak = population
  for (const p of input.history.population) {
    if (Number.isFinite(p)) peak = Math.max(peak, p)
  }
  const alive = limits.filter((t) => t <= population).length
  const existed = limits.filter((t) => t <= peak).length
  let harmonic = 0
  for (let i = 0; i < alive; i++) harmonic += 1 / (i + 1)
  const era = eraOf(input.eras, values.technology)
  const cities: City[] = []
  for (let k = 0; k < existed; k++) {
    const site = sites[k]
    if (!site) break
    const living = k < alive
    const share = living ? population / (k + 1) / (harmonic || 1) : 0
    const port = site.coast && values.economy >= TRADE_ECONOMY
    const works = (era === 'industrial' || era === 'modern') && allocation.industry >= 35
    // FIX: quase todo sítio é costeiro; alternar evita que os portos apaguem as cidades industriais
    const activity: CityActivity =
      port && works
        ? k % 2 === 0
          ? 'industrial'
          : 'port'
        : port
          ? 'port'
          : works
            ? 'industrial'
            : 'agrarian'
    cities.push({
      site: site.index,
      state: living ? 'alive' : 'ruin',
      population: Math.floor(share + 0.5),
      size: living ? Math.min(1, Math.max(0.08, Math.sqrt(share / METROPOLIS))) : RUIN_SIZE,
      founded: foundedAt(input.history, limits[k] ?? CITY_BASE),
      activity,
    })
  }
  const dry = input.active.includes('famine')
  const burnt = input.active.includes('ecological_crisis')
  const unrest = input.active.includes('civil_unrest')
  const conservation = allocation.conservation / 100
  const industrious = era === 'industrial' || era === 'modern'
  const energy = clamp01(values.energy / 10)
  const coastal = cities.some((c) => c.state === 'alive' && (sites[c.site]?.coast ?? false))
  const environment = clamp01(values.environment / 100)
  return {
    era,
    cities,
    forest: extinct ? environment : environment * (0.6 + 0.4 * conservation) * (burnt ? 0.7 : 1),
    clearing: 0.6 + 0.9 * (1 - conservation),
    farm: extinct ? 0 : clamp01(0.15 + 1.1 * (allocation.agriculture / 100)),
    livestock: extinct ? 0 : clamp01((allocation.agriculture / 100) * 1.4) * (dry ? 0.4 : 1),
    fauna: extinct ? 1 : environment * (1 - 0.6 * clamp01(population / 50_000_000)),
    boats: extinct || collapsed || !coastal ? 0 : clamp01(values.economy / 15),
    factories:
      extinct || !industrious
        ? 0
        : clamp01((allocation.industry / 100) * 1.5) * clamp01(0.3 + energy),
    mines: extinct || values.technology < 20 ? 0 : clamp01(allocation.industry / 100),
    electric:
      extinct || !industrious ? 0 : era === 'modern' ? 0.7 + 0.3 * energy : 0.35 + 0.35 * energy,
    economy: extinct || !Number.isFinite(values.economy) ? 0 : Math.max(0, values.economy),
    dry,
    burnt,
    unrest,
    extinct,
    collapsed,
  }
}

// FEAT: a economia enche as estradas; mesmo pobre, ainda há algum movimento
export function bustle(model: SurfaceModel): number {
  return 0.4 + 0.6 * clamp01(model.economy / ECONOMY_FULL)
}

export interface LifeUniforms {
  readonly city: Float32Array
  readonly city2: Float32Array
  readonly life: readonly [number, number, number, number]
  readonly life2: readonly [number, number, number, number]
  readonly life3: readonly [number, number, number, number]
}

const ACTIVITY: Readonly<Record<CityActivity, number>> = { agrarian: 0, industrial: 1, port: 2 }

export function packLife(model: SurfaceModel, time: number): LifeUniforms {
  const city = new Float32Array(MAX_SITES * 4)
  const city2 = new Float32Array(MAX_SITES * 4)
  for (const c of model.cities) {
    const built = c.size * BUILT_MAX
    const farmOuter = Math.min(1, built + model.farm * (1 - BUILT_MAX) * Math.sqrt(c.size))
    const alive = c.state === 'alive'
    city.set(
      [
        built,
        alive ? 1 : 2,
        alive ? HEIGHT[model.era] : 0.35,
        alive ? model.electric * (0.4 + 0.6 * c.size) : 0,
      ],
      c.site * 4,
    )
    city2.set(
      [
        built,
        alive ? farmOuter : 0,
        alive ? farmOuter * model.clearing : built,
        ACTIVITY[c.activity],
      ],
      c.site * 4,
    )
  }
  return {
    city,
    city2,
    life: [model.forest, model.livestock, model.fauna, model.boats],
    life2: [model.factories, model.mines, model.dry ? 1 : 0, model.burnt ? 1 : 0],
    life3: [model.unrest ? 1 : 0, model.extinct ? 1 : 0, time, model.collapsed ? 1 : 0],
  }
}
