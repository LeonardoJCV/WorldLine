import { uniform } from '../../engine/rng.ts'
import { Era } from '../../engine/state.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { hexToRgb, mixRgb, type Rgb } from '../theme/color.ts'

export interface PlanetPalette {
  readonly offset: readonly [number, number, number]
  readonly seaLevel: number
  readonly oceanDeep: Rgb
  readonly oceanShallow: Rgb
  readonly vegetation: Rgb
  readonly arid: Rgb
  readonly snow: Rgb
  readonly atmosphere: Rgb
  readonly smog: Rgb
  readonly tilt: number
}

export interface PlanetState {
  readonly vegetation: number
  readonly lights: number
  readonly haze: number
  readonly ring: number
  readonly satellites: number
  readonly famine: number
  readonly blight: number
  readonly unrest: number
  readonly extinct: number
  readonly clouds: number
}

export const MAX_SATELLITES = 12
export const CAMERA_DISTANCE = 6
export const CAMERA_FOV = 30
export const PLANET_BODY = 1 / (CAMERA_DISTANCE * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180))
export const PLANET_LIGHT: readonly [number, number, number] = [-0.65, 0.35, 0.68]
const VISUAL_CHANNEL = 4096

const TEAL = hexToRgb('#1fa58a')
const ROSE = hexToRgb('#e86ba6')
const OCHRE = hexToRgb('#b98a4e')
const RUST = hexToRgb('#8a4a2f')
const DEEP = hexToRgb('#0b1a3d')
const VIOLET_SEA = hexToRgb('#2a1850')
const SHALLOW = hexToRgb('#1f5f8a')
const HAZE = hexToRgb('#3a2a6b')
const SKY = hexToRgb('#6fd3ff')
const LAVENDER = hexToRgb('#c9aeff')
const SMOG = hexToRgb('#b0703a')
const SNOW = hexToRgb('#e6e4f5')

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = unit((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function planetPalette(seed: number): PlanetPalette {
  const draw = (k: number) => uniform(seed, 0, VISUAL_CHANNEL + k)
  const sea = draw(4)
  const hue = draw(5)
  return {
    offset: [draw(0) * 100, draw(1) * 100, draw(2) * 100],
    seaLevel: 0.44 + draw(3) * 0.12,
    oceanDeep: mixRgb(DEEP, VIOLET_SEA, sea),
    oceanShallow: mixRgb(SHALLOW, HAZE, sea * 0.6),
    vegetation: mixRgb(TEAL, ROSE, hue < 0.5 ? hue * 0.3 : 1 - (1 - hue) * 0.3),
    arid: mixRgb(OCHRE, RUST, draw(6)),
    snow: SNOW,
    atmosphere: mixRgb(SKY, LAVENDER, draw(7)),
    smog: SMOG,
    tilt: 0.2 + draw(8) * 0.25,
  }
}

export function planetState(snapshot: Snapshot): PlanetState {
  const { values } = snapshot
  const extinct = snapshot.status === 'extinct' ? 1 : 0
  const clean = 0.85 * smoothstep(40, 90, values.technology)
  return {
    vegetation: extinct ? 0 : unit(values.environment / 100),
    lights: extinct ? 0 : unit((Math.log10(Math.max(values.population, 1)) - 5) / 3),
    haze: unit((values.energy / 12) * (1 - clean) + (1 - values.environment / 100) * 0.3),
    ring: (snapshot.eras & Era.industrial) !== 0 ? 1 : 0,
    satellites:
      values.technology > 70
        ? Math.round(((Math.min(values.technology, 100) - 70) / 30) * MAX_SATELLITES)
        : 0,
    famine: snapshot.active.includes('famine') ? 1 : 0,
    blight: snapshot.active.includes('ecological_crisis') ? 1 : 0,
    unrest: snapshot.active.includes('civil_unrest') ? 1 : 0,
    extinct,
    clouds: extinct ? 0.15 : 0.3 + 0.5 * unit(values.environment / 100),
  }
}
