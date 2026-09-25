import { colonyCost } from './colony.ts'
import { debtRatio } from './debt.ts'
import { clamp, pow, smoothstep } from './math.ts'
import { DEBT_WEIGHT, PARAMS as K } from './params.ts'
import { Era, VARIABLES, hasEra, type WorldConfig, type WorldState } from './state.ts'

export interface Modifiers {
  readonly harvest: number
  readonly production: number
  readonly economy: number
  readonly research: number
  readonly mortality: number
  readonly stability: number
}

export const NEUTRAL_MODIFIERS: Modifiers = {
  harvest: 1,
  production: 1,
  economy: 1,
  research: 1,
  mortality: 0,
  stability: 0,
}

export interface Derived {
  readonly labor: number
  readonly clean: number
  readonly capacity: number
  readonly carryingCapacity: number
  readonly foodProduction: number
  readonly foodAvailable: number
  readonly foodSecurity: number
  readonly energyTarget: number
  readonly pollution: number
  readonly birthRate: number
  readonly deathRate: number
}

export class SimulationError extends Error {
  readonly variable: string
  readonly tick: number

  constructor(variable: string, tick: number) {
    super(`${variable} became non-finite at tick ${tick}`)
    this.name = 'SimulationError'
    this.variable = variable
    this.tick = tick
  }
}

export function derive(
  s: WorldState,
  world: WorldConfig,
  mods: Modifiers,
  harvestNoise: number,
): Derived {
  const agriculture = s.allocation.agriculture / 100
  const industry = s.allocation.industry / 100
  const labor = s.population * K.laborShare
  const clean = K.cleanMax * smoothstep(K.cleanFrom, K.cleanTo, s.technology)
  const mech = s.energy / (s.energy + K.mechHalf)
  const techYield =
    1 + (K.techYield * s.technology) / 100 + (hasEra(s, Era.agricultural) ? K.agriEraBonus : 0)
  const capacity =
    K.C0 *
    world.fertility *
    techYield *
    Math.sqrt(s.environment / 100) *
    (K.agriBase + K.agriWeight * agriculture) *
    (1 + K.mechWeight * mech)
  const carryingCapacity = capacity * (1 - 1 / (K.laborShare * K.y0))
  const shock = (1 + K.harvestNoise * (2 * harvestNoise - 1)) * mods.harvest
  const stabilityYield = K.harvestStabilityBase + ((1 - K.harvestStabilityBase) * s.stability) / 100
  const demand = labor + capacity / K.y0
  // FIX: sem ninguém e sem terra os dois zeram juntos, e colheita nenhuma é zero, não indefinida
  const foodProduction =
    demand > 0 ? ((capacity * labor) / demand) * shock * stabilityYield * mods.production : 0
  const foodAvailable = s.food * (1 - K.spoil) + foodProduction
  // FIX: sem ninguém para alimentar, a comida por pessoa não é uma divisão
  const foodSecurity = s.population > 0 ? foodAvailable / s.population : Number.POSITIVE_INFINITY
  // FIX: a colônia consome vazão, não estoque: o custo sai do alvo da energia, não do nível
  const energyTarget = Math.max(
    K.energyBase,
    (K.energyBase + K.energyWeight * industry) *
      (1 + (K.energyTech * s.technology) / 100) *
      (hasEra(s, Era.industrial) ? K.industrialEnergy : 1) -
      colonyCost(s.colonies),
  )
  const pollution =
    K.pN * K.pollutionScale * s.energy * (1 - clean) * pow(s.population / K.P0, K.pollutionPopExp)
  const transition = s.economy / K.yDT
  const fed = smoothstep(K.fertilityFrom, K.fertilityTo, foodSecurity)
  const birthRate =
    (K.bMin + (K.bMax - K.bMin) / (1 + transition * transition)) *
    (K.fertilityFloor + (1 - K.fertilityFloor) * fed)
  const hunger = Math.max(0, 1 - foodSecurity)
  const degradation = 1 - s.environment / 100
  const deathRate =
    (K.d0 * (1 - (K.techMortality * s.technology) / 100)) / (1 + K.wealthMortality * s.economy) +
    K.dFam * hunger * Math.sqrt(hunger) +
    K.dPol * degradation * degradation +
    mods.mortality

  return {
    labor,
    clean,
    capacity,
    carryingCapacity,
    foodProduction,
    foodAvailable,
    foodSecurity,
    energyTarget,
    pollution,
    birthRate,
    deathRate,
  }
}

export function integrate(s: WorldState, d: Derived, mods: Modifiers, migrated = 0): WorldState {
  const research = s.allocation.research / 100
  const conservation = s.allocation.conservation / 100

  const food = Math.max(0, d.foodAvailable - s.population)

  const growthLimit =
    d.energyTarget > s.energy ? Math.min(1, s.economy / (s.energy + K.energyGrowthDamping)) : 1
  const energy = s.energy + K.rE * (d.energyTarget - s.energy) * growthLimit

  const economyTarget =
    (1 + s.technology / K.econTechDivisor) *
    pow(s.energy + K.energyFloor, K.beta) *
    Math.min(1, d.foodSecurity) *
    (K.econStabilityBase + ((1 - K.econStabilityBase) * s.stability) / 100) *
    mods.economy *
    mods.production
  const economy = s.economy + K.econInertia * (economyTarget - s.economy)

  const technology = clamp(
    s.technology +
      K.kT *
        research *
        Math.sqrt(s.economy) *
        (1 - s.technology / 100) *
        (hasEra(s, Era.industrial) ? K.industrialResearch : 1) *
        mods.research,
    0,
    100,
  )

  const room = 1 - s.environment / 100
  const environment = clamp(
    s.environment + K.rN * s.environment * room - d.pollution + K.kC * conservation * room,
    0,
    100,
  )

  const population = Math.max(0, s.population * (1 + d.birthRate - d.deathRate))
  // FIX: quem partiu já saiu da população, mas ainda contava no começo do ano; a base o traz de
  // volta uma vez só, e um mundo vazio não tem crescimento a medir
  const before = s.population + migrated
  const growth = before > 0 ? (population - before) / before : 0
  // FEAT: o termo da dívida entra no mesmo clamp dos outros, então ela não empurra o alvo fora de 0..1
  const stabilityTarget =
    100 *
      clamp(
        (K.stabilityFood * Math.min(d.foodSecurity, 1.2)) / 1.2 +
          K.stabilityGrowth * clamp(0.5 + 20 * growth, 0, 1) +
          (K.stabilityEnvironment * s.environment) / 100 -
          DEBT_WEIGHT * clamp(debtRatio(s.debts, s), 0, 1),
        0,
        1,
      ) +
    mods.stability
  const stability = clamp(
    s.stability + K.stabilityInertia * (stabilityTarget - s.stability),
    0,
    100,
  )

  const next: WorldState = {
    ...s,
    tick: s.tick + 1,
    population,
    food,
    energy,
    technology,
    economy,
    environment,
    stability,
    recentEconomy: [...s.recentEconomy.slice(1), s.economy],
  }
  for (const variable of VARIABLES) {
    if (!Number.isFinite(next[variable])) throw new SimulationError(variable, s.tick)
  }
  return next
}
