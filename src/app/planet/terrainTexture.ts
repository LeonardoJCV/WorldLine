import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
} from 'three'
import type { TerrainMap } from '../surface/terrainClient.ts'

export function terrainTexture(map: TerrainMap): DataTexture {
  const halves = new Uint16Array(map.data.length)
  for (let i = 0; i < map.data.length; i++) halves[i] = DataUtils.toHalfFloat(map.data[i] ?? 0)
  const texture = new DataTexture(halves, map.width, map.height, RGBAFormat, HalfFloatType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
