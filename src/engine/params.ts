import type { Allocation } from './state.ts'

export const HORIZON = 10_000
export const CHECKPOINT_INTERVAL = 256
export const EXTINCTION_THRESHOLD = 1000
export const MAX_SEED = 0xffffffff
export const CAUSAL_WINDOW = 50
export const MODEL_VERSION = 2

export const DEFAULT_ALLOCATION: Allocation = {
  agriculture: 40,
  industry: 30,
  research: 20,
  conservation: 10,
}

export const GENESIS_RANGES = {
  population: [6e5, 1.4e6],
  technology: [2, 10],
  environment: [70, 95],
  energy: [0.3, 0.8],
  fertility: [0.8, 1.25],
} as const
export const GENESIS_FOOD_RESERVE = 0.3
export const GENESIS_ECONOMY = 1
export const GENESIS_STABILITY = 60

export const PARAMS = {
  laborShare: 0.5,
  C0: 4e6,
  y0: 4,
  spoil: 0.35,
  techYield: 3,
  agriEraBonus: 0.5,
  agriBase: 0.2,
  agriWeight: 1.8,
  mechWeight: 0.5,
  mechHalf: 3,
  harvestStabilityBase: 0.75,
  harvestNoise: 0.12,
  energyBase: 0.3,
  energyWeight: 4,
  energyTech: 2,
  industrialEnergy: 2,
  rE: 0.05,
  energyGrowthDamping: 0.5,
  econTechDivisor: 25,
  beta: 0.4,
  energyFloor: 0.2,
  econStabilityBase: 0.6,
  econInertia: 0.25,
  kT: 0.1,
  industrialResearch: 1.5,
  cleanMax: 0.85,
  cleanFrom: 40,
  cleanTo: 90,
  rN: 0.035,
  pN: 1.0,
  pollutionScale: 0.1,
  pollutionPopExp: 0.3,
  P0: 1e6,
  kC: 1.5,
  bMax: 0.036,
  bMin: 0.014,
  yDT: 3,
  fertilityFloor: 0.5,
  fertilityFrom: 0.9,
  fertilityTo: 1.2,
  d0: 0.03,
  techMortality: 0.5,
  wealthMortality: 0.12,
  dFam: 0.4,
  dPol: 0.015,
  stabilityFood: 0.45,
  stabilityGrowth: 0.25,
  stabilityEnvironment: 0.3,
  stabilityInertia: 0.15,
} as const

export const REPAY_SCALE: Readonly<Record<'knowledge' | 'resource' | 'doctrine', number>> = {
  knowledge: 0.4,
  resource: 0.0000004,
  doctrine: 0.1,
}
export const DEBT_EPSILON = 1e-6
// FEAT: gente por unidade de tamanho do mundo, na conta da dívida relativa
export const DEBT_POP_UNIT = 1e6
// FEAT: piso do tamanho do mundo, para um mundo jovem não afundar sob um presente comum
export const DEBT_SIZE_FLOOR = 20
// FEAT: peso do termo da dívida no alvo de estabilidade
export const DEBT_WEIGHT = 0.35
// FEAT: dívida relativa que começa a contar para o paradoxo de dívida grande demais
export const PARADOX_RATIO = 0.35
// FEAT: anos seguidos acima do limite antes de instalar o paradoxo de dívida
export const PARADOX_PATIENCE = 80
// FEAT: "presente cedo demais": múltiplo do que o mundo tem naquela grandeza
export const PARADOX_LEAP = 3
// FEAT: prazo, em anos, para quitar antes do colapso
export const PARADOX_GRACE = 200
