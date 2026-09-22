import type { Tier } from '../graphics/settings.ts'
import { ALTITUDE, LEVEL_ALTITUDE } from './camera.ts'

export interface Lod {
  readonly maxDepth: number
  readonly resolution: number
  readonly error: number
  readonly budget: number
  readonly cached: number
  readonly minAltitude: number
  readonly regionAltitude: number
}

export const MAX_DEPTH: Readonly<Record<Tier, number>> = { low: 5, high: 7, ultra: 9 }
export const RESOLUTION: Readonly<Record<Tier, number>> = { low: 16, high: 24, ultra: 32 }
export const PIXEL_ERROR: Readonly<Record<Tier, number>> = { low: 90, high: 60, ultra: 40 }
export const BUDGET: Readonly<Record<Tier, number>> = { low: 160, high: 320, ultra: 520 }

export function lodOf(tier: Tier): Lod {
  // FIX: o menor triângulo que o nível resolve limita o quanto a câmera desce
  const scale = Math.max(
    1,
    2 ** (MAX_DEPTH.high - MAX_DEPTH[tier]) * (RESOLUTION.high / RESOLUTION[tier]),
  )
  const minAltitude = ALTITUDE.min * scale
  return {
    maxDepth: MAX_DEPTH[tier],
    resolution: RESOLUTION[tier],
    error: PIXEL_ERROR[tier],
    budget: BUDGET[tier],
    cached: Math.ceil(BUDGET[tier] * 1.5),
    minAltitude,
    regionAltitude: Math.max(LEVEL_ALTITUDE.region, minAltitude * 2),
  }
}

export function focalPixels(viewportHeight: number, fovDegrees: number): number {
  return viewportHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360))
}
