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

  it('bakes a map and transfers its buffer', () => {
    const handle = createTerrainHandler()
    const { reply, transfer } = handle({ type: 'map', id: 2, seed: 7, width: 8, height: 4 })
    expect(reply).toMatchObject({ type: 'map', id: 2, width: 8, height: 4 })
    if (reply.type === 'map') expect(reply.data.length).toBe(8 * 4 * 4)
    expect(transfer).toHaveLength(1)
  })

  it('reports malformed requests without throwing', () => {
    const handle = createTerrainHandler()
    const { reply } = handle({ type: 'chunk', id: 3, seed: 1, key: '4/1/0/0', resolution: 0 })
    expect(reply).toMatchObject({ type: 'error', id: 3 })
  })

  it('reports malformed chunk keys', () => {
    const handle = createTerrainHandler()
    const tests = [
      { key: '6/0/0/0', reason: 'face out of range' },
      { key: '0/-1/0/0', reason: 'negative level' },
      { key: '0/1/2/0', reason: 'x out of range' },
      { key: '0/1/0/2', reason: 'y out of range' },
      { key: '0/0', reason: 'wrong format' },
    ]
    for (const { key } of tests) {
      const { reply } = handle({ type: 'chunk', id: 4, seed: 1, key, resolution: 2 })
      expect(reply.type).toBe('error')
    }
  })

  it('finds sites and builds object tiles', () => {
    const handle = createTerrainHandler()
    const sites = handle({ type: 'sites', id: 5, seed: 482913 })
    expect(sites.reply.type).toBe('sites')
    if (sites.reply.type !== 'sites') return
    expect(sites.reply.data.length % 6).toBe(0)
    expect(sites.transfer).toHaveLength(1)
    const objects = handle({ type: 'objects', id: 6, seed: 482913, key: '4/6/40/12', density: 1 })
    expect(objects.reply.type).toBe('objects')
    if (objects.reply.type !== 'objects') return
    expect(objects.transfer.length).toBe(7)
  })

  it('rejects object tiles at the wrong level', () => {
    const handle = createTerrainHandler()
    const { reply } = handle({ type: 'objects', id: 7, seed: 1, key: '4/3/0/0', density: 1 })
    expect(reply).toMatchObject({ type: 'error', id: 7 })
  })
})
