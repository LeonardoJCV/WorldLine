import { GOLDEN_CASES, GOLDEN_SCRIPTS, type GoldenCase } from '../engine/golden.ts'
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
      world = new Worldline(golden.seed, GOLDEN_SCRIPTS[golden.script])
      worlds.set(key, world)
    }
    if (world.present.tick < golden.year) world.advance(golden.year - world.present.tick)
    const computed = world.hashAt(golden.year)
    return { ...golden, computed, ok: computed === golden.hash }
  })
}
