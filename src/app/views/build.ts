import { Era, type EraValue } from '../../engine/state.ts'
import {
  FACTOR_KEYS,
  PRESENTATION_ORDER,
  TERM_KEYS,
  WORKS,
  isCommissionable,
  type WorkId,
  type WorkKey,
} from '../../engine/work.ts'
import type { Snapshot } from '../../worker/protocol.ts'

export type WorkState = 'done' | 'building' | 'open' | 'locked'

export interface WorkRow {
  readonly def: number
  readonly id: WorkId
  readonly era: number
  readonly state: WorkState
  readonly years: number | null
  readonly missing: readonly WorkId[]
}

export function buildView(snapshot: Snapshot): readonly WorkRow[] {
  const site = snapshot.building
  const standing = new Set(snapshot.works.map((work) => WORKS[work.def]?.id))
  const rows: WorkRow[] = []
  // FEAT: a ordem vem do motor, que já garante que nenhuma obra aparece antes de um pré-requisito seu
  for (const def of PRESENTATION_ORDER) {
    const work = WORKS[def]
    if (work === undefined) continue
    const done = standing.has(work.id)
    const building = site !== null && site.def === def
    // FEAT: a condição de encomendar é de `isCommissionable`; o canteiro aberto é a ÚNICA recusa
    // que a tela acrescenta, porque o motor aceitaria trocar de obra e perder o que já está de pé
    const state: WorkState = done
      ? 'done'
      : building
        ? 'building'
        : isCommissionable(snapshot, def)
          ? 'open'
          : 'locked'
    const progress = building ? site.progress : 0
    // FIX: a guarda é `> 0` e não `<= 0` porque uma taxa NaN escapa da segunda e chega à tela
    const years =
      !done && snapshot.rate > 0 ? Math.ceil((work.cost - progress) / snapshot.rate) : null
    rows.push({
      def,
      id: work.id,
      era: work.era,
      state,
      years,
      missing: work.needs.filter((need) => !standing.has(need)),
    })
  }
  return rows
}

export const ERAS: readonly EraValue[] = [
  Era.agricultural,
  Era.classical,
  Era.industrial,
  Era.electric,
  Era.space,
]

export interface EraGroup {
  readonly era: EraValue
  readonly open: boolean
  readonly rows: readonly WorkRow[]
}

export function buildGroups(snapshot: Snapshot): readonly EraGroup[] {
  const rows = buildView(snapshot)
  return ERAS.map((era) => ({
    era,
    open: (snapshot.eras & era) !== 0,
    rows: rows.filter((row) => row.era === era),
  }))
}

export interface WorkEffect {
  readonly key: WorkKey
  readonly kind: 'factor' | 'term'
  readonly value: number
}

// FEAT: o efeito sai do próprio catálogo, então nenhuma frase escrita à mão pode discordar do número
export function effectsOf(def: number): readonly WorkEffect[] {
  const effect = WORKS[def]?.effect
  if (effect === undefined) return []
  const changes: WorkEffect[] = []
  for (const key of FACTOR_KEYS) {
    const value = effect[key]
    if (value !== undefined) changes.push({ key, kind: 'factor', value })
  }
  for (const key of TERM_KEYS) {
    const value = effect[key]
    if (value !== undefined) changes.push({ key, kind: 'term', value })
  }
  return changes
}

// FEAT: quanto da obra em curso já está de pé, entre 0 e 1; null quando não há canteiro aberto
export function siteProgress(snapshot: Snapshot): number | null {
  const site = snapshot.building
  if (site === null) return null
  const cost = WORKS[site.def]?.cost
  if (cost === undefined || cost <= 0) return null
  return site.progress / cost
}
