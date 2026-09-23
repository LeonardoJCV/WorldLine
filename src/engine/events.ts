import type { CrossingKind } from './crossing.ts'
import { debtRatio, heaviestDebt } from './debt.ts'
import { smoothstep } from './math.ts'
import { CAUSAL_WINDOW, EXTINCTION_THRESHOLD } from './params.ts'
import { Channel, uniform } from './rng.ts'
import { NEUTRAL_MODIFIERS, derive, type Derived, type Modifiers } from './rules.ts'
import {
  Era,
  SECTORS,
  type ActiveEvent,
  type Sector,
  type WorldConfig,
  type WorldState,
} from './state.ts'

export const EVENT_IDS = [
  'agricultural_revolution',
  'industrial_revolution',
  'demographic_transition',
  'famine',
  'epidemic',
  'energy_crisis',
  'ecological_crisis',
  'recession',
  'civil_unrest',
  'golden_age',
  'extinction',
  'debt_strain',
  'foreign_rejection',
  'dependency',
  'paradox',
  'collapse',
] as const
export type EventId = (typeof EVENT_IDS)[number]

export const METRICS = [
  'population',
  'food',
  'energy',
  'technology',
  'economy',
  'environment',
  'stability',
  'foodSecurity',
  'crowding',
  'energyRatio',
  'economyTrend',
  'birthRate',
  'debtRatio',
  // FEAT: sinalizadores 0/1 do estado, para escrever paradox/collapse como condição comum
  'paradoxActive',
  'paradoxOverdue',
] as const
export type Metric = (typeof METRICS)[number]
export type Metrics = Readonly<Record<Metric, number>>

export interface Condition {
  readonly metric: Metric
  readonly op: '<' | '>'
  readonly value: number
}

export interface EventDef {
  readonly id: EventId
  readonly kind: 'era' | 'condition' | 'pulse' | 'terminal'
  readonly trigger: readonly Condition[]
  readonly release?: readonly Condition[]
  readonly duration?: number
  readonly hazard?: {
    readonly metric: Metric
    readonly from: number
    readonly to: number
    readonly rate: number
  }
  readonly cooldown: number
  readonly excludes?: readonly EventId[]
  readonly interrupts?: readonly EventId[]
  readonly era?: number
  readonly effect?: Partial<Modifiers>
  readonly influences: readonly Metric[]
}

export type Cause =
  | {
      readonly kind: 'condition'
      readonly metric: Metric
      readonly op: '<' | '>'
      readonly threshold: number
      readonly value: number
    }
  | { readonly kind: 'event'; readonly record: number }
  | { readonly kind: 'decision'; readonly tick: number; readonly sectors: readonly Sector[] }
  | { readonly kind: 'crossing'; readonly tick: number; readonly crossing: CrossingKind }

export interface EventRecord {
  readonly event: EventId
  readonly start: number
  end: number | null
  readonly causes: readonly Cause[]
}

