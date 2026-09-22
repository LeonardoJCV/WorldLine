import { describe, expect, it } from 'vitest'
import type { FromWorker } from '../../worker/protocol.ts'
import { SimulationClient } from './client.ts'
import { connectInProcess, flush } from './testing.ts'

describe('SimulationClient', () => {
  it('delivers progress messages to subscribers', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    client.open(482913, 0, [], [])
    await flush()
    expect(received.map((m) => m.type)).toEqual(['progress'])
  })

  it('resolves range and inspect requests without notifying subscribers', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    client.open(482913, 0, [], [])
    client.step(40)
    const [range, snapshot] = await Promise.all([
      client.range('A', 0, 40, 8),
      client.inspect('A', 12),
    ])
    expect(range.series.economy).toHaveLength(8)
    expect(snapshot.tick).toBe(12)
    expect(received.every((m) => m.type === 'progress')).toBe(true)
  })

  it('rejects a request the worker could not answer', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    await expect(client.inspect('A', 3)).rejects.toThrow('no worldline created')
  })

  it('stops notifying after unsubscribe', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    const unsubscribe = client.subscribe((message) => received.push(message))
    unsubscribe()
    client.open(1, 0, [], [])
    await flush()
    expect(received).toEqual([])
  })

  it('rejects pending requests and notifies subscribers when the worker fails', async () => {
    const { port, fail } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    const inspecting = client.inspect('A', 3)
    fail('crashed')
    await expect(inspecting).rejects.toThrow('crashed')
    expect(received).toContainEqual({ type: 'error', message: 'crashed' })
  })

  it('resolves branch and distance requests', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    client.open(482913, 0, [], [])
    client.step(60)
    const id = await client.branch('A', 20, {
      agriculture: 5,
      industry: 50,
      research: 40,
      conservation: 5,
    })
    expect(id).toBe('B')
    const distance = await client.distance('B', 'A', 0, 60, 6)
    expect(distance.values).toHaveLength(6)
  })

  it('resolves a crossing request', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    client.open(482913, 0, [], [])
    client.step(2000)
    const id = await client.branch('A', 100, {
      agriculture: 40,
      industry: 30,
      research: 20,
      conservation: 10,
    })
    const crossing = await client.cross('A', id, 'knowledge', 1)
    expect(crossing).toMatchObject({ kind: 'knowledge', dose: 1, direction: 'in' })
    expect(crossing.amounts[0]).toBeGreaterThan(0)
    expect(received.every((m) => m.type === 'progress')).toBe(true)
  })

  it('resolves a crossBranch request into the new worldline', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    client.open(482913, 0, [], [])
    client.step(2000)
    const id = await client.branch('A', 100, {
      agriculture: 40,
      industry: 30,
      research: 20,
      conservation: 10,
    })
    const crossed = await client.crossBranch(id, 500, 'A', 'knowledge', 1)
    expect(crossed).toBe('C')
  })

  it('rejects a crossBranch the worker refuses', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    client.open(482913, 0, [], [])
    client.step(2000)
    const id = await client.branch('A', 100, {
      agriculture: 40,
      industry: 30,
      research: 20,
      conservation: 10,
    })
    await expect(client.crossBranch(id, 500, 'A', 'people', 1)).rejects.toThrow(/people/)
  })

  it('rejects a crossing the worker refuses', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    client.open(482913, 0, [], [])
    client.step(10)
    await expect(client.cross('A', 'A', 'doctrine', 1)).rejects.toThrow(/same worldline/)
  })
})
