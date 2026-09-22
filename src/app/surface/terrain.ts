import { uniform } from '../../engine/rng.ts'
import type { PlanetPalette } from '../planet/uniforms.ts'
import { hexToRgb, mixRgb, type Rgb } from '../theme/color.ts'
import { fbm } from './noise.ts'

export const BIOMES = ['ocean', 'ice', 'tundra', 'rock', 'desert', 'forest', 'grassland'] as const
export type Biome = (typeof BIOMES)[number]

export const SEA = 0.5
export const RELIEF = 0.1
export const FLOOR_GAP = 0.002
export const FLOOR_DEPTH = 0.06
const CHANNEL = 4096 + 32

export interface TerrainSample {
  readonly height: number
  readonly moisture: number
  readonly temperature: number
  readonly biome: Biome
}

export interface Terrain {
  readonly seed: number
  sample(x: number, y: number, z: number): TerrainSample
  color(sample: TerrainSample): Rgb
}

const TUNDRA = hexToRgb('#9aa38b')
const ROCK = hexToRgb('#8a7f78')
const GRASS = hexToRgb('#8fbf5a')
const FOREST_SHADE = hexToRgb('#1f5a34')
const SHALLOW = hexToRgb('#3fc1c9')
const DEEP = hexToRgb('#0b1a3d')

export function surfaceRadius(height: number): number {
  if (height >= SEA) return 1 + (height - SEA) * RELIEF
  return 1 - FLOOR_GAP - Math.min(SEA - height, 0.2) * FLOOR_DEPTH
}

function biomeOf(height: number, moisture: number, temperature: number): Biome {
  if (height < SEA) return 'ocean'
  if (temperature < 0.06) return 'ice'
  if (temperature < 0.2) return 'tundra'
  if (height - SEA > 0.2) return 'rock'
  if (moisture < 0.4 && temperature > 0.45) return 'desert'
  if (moisture > 0.52) return 'forest'
  return 'grassland'
}

export function createTerrain(seed: number, palette: PlanetPalette): Terrain {
  const ox = uniform(seed, 0, CHANNEL) * 100
  const oy = uniform(seed, 0, CHANNEL + 1) * 100
  const oz = uniform(seed, 0, CHANNEL + 2) * 100
  const noiseSeed = Math.floor(uniform(seed, 0, CHANNEL + 3) * 2147483647)
  const moistSeed = noiseSeed ^ 0x5bd1e995
  const colors: Readonly<Record<Exclude<Biome, 'ocean'>, Rgb>> = {
    ice: palette.snow,
    tundra: TUNDRA,
    rock: ROCK,
    desert: palette.arid,
    forest: mixRgb(palette.vegetation, FOREST_SHADE, 0.45),
    grassland: mixRgb(palette.vegetation, GRASS, 0.55),
  }
  return {
    seed,
    sample(x, y, z) {
      // FIX: persistência maior dá peso perceptível às oitavas finas (relevo no nível região)
      const height = fbm(noiseSeed, x * 1.9 + ox, y * 1.9 + oy, z * 1.9 + oz, 9, 0.62)
      const moisture = fbm(moistSeed, x * 3.1 + oy, y * 3.1 + oz, z * 3.1 + ox, 4)
      const temperature = 1 - Math.abs(y) * 1.15 - Math.max(height - SEA, 0) * 2.2
      return { height, moisture, temperature, biome: biomeOf(height, moisture, temperature) }
    },
    color(sample) {
      if (sample.biome === 'ocean') {
        return mixRgb(SHALLOW, DEEP, Math.min((SEA - sample.height) / 0.12, 1))
      }
      const base = colors[sample.biome]
      const shade = 0.88 + ((sample.height * 97) % 1) * 0.12
      return [base[0] * shade, base[1] * shade, base[2] * shade]
    },
  }
}

export function bakeMap(terrain: Terrain, width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4)
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height) * Math.PI - Math.PI / 2
    const cl = Math.cos(lat)
    const sl = Math.sin(lat)
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2 - Math.PI
      const s = terrain.sample(cl * Math.cos(lon), sl, cl * Math.sin(lon))
      const c = terrain.color(s)
      data.set([c[0], c[1], c[2], s.height], (j * width + i) * 4)
    }
  }
  return data
}