export const EVENTS: readonly EventDef[] = [
  {
    id: 'agricultural_revolution',
    kind: 'era',
    era: Era.agricultural,
    trigger: [
      { metric: 'technology', op: '>', value: 20 },
      { metric: 'foodSecurity', op: '>', value: 1.05 },
    ],
    cooldown: 0,
    influences: ['food', 'foodSecurity', 'crowding'],
  },
  {
    id: 'industrial_revolution',
    kind: 'era',
    era: Era.industrial,
    trigger: [
      { metric: 'technology', op: '>', value: 40 },
      { metric: 'energy', op: '>', value: 1.2 },
    ],
    cooldown: 0,
    influences: ['energy', 'energyRatio', 'technology', 'environment'],
  },
  {
    id: 'demographic_transition',
    kind: 'era',
    era: Era.demographic,
    trigger: [
      { metric: 'economy', op: '>', value: 3 },
      { metric: 'birthRate', op: '<', value: 0.02 },
    ],
    cooldown: 0,
    influences: ['population'],
  },
  {
    id: 'famine',
    kind: 'condition',
    trigger: [{ metric: 'foodSecurity', op: '<', value: 0.9 }],
    release: [{ metric: 'foodSecurity', op: '>', value: 0.99 }],
    hazard: { metric: 'foodSecurity', from: 0.9, to: 0.7, rate: 1 },
    cooldown: 15,
    interrupts: ['golden_age'],
    influences: ['population', 'stability', 'economy', 'economyTrend'],
  },
  {
    id: 'epidemic',
    kind: 'pulse',
    duration: 3,
    trigger: [
      { metric: 'crowding', op: '>', value: 0.9 },
      { metric: 'technology', op: '<', value: 35 },
    ],
    hazard: { metric: 'crowding', from: 0.9, to: 1.1, rate: 0.08 },
    cooldown: 30,
    effect: { mortality: 0.02 },
    influences: ['population', 'crowding'],
  },
  {
    id: 'energy_crisis',
    kind: 'condition',
    trigger: [
      { metric: 'energyRatio', op: '<', value: 0.7 },
      { metric: 'economyTrend', op: '<', value: 1 },
    ],
    release: [{ metric: 'energyRatio', op: '>', value: 0.85 }],
    cooldown: 20,
    effect: { economy: 0.85 },
    influences: ['economy', 'economyTrend'],
  },
  {
    id: 'ecological_crisis',
    kind: 'condition',
    trigger: [{ metric: 'environment', op: '<', value: 35 }],
    release: [{ metric: 'environment', op: '>', value: 45 }],
    cooldown: 10,
    effect: { harvest: 0.85 },
    influences: ['food', 'foodSecurity'],
  },
  {
    id: 'recession',
    kind: 'condition',
    trigger: [{ metric: 'economyTrend', op: '<', value: 0.9 }],
    release: [{ metric: 'economyTrend', op: '>', value: 1 }],
    cooldown: 10,
    effect: { stability: -10 },
    influences: ['stability'],
  },
  {
    id: 'civil_unrest',
    kind: 'condition',
    trigger: [{ metric: 'stability', op: '<', value: 30 }],
    release: [{ metric: 'stability', op: '>', value: 40 }],
    cooldown: 10,
    excludes: ['golden_age'],
    effect: { production: 0.9, research: 0.5 },
    influences: ['food', 'foodSecurity', 'economy', 'economyTrend', 'technology'],
  },
  {
    id: 'golden_age',
    kind: 'condition',
    trigger: [
      { metric: 'stability', op: '>', value: 80 },
      { metric: 'foodSecurity', op: '>', value: 1.1 },
    ],
    release: [{ metric: 'stability', op: '<', value: 70 }],
    hazard: { metric: 'stability', from: 80, to: 90, rate: 0.05 },
    cooldown: 50,
    excludes: ['civil_unrest', 'famine'],
    effect: { research: 1.3 },
    influences: ['technology'],
  },
  {
    id: 'extinction',
    kind: 'terminal',
    trigger: [{ metric: 'population', op: '<', value: EXTINCTION_THRESHOLD }],
    cooldown: 0,
    influences: [],
  },
  {
    id: 'debt_strain',
    kind: 'condition',
    trigger: [{ metric: 'debtRatio', op: '>', value: 0.35 }],
    release: [{ metric: 'debtRatio', op: '<', value: 0.2 }],
    cooldown: 30,
    influences: ['stability', 'economy'],
    effect: { stability: -4 },
  },
  {
    id: 'foreign_rejection',
    kind: 'pulse',
    duration: 15,
    trigger: [
      { metric: 'debtRatio', op: '>', value: 0.5 },
      { metric: 'stability', op: '<', value: 45 },
    ],
    cooldown: 60,
    influences: ['stability'],
    effect: { stability: -8 },
  },
  {
    id: 'dependency',
    kind: 'condition',
    trigger: [{ metric: 'debtRatio', op: '>', value: 0.8 }],
    release: [{ metric: 'debtRatio', op: '<', value: 0.5 }],
    cooldown: 40,
    influences: ['technology', 'economy'],
    // FIX: production é fator multiplicativo (não aditivo como stability); -0.05 do briefing
    // inverteria o sinal da produção, então o corte de 5% é 0.95
    effect: { production: 0.95 },
  },
  {
    id: 'paradox',
    kind: 'condition',
    trigger: [{ metric: 'paradoxActive', op: '>', value: 0 }],
    release: [{ metric: 'paradoxActive', op: '<', value: 1 }],
    cooldown: 0,
    influences: ['paradoxOverdue'],
  },
  {
    id: 'collapse',
    kind: 'terminal',
    trigger: [{ metric: 'paradoxOverdue', op: '>', value: 0 }],
    cooldown: 0,
    influences: [],
  },
]

