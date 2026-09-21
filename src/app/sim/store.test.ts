import { describe, expect, it } from 'vitest'
import { HORIZON } from '../../engine/params.ts'
import { SimulationClient } from './client.ts'
import { createSimulationStore } from './store.ts'
import { connectInProcess, flush } from './testing.ts'

function setup() {
  const { port, clock } = connectInProcess()
  const store = createSimulationStore(new SimulationClient(port))
  return { store, clock }
}

describe('simulation store', () => {
  it('creates a world and shows year zero', async () => {
    const { store } = setup()
    store.getState().create(482913)
    await flush()
    expect(store.getState().seed).toBe(482913)
    expect(store.getState().present?.tick).toBe(0)
    expect(store.getState().playing).toBe(false)
  })

  it('plays and pauses', async () => {
    const { store, clock } = setup()
    store.getState().create(482913)
    await flush()
    store.getState().togglePlay()
    await flush()
    clock.advance(1000)
    await flush()
    expect(store.getState().playing).toBe(true)
    expect(store.getState().present?.tick).toBeGreaterThan(0)
    store.getState().togglePlay()
    await flush()
    expect(store.getState().playing).toBe(false)
  })

  it('applies a new speed while playing', async () => {
    const { store, clock } = setup()
    store.getState().create(482913)
    await flush()
    store.getState().togglePlay()
    await flush()
    store.getState().setSpeed(256)
    await flush()
    clock.advance(1000)
    await flush()
    expect(store.getState().speed).toBe(256)
    expect(store.getState().present?.tick).toBeGreaterThanOrEqual(200)
  })

  it('inspects a past year through the cursor and follows the present again', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(100)
    await flush()
    store.getState().setCursor(50)
    await flush()
    expect(store.getState().cursor).toBe(50)
    expect(store.getState().inspected?.tick).toBe(50)
    store.getState().setCursor(500)
    expect(store.getState().cursor).toBeNull()
    expect(store.getState().inspected).toBeNull()
  })

  it('collects event records by index', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(200)
    await flush()
    const events = store.getState().events
    expect(events.map((r) => r.event)).toContain('golden_age')
    expect(events.every((r) => r !== undefined)).toBe(true)
  })

  it('marks the end of the worldline and stops playing', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(HORIZON)
    await flush()
    expect(store.getState().ended).toBe('horizon')
    expect(store.getState().playing).toBe(false)
  })

  it('selects an event and moves the cursor to its start', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(200)
    await flush()
    const index = store.getState().events.findIndex((r) => r.event === 'golden_age')
    const start = store.getState().events[index]?.start
    store.getState().select(index)
    await flush()
    expect(store.getState().selected).toBe(index)
    expect(store.getState().cursor).toBe(start)
    expect(store.getState().inspected?.tick).toBe(start)
  })

  it('records decisions made at the present', async () => {
    const { store } = setup()
    const allocation = { agriculture: 60, industry: 20, research: 10, conservation: 10 }
    store.getState().create(482913)
    store.getState().step(30)
    await flush()
    store.getState().decide(allocation)
    await flush()
    expect(store.getState().decisions).toEqual([{ tick: 30, allocation }])
  })

  it('returns to the present when intervening', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(50)
    await flush()
    store.getState().setCursor(10)
    await flush()
    store.getState().setMode('intervene')
    expect(store.getState().mode).toBe('intervene')
    expect(store.getState().cursor).toBeNull()
  })

  it('starts a new world observing its whole history', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(50)
    await flush()
    store.getState().setView({ span: 20, end: 40 })
    store.getState().setMode('intervene')
    store.getState().select(0)
    store.getState().create(7)
    await flush()
    const state = store.getState()
    expect([state.mode, state.view, state.selected, state.decisions]).toEqual([
      'observe',
      null,
      null,
      [],
    ])
  })
})
