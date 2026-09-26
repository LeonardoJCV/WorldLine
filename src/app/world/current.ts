import type { Crossing } from '../../engine/crossing.ts'
import { MODEL_VERSION } from '../../engine/params.ts'
import { WORLDLINE_IDS, type MergeSpec } from '../../worker/protocol.ts'
import type { SimulationState, WorldView } from '../sim/store.ts'
import { SEAMED_VERSION, type MultiverseLink } from './link.ts'

type Worlds = readonly WorldView[]

// FEAT: o link nomeia os mundos pela posição, como o worker faz ao reabrir
function position(worlds: Worlds, id: string): string {
  return WORLDLINE_IDS[worlds.findIndex((candidate) => candidate.info.id === id)] ?? ''
}

function ownCrossings(worlds: Worlds, world: WorldView): Crossing[] {
  return world.crossings
    .filter((crossing) => crossing.tick >= world.info.fork)
    .map((crossing) => ({
      ...crossing,
      origin: { ...crossing.origin, world: position(worlds, crossing.origin.world) },
    }))
}

// FEAT: do recibo da costura só os nomes e o ano vão no link; o estado volta do replay da outra
function ownMerges(worlds: Worlds, world: WorldView): MergeSpec[] {
  return world.merges
    .filter((merge) => merge.tick >= world.info.fork)
    .map((merge) => ({
      tick: merge.tick,
      self: position(worlds, merge.self),
      other: position(worlds, merge.other),
      direction: merge.direction,
    }))
}

export function currentLink(
  state: Pick<SimulationState, 'seed' | 'now' | 'worlds'>,
): MultiverseLink | null {
  const [root, ...rest] = state.worlds
  if (state.seed === null || !root) return null
  const sewn = state.worlds.map((world) => ownMerges(state.worlds, world))
  const merges = sewn[0] ?? []
  // FEAT: a versão sobe só se alguma história tem costura própria para carregar
  const seamed = sewn.some((list) => list.length > 0)
  return {
    version: seamed ? SEAMED_VERSION : MODEL_VERSION,
    seed: state.seed,
    tick: state.now,
    decisions: root.decisions,
    crossings: ownCrossings(state.worlds, root),
    ...(merges.length === 0 ? {} : { merges }),
    branches: rest.map((world, i) => {
      const own = sewn[i + 1] ?? []
      return {
        parent: state.worlds.findIndex((candidate) => candidate.info.id === world.info.parent),
        fork: world.info.fork,
        decisions: world.decisions.filter((decision) => decision.tick >= world.info.fork),
        crossings: ownCrossings(state.worlds, world),
        ...(own.length === 0 ? {} : { merges: own }),
      }
    }),
  }
}
