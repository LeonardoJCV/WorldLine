import { clamp } from './math.ts'
import { MAX_SEED } from './params.ts'
import { Channel, uniform } from './rng.ts'

export type BodyKind = 'rocky' | 'ice' | 'gas'

export interface Body {
  readonly index: number
  readonly kind: BodyKind
  readonly distance: number
  readonly habitability: number
  readonly home: boolean
}

const MIN_BODIES = 4
const MAX_BODIES = 6
const GAP_MIN = 0.6
const GAP_RANGE = 1.4
const HABITABLE_SPREAD = 3
const GAS_PROBABILITY = 0.35
const ICE_PROBABILITY = 0.3
const NOISE_FLOOR = 0.7
const NOISE_RANGE = 0.3

interface Draft {
  readonly kind: BodyKind
  readonly distance: number
}

function kindOf(roll: number): BodyKind {
  if (roll < GAS_PROBABILITY) return 'gas'
  if (roll < GAS_PROBABILITY + ICE_PROBABILITY) return 'ice'
  return 'rocky'
}

export function system(seed: number): readonly Body[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer between 0 and ${MAX_SEED}`)
  }
  const draw = (offset: number) => uniform(seed, 0, Channel.space + offset)
  const count = MIN_BODIES + Math.floor(draw(0) * (MAX_BODIES - MIN_BODIES + 1))
  const homeIndex = Math.floor(draw(1) * count)

  const drafts: Draft[] = []
  let distance = 0
  for (let i = 0; i < count; i++) {
    const base = 2 + i * 3
    let kind = kindOf(draw(base))
    // FEAT: o corpo natal nunca é gasoso, pois é onde a civilização nasceu
    if (i === homeIndex && kind === 'gas') kind = 'rocky'
    distance += GAP_MIN + draw(base + 1) * GAP_RANGE
    drafts.push({ kind, distance })
  }

  // FEAT: a zona habitável é centrada na órbita natal, então ela sempre vence
  const homeDistance = drafts[homeIndex]?.distance ?? 0
  return drafts.map((draft, i) => {
    const raw =
      draft.kind === 'gas'
        ? 0
        : clamp(1 - Math.abs(draft.distance - homeDistance) / HABITABLE_SPREAD, 0, 1)
    const noise = NOISE_FLOOR + draw(2 + i * 3 + 2) * NOISE_RANGE
    return {
      index: i,
      kind: draft.kind,
      distance: draft.distance,
      habitability: i === homeIndex ? raw : raw * noise,
      home: i === homeIndex,
    }
  })
}

export function colonisable(body: Body): boolean {
  return body.kind !== 'gas' && !body.home
}
