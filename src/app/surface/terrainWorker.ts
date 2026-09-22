import { planetPalette } from '../planet/uniforms.ts'
import { buildChunk } from './chunk.ts'
import { parseKey } from './cube.ts'
import { bakeMap, createTerrain, type Terrain } from './terrain.ts'

export type TerrainRequest =
  | {
      readonly type: 'chunk'
      readonly id: number
      readonly seed: number
      readonly key: string
      readonly resolution: number
    }
  | {
      readonly type: 'map'
      readonly id: number
      readonly seed: number
      readonly width: number
      readonly height: number
    }

export type TerrainReply =
  | {
      readonly type: 'chunk'
      readonly id: number
      readonly key: string
      readonly positions: Float32Array
      readonly normals: Float32Array
      readonly colors: Float32Array
    }
  | {
      readonly type: 'map'
      readonly id: number
      readonly width: number
      readonly height: number
      readonly data: Float32Array
    }
  | { readonly type: 'error'; readonly id: number; readonly message: string }

export interface Handled {
  readonly reply: TerrainReply
  readonly transfer: Transferable[]
}

export function createTerrainHandler(): (request: TerrainRequest) => Handled {
  let cached: Terrain | null = null
  const terrainFor = (seed: number): Terrain => {
    if (cached?.seed !== seed) cached = createTerrain(seed, planetPalette(seed))
    return cached
  }
  const validateKey = (text: string): void => {
    const parts = text.split('/')
    if (parts.length !== 4) throw new RangeError('invalid chunk key format')
    const nums = parts.map(Number)
    const face = nums[0] ?? NaN
    const level = nums[1] ?? NaN
    const x = nums[2] ?? NaN
    const y = nums[3] ?? NaN
    if (!Number.isInteger(face) || face < 0 || face > 5) throw new RangeError('invalid face')
    if (!Number.isInteger(level) || level < 0) throw new RangeError('invalid level')
    if (!Number.isInteger(x) || x < 0 || x >= 2 ** level) throw new RangeError('invalid x')
    if (!Number.isInteger(y) || y < 0 || y >= 2 ** level) throw new RangeError('invalid y')
  }
  return (request) => {
    try {
      if (request.type === 'chunk') {
        if (!Number.isInteger(request.resolution) || request.resolution < 1) {
          throw new RangeError('invalid chunk resolution')
        }
        validateKey(request.key)
        const mesh = buildChunk(terrainFor(request.seed), parseKey(request.key), request.resolution)
        return {
          reply: { type: 'chunk', id: request.id, ...mesh },
          transfer: [
            mesh.positions.buffer,
            mesh.normals.buffer,
            mesh.colors.buffer,
          ] as ArrayBuffer[],
        }
      }
      if (request.type === 'map') {
        if (!Number.isInteger(request.width) || !Number.isInteger(request.height)) {
          throw new RangeError('invalid map size')
        }
        const data = bakeMap(terrainFor(request.seed), request.width, request.height)
        return {
          reply: {
            type: 'map',
            id: request.id,
            width: request.width,
            height: request.height,
            data,
          },
          transfer: [data.buffer as ArrayBuffer],
        }
      }
      throw new RangeError(
        `unknown request type: ${String((request as Record<string, unknown>).type)}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { reply: { type: 'error', id: request.id, message }, transfer: [] }
    }
  }
}
