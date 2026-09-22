import { describe, expect, it } from 'vitest'
import { createTerrainHandler } from './terrainWorker.ts'

describe('terrain handler', () => {
  it('builds a chunk and transfers its buffers', () => {
    const handle = createTerrainHandler()
    const { reply, transfer } = handle({
      type: 'chunk',
      id: 1,
      seed: 482913,
      key: '4/1/0/0',
      resolution: 4,
    })
    expect(reply.type).toBe('chunk')
    if (reply.type !== 'chunk') return
    expect(reply.key).toBe('4/1/0/0')
    expect(reply.positions.length).toBe((4 * 4 * 2 + 4 * 4 * 2) * 9)
    expect(transfer).toHaveLength(3)
  })

  it('bakes a map', () => {
    const handle = createTerrainHandler()
    const { reply } = handle({ type: 'map', id: 2, seed: 7, width: 8, height: 4 })
    expect(reply).toMatchObject({ type: 'map', id: 2, width: 8, height: 4 })
    if (reply.type === 'map') expect(reply.data.length).toBe(8 * 4 * 4)
  })

  it('reports malformed requests without throwing', () => {
    const handle = createTerrainHandler()
    const { reply } = handle({ type: 'chunk', id: 3, seed: 1, key: '4/1/0/0', resolution: 0 })
    expect(reply).toMatchObject({ type: 'error', id: 3 })
  })
})
