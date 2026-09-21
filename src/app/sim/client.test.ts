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
    client.create(482913)
    await flush()
    expect(received.map((m) => m.type)).toEqual(['progress'])
  })

  it('resolves range and inspect requests without notifying subscribers', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    client.create(482913)
    client.step(40)
    const [range, snapshot] = await Promise.all([client.range(0, 40, 8), client.inspect(12)])
    expect(range.series.economy).toHaveLength(8)
    expect(snapshot.tick).toBe(12)
    expect(received.every((m) => m.type === 'progress')).toBe(true)
  })

  it('rejects a request the worker could not answer', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    await expect(client.inspect(3)).rejects.toThrow('no worldline created')
  })

  it('stops notifying after unsubscribe', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    const unsubscribe = client.subscribe((message) => received.push(message))
    unsubscribe()
    client.create(1)
    await flush()
    expect(received).toEqual([])
  })

  it('rejects pending requests and notifies subscribers when the worker fails', async () => {
    const { port, fail } = connectInProcess()
    const client = new SimulationClient(port)
    const received: FromWorker[] = []
    client.subscribe((message) => received.push(message))
    const inspecting = client.inspect(3)
    fail('crashed')
    await expect(inspecting).rejects.toThrow('crashed')
    expect(received).toContainEqual({ type: 'error', message: 'crashed' })
  })
})