const SECTOR_INFLUENCES: Readonly<Record<Sector, readonly Metric[]>> = {
  agriculture: ['food', 'foodSecurity', 'crowding', 'population'],
  industry: ['energy', 'energyRatio', 'economy', 'economyTrend', 'environment'],
  research: ['technology'],
  conservation: ['environment'],
}

// FEAT: doutrina mexe no que qualquer setor mexe; só quem abre dívida chega ao paradoxo
const CROSSING_INFLUENCES: Readonly<Record<CrossingKind, readonly Metric[]>> = {
  knowledge: ['technology', 'debtRatio', 'paradoxActive'],
  resource: ['food', 'foodSecurity', 'energy', 'energyRatio', 'debtRatio', 'paradoxActive'],
  people: ['population', 'crowding', 'foodSecurity'],
  doctrine: [
    ...SECTORS.flatMap((sector) => SECTOR_INFLUENCES[sector]),
    'debtRatio',
    'paradoxActive',
  ],
}

export function computeMetrics(s: WorldState, d: Derived): Metrics {
  return {
    population: s.population,
    food: s.food,
    energy: s.energy,
    technology: s.technology,
    economy: s.economy,
    environment: s.environment,
    stability: s.stability,
    foodSecurity: d.foodSecurity,
    crowding: s.population / d.carryingCapacity,
    energyRatio: s.energy / d.energyTarget,
    economyTrend: s.economy / (s.recentEconomy[0] ?? s.economy),
    birthRate: d.birthRate,
    debtRatio: debtRatio(s.debts, s),
    paradoxActive: s.paradox ? 1 : 0,
    paradoxOverdue: s.paradox && s.tick >= s.paradox.deadline ? 1 : 0,
  }
}

// FEAT: o que o mundo produz neste ano, para quem precisa perguntar "o que aconteceria neste
// estado" sem repetir o encadeamento de derive; reusa o mesmo sorteio de colheita do ano
export function worldDerived(s: WorldState, world: WorldConfig): Derived {
  const mods = collectModifiers(s.active)
  return derive(s, world, mods, uniform(world.seed, s.tick, Channel.harvest))
}

// FEAT: as grandezas do mundo tal como os eventos as leem
export function worldMetrics(s: WorldState, world: WorldConfig): Metrics {
  return computeMetrics(s, worldDerived(s, world))
}

export function collectModifiers(
  active: readonly ActiveEvent[],
  defs: readonly EventDef[] = EVENTS,
): Modifiers {
  let mods = NEUTRAL_MODIFIERS
  for (const entry of active) {
    const effect = defs[entry.def]?.effect
    if (!effect) continue
    mods = {
      harvest: mods.harvest * (effect.harvest ?? 1),
      production: mods.production * (effect.production ?? 1),
      economy: mods.economy * (effect.economy ?? 1),
      research: mods.research * (effect.research ?? 1),
      mortality: mods.mortality + (effect.mortality ?? 0),
      stability: mods.stability + (effect.stability ?? 0),
    }
  }
  return mods
}

export interface EventOutcome {
  readonly active: readonly ActiveEvent[]
  readonly eras: number
  readonly lastEnded: readonly number[]
  readonly started: readonly EventRecord[]
  readonly ended: readonly number[]
  readonly extinct: boolean
  readonly collapsed: boolean
}

export function holds(conditions: readonly Condition[], metrics: Metrics): boolean {
  return conditions.every((c) =>
    c.op === '<' ? metrics[c.metric] < c.value : metrics[c.metric] > c.value,
  )
}

function sameCrossing(cause: Cause, other: Extract<Cause, { kind: 'crossing' }>): boolean {
  return cause.kind === 'crossing' && cause.tick === other.tick && cause.crossing === other.crossing
}

