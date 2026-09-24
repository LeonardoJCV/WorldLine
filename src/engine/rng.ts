export const Channel = { harvest: 1, genesis: 16, event: 64, space: 256 } as const

function fmix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export function hash32(seed: number, tick: number, channel: number): number {
  let h = fmix32((seed ^ 0x9e3779b9) >>> 0)
  h = fmix32((h ^ Math.imul(tick | 0, 0x27d4eb2d)) >>> 0)
  return fmix32((h ^ Math.imul(channel | 0, 0x165667b1)) >>> 0)
}

export function uniform(seed: number, tick: number, channel: number): number {
  return hash32(seed, tick, channel) / 4294967296
}
