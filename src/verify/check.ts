import type { Crossing } from '../engine/crossing.ts'
import { totalOwed } from '../engine/debt.ts'
import {
  GOLDEN_CASES,
  GOLDEN_SCRIPTS,
  INHERITANCE_CASE,
  MERGE_CASE,
  mergeSeam,
  type GoldenCase,
  type InheritanceCase,
  type MergeCase,
} from '../engine/golden.ts'
import type { Decision, Status } from '../engine/state.ts'
import { Worldline } from '../engine/worldline.ts'

export interface GoldenResult extends GoldenCase {
  readonly computed: string
  readonly ok: boolean
}

export function runGoldenChecks(): GoldenResult[] {
  const worlds = new Map<string, Worldline>()
  return GOLDEN_CASES.map((golden) => {
    const key = `${golden.seed}/${golden.script}`
    let world = worlds.get(key)
    if (!world) {
      const plan = GOLDEN_SCRIPTS[golden.script]
      world = new Worldline(golden.seed, plan.decisions, null, plan.crossings)
      worlds.set(key, world)
    }
    if (world.present.tick < golden.year) world.advance(golden.year - world.present.tick)
    const computed = world.hashAt(golden.year)
    return { ...golden, computed, ok: computed === golden.hash }
  })
}

// FEAT: um presente de conhecimento que ninguém pesquisa nunca quita, e o ano é o do próprio colapso
export const COLLAPSE_DECISIONS: readonly Decision[] = [
  { tick: 0, allocation: { agriculture: 40, industry: 60, research: 0, conservation: 0 } },
]
export const COLLAPSE_CROSSINGS: readonly Crossing[] = [
  {
    tick: 0,
    kind: 'knowledge',
    dose: 3,
    amounts: [10],
    origin: { world: 'B', tick: 0 },
    cost: 9,
    direction: 'in',
  },
]

export interface CollapseCase {
  readonly seed: number
  readonly year: number
  readonly hash: string
}

export const COLLAPSE_CASE: CollapseCase = { seed: 482913, year: 280, hash: '56b2e732' }

export interface CollapseResult extends CollapseCase {
  readonly computed: string
  readonly status: Status
  readonly reached: number
  readonly ok: boolean
}

export function runCollapseCheck(): CollapseResult {
  const world = new Worldline(COLLAPSE_CASE.seed, COLLAPSE_DECISIONS, null, COLLAPSE_CROSSINGS)
  world.advance(COLLAPSE_CASE.year)
  const reached = world.present.tick
  const status = world.present.status
  const computed = world.hashAt(reached)
  return {
    ...COLLAPSE_CASE,
    computed,
    status,
    reached,
    ok: status === 'collapsed' && reached === COLLAPSE_CASE.year && computed === COLLAPSE_CASE.hash,
  }
}

export interface InheritanceResult extends InheritanceCase {
  readonly computed: string
  readonly status: Status
  readonly moved: number
  readonly settled: number
  readonly home: number | null
  readonly ok: boolean
}

// FEAT: prova a herança inteira, não só o hash: o ano da queda, o ano da casa nova, o corpo que
// virou lar e a cadeia causal que liga o momento à fundação da colônia que salvou a história
export function runInheritanceCheck(): InheritanceResult {
  const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
  const world = new Worldline(INHERITANCE_CASE.seed, plan.decisions, null, plan.crossings)
  world.advance(INHERITANCE_CASE.year)
  const moments = world.records.filter((record) => record.event === 'inheritance')
  const moved = moments.length === 1 ? (moments[0]?.start ?? -1) : -1
  const founding = moments[0]?.causes.flatMap((cause) =>
    cause.kind === 'event' && world.records[cause.record]?.event === 'colony_founded'
      ? [world.records[cause.record]?.start ?? -1]
      : [],
  )
  const settled = founding?.length === 1 ? (founding[0] ?? -1) : -1
  const computed = world.hashAt(Math.min(INHERITANCE_CASE.year, world.present.tick))
  return {
    ...INHERITANCE_CASE,
    computed,
    status: world.present.status,
    moved,
    settled,
    home: world.present.home,
    ok:
      world.present.status === 'running' &&
      world.present.tick === INHERITANCE_CASE.year &&
      moved === INHERITANCE_CASE.ended &&
      settled === INHERITANCE_CASE.founded &&
      world.present.home !== null &&
      computed === INHERITANCE_CASE.hash,
  }
}

export interface MergeResult extends MergeCase {
  readonly computed: string
  readonly status: Status
  readonly away: Status
  readonly seam: number
  readonly lived: number
  readonly settled: boolean
  readonly ok: boolean
}

// FEAT: prova a confluência inteira, não só o hash: o ano da costura, a história que deságua e para
// no mesmo ano, a dívida entre as duas que virou interna, e o fingerprint de quem recebeu
export function runMergeCheck(): MergeResult {
  const host = GOLDEN_SCRIPTS[MERGE_CASE.script]
  const guest = GOLDEN_SCRIPTS[MERGE_CASE.other]
  const receives = new Worldline(MERGE_CASE.seed, host.decisions, null, host.crossings)
  const departs = new Worldline(MERGE_CASE.seed, guest.decisions, null, guest.crossings)
  receives.advance(MERGE_CASE.tick)
  departs.advance(MERGE_CASE.tick)

  const owed = totalOwed(departs.present.debts)
  const seam = mergeSeam(departs.present)
  departs.merge(seam.departs)
  const lived = departs.advance(1)
  receives.merge(seam.receives)
  receives.advance(MERGE_CASE.year - MERGE_CASE.tick)

  const moments = receives.records.filter((record) => record.event === 'merge')
  const at = moments.length === 1 ? (moments[0]?.start ?? -1) : -1
  const settled = receives.records.some((record) => record.event === 'debt_settled')
  const computed = receives.hashAt(Math.min(MERGE_CASE.year, receives.present.tick))
  return {
    ...MERGE_CASE,
    computed,
    status: receives.present.status,
    away: departs.present.status,
    seam: at,
    lived,
    settled,
    ok:
      receives.present.status === 'running' &&
      receives.present.tick === MERGE_CASE.year &&
      receives.present.lastMerge?.tick === MERGE_CASE.tick &&
      departs.present.status === 'merged' &&
      departs.present.tick === MERGE_CASE.tick &&
      at === MERGE_CASE.tick &&
      lived === 0 &&
      owed > 0 &&
      settled &&
      totalOwed(receives.present.debts) === 0 &&
      computed === MERGE_CASE.hash,
  }
}
