import { describe, expect, it } from 'vitest'
import { TerrainClient, inProcessTerrainPort, type TerrainPort } from './terrainClient.ts'

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

  it('rejects all pending requests when worker fails', async () => {
    let failure: ((message: string) => void) | undefined
    const port: TerrainPort = {
      send: () => {},
      listen: (_handler, onFailure) => {
        failure = onFailure
      },
    }
    const client = new TerrainClient(port)
    const p1 = client.chunk(1, '0/0/0/0', 4)
    const p2 = client.map(1, 8, 4)
    await new Promise((r) => setTimeout(r, 0))
    if (failure) failure('worker crashed')
    await expect(p1).rejects.toThrow('worker crashed')
    await expect(p2).rejects.toThrow('worker crashed')
    await expect(client.chunk(1, '0/0/0/0', 4)).rejects.toThrow('worker crashed')
  })
})
