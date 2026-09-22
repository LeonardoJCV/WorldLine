import { TerrainClient, workerTerrainPort, type TerrainMap } from './terrainClient.ts'

export const MAP_WIDTH = 512
export const MAP_HEIGHT = 256
const MAP_CACHE = 6

let shared: TerrainClient | null = null
const maps = new Map<number, Promise<TerrainMap>>()

export function terrainClient(): TerrainClient {
  shared ??= new TerrainClient(
    workerTerrainPort(
      new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' }),
    ),
  )
  return shared
}

export function terrainMap(seed: number): Promise<TerrainMap> {
  const known = maps.get(seed)
  if (known) return known
  const next = terrainClient().map(seed, MAP_WIDTH, MAP_HEIGHT)
  maps.set(seed, next)
  if (maps.size > MAP_CACHE) {
    const oldest = maps.keys().next().value
    if (oldest !== undefined) maps.delete(oldest)
  }
  next.catch(() => {
    if (maps.get(seed) === next) maps.delete(seed)
  })
  return next
}