function causesOf(
  def: EventDef,
  s: WorldState,
  metrics: Metrics,
  active: readonly ActiveEvent[],
  defs: readonly EventDef[],
): Cause[] {
  const causes: Cause[] = def.trigger.map((c) => ({
    kind: 'condition',
    metric: c.metric,
    op: c.op,
    threshold: c.value,
    value: metrics[c.metric],
  }))
  const involved = (metric: Metric) => def.trigger.some((c) => c.metric === metric)

  for (const entry of active) {
    const other = defs[entry.def]
    if (!other) continue
    if (entry.start === s.tick) continue
    if (other.kind === 'era' && s.tick - entry.start > CAUSAL_WINDOW) continue
    if (other.influences.some(involved)) causes.push({ kind: 'event', record: entry.record })
  }

  const decision = s.lastDecision
  if (decision && s.tick - decision.tick <= CAUSAL_WINDOW) {
    const sectors = decision.sectors.filter((sector) => SECTOR_INFLUENCES[sector].some(involved))
    if (sectors.length > 0) causes.push({ kind: 'decision', tick: decision.tick, sectors })
  }

  const crossing = s.lastCrossing
  if (
    crossing &&
    s.tick - crossing.tick <= CAUSAL_WINDOW &&
    CROSSING_INFLUENCES[crossing.kind].some(involved)
  ) {
    causes.push({ kind: 'crossing', tick: crossing.tick, crossing: crossing.kind })
  }
  // FEAT: a dívida cobra séculos depois, então a travessia que a abriu nomeia o paradoxo fora da janela
  if (s.paradox?.kind === 'debt' && involved('paradoxActive')) {
    const heaviest = heaviestDebt(s.debts)
    const named = heaviest
      ? ({ kind: 'crossing', tick: heaviest.since, crossing: heaviest.kind } as const)
      : null
    if (named && !causes.some((cause) => sameCrossing(cause, named))) causes.push(named)
  }
  return causes
}

export function evaluateEvents(
  s: WorldState,
  metrics: Metrics,
  seed: number,
  nextRecord: number,
  defs: readonly EventDef[] = EVENTS,
): EventOutcome {
  const lastEnded = defs.map((_, i) => s.lastEnded[i] ?? Number.NEGATIVE_INFINITY)
  const ended: number[] = []
  const finish = (entry: ActiveEvent) => {
    ended.push(entry.record)
    lastEnded[entry.def] = s.tick
  }

  let active = s.active.filter((entry) => {
    const def = defs[entry.def]
    if (!def) return false
    const done =
      def.kind === 'pulse'
        ? s.tick - entry.start >= (def.duration ?? 0)
        : def.kind === 'condition' && holds(def.release ?? [], metrics)
    if (done) finish(entry)
    return !done
  })

  let eras = s.eras
  let extinct = false
  let collapsed = false
  const started: EventRecord[] = []
  const isActive = (id: EventId) => active.some((entry) => defs[entry.def]?.id === id)

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]
    if (!def) continue
    if (def.era !== undefined && (eras & def.era) !== 0) continue
    if (active.some((entry) => entry.def === i)) continue
    if (s.tick - (lastEnded[i] ?? Number.NEGATIVE_INFINITY) <= def.cooldown) continue
    if (def.excludes?.some(isActive)) continue
    if (!holds(def.trigger, metrics)) continue
    if (def.hazard) {
      const { metric, from, to, rate } = def.hazard
      const probability = rate * smoothstep(from, to, metrics[metric])
      if (uniform(seed, s.tick, Channel.event + i) >= probability) continue
    }

    const record = nextRecord + started.length
    started.push({
      event: def.id,
      start: s.tick,
      end: null,
      causes: causesOf(def, s, metrics, active, defs),
    })

    const interrupts = def.interrupts
    if (interrupts) {
      active = active.filter((entry) => {
        const id = defs[entry.def]?.id
        const hit = id !== undefined && interrupts.includes(id)
        if (hit) finish(entry)
        return !hit
      })
    }
    if (def.era !== undefined) eras |= def.era
    // FEAT: os dois fins são terminais, mas um mundo que colapsa não é um mundo que se extinguiu
    if (def.kind === 'terminal') {
      if (def.id === 'collapse') collapsed = true
      else extinct = true
    } else active = [...active, { def: i, record, start: s.tick }]
  }

  return { active, eras, lastEnded, started, ended, extinct, collapsed }
}
