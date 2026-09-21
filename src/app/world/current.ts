import { MODEL_VERSION } from '../../engine/params.ts'
import type { SimulationState } from '../sim/store.ts'
import type { MultiverseLink } from './link.ts'

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
    branches: rest.map((world) => ({
      parent: state.worlds.findIndex((candidate) => candidate.info.id === world.info.parent),
      fork: world.info.fork,
      decisions: world.decisions.filter((decision) => decision.tick >= world.info.fork),
    })),
  }
}
