import type { Crossing } from '../../engine/crossing.ts'
import { MODEL_VERSION } from '../../engine/params.ts'
import { WORLDLINE_IDS } from '../../worker/protocol.ts'
import type { SimulationState, WorldView } from '../sim/store.ts'
import type { MultiverseLink } from './link.ts'

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

export function currentLink(
  state: Pick<SimulationState, 'seed' | 'now' | 'worlds'>,
): MultiverseLink | null {
  const [root, ...rest] = state.worlds
  if (state.seed === null || !root) return null
  return {
    version: MODEL_VERSION,
    seed: state.seed,
    tick: state.now,
    decisions: root.decisions,
    crossings: ownCrossings(state.worlds, root),
    branches: rest.map((world) => ({
      parent: state.worlds.findIndex((candidate) => candidate.info.id === world.info.parent),
      fork: world.info.fork,
      decisions: world.decisions.filter((decision) => decision.tick >= world.info.fork),
      crossings: ownCrossings(state.worlds, world),
    })),
  }
}
