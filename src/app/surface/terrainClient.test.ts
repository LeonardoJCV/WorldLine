import { describe, expect, it } from 'vitest'
import { TerrainClient, inProcessTerrainPort } from './terrainClient.ts'

describe('TerrainClient', () => {
  it('resolves chunk and map requests by id', async () => {
    const client = new TerrainClient(inProcessTerrainPort())
    const [chunk, map] = await Promise.all([
      client.chunk(482913, '2/2/1/3', 4),
      client.map(482913, 8, 4),
    ])
    expect(chunk.key).toBe('2/2/1/3')
    expect(map.data.length).toBe(8 * 4 * 4)
  })

  it('rejects failed requests', async () => {
    const client = new TerrainClient(inProcessTerrainPort())
    await expect(client.chunk(1, '4/1/0/0', 0)).rejects.toThrow()
  })
})
