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

  it('keeps the cursor on the observed year when entering Intervene', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(50)
    await flush()
    store.getState().setCursor(10)
    await flush()
    store.getState().setMode('intervene')
    expect(store.getState().mode).toBe('intervene')
    expect(store.getState().cursor).toBe(10)
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

  it('opens a shared world at its year with its decisions', async () => {
    const { store } = setup()
    const allocation = { agriculture: 60, industry: 20, research: 10, conservation: 10 }
    store.getState().open({
      version: 7,
      seed: 482913,
      tick: 120,
      decisions: [{ tick: 50, allocation }],
      branches: [],
    })
    await flush()
    const state = store.getState()
    expect(state.seed).toBe(482913)
    expect(state.present?.tick).toBe(120)
    expect(state.present?.allocation).toEqual(allocation)
    expect(state.decisions).toEqual([{ tick: 50, allocation }])
    expect(state.linkVersion).toBe(7)
  })

  it('branches from the observed year and focuses the new worldline', async () => {
    const { store } = setup()
    const starved = { agriculture: 5, industry: 50, research: 40, conservation: 5 }
    store.getState().create(482913)
    store.getState().step(100)
    await flush()
    store.getState().setCursor(40)
    await flush()
    store.getState().branch(starved)
    await flush()
    await flush()
    const state = store.getState()
    expect(state.worlds.map((w) => w.info.id)).toEqual(['A', 'B'])
    expect(state.focus).toBe('B')
    expect(state.cursor).toBeNull()
    expect(state.decisions).toEqual([{ tick: 40, allocation: starved }])
  })

  it('marks branching while the request is in flight, to guard against double clicks', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(100)
    await flush()
    store.getState().setCursor(40)
    await flush()
    expect(store.getState().branching).toBe(false)
    store.getState().branch({ agriculture: 5, industry: 50, research: 40, conservation: 5 })
    expect(store.getState().branching).toBe(true)
    await flush()
    await flush()
    expect(store.getState().branching).toBe(false)
  })

  it('shows the focused worldline and compares it with its origin', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(100)
    await flush()
    store.getState().setCursor(30)
    await flush()
    store.getState().branch({ agriculture: 5, industry: 50, research: 40, conservation: 5 })
    await flush()
    await flush()
    store.getState().setCursor(60)
    await flush()
    expect(store.getState().inspected?.tick).toBe(60)
    expect(store.getState().inspectedOrigin?.tick).toBe(60)
    store.getState().setFocus('A')
    expect(store.getState().present).toBe(store.getState().worlds[0]?.present)
  })

  it('returns to the original when the focused worldline is removed', async () => {
    const { store } = setup()
    store.getState().create(482913)
    store.getState().step(50)
    await flush()
    store.getState().setCursor(10)
    await flush()
    store.getState().branch({ agriculture: 5, industry: 50, research: 40, conservation: 5 })
    await flush()
    await flush()
    store.getState().remove('B')
    await flush()
    expect(store.getState().focus).toBe('A')
    expect(store.getState().worlds).toHaveLength(1)
  })
  it('keeps the credit and the crossings of each world', async () => {
    const { port } = connectInProcess()
    const client = new SimulationClient(port)
    const store = createSimulationStore(client)
    store.getState().create(482913)
    store.getState().step(2000)
    await flush()
    const before = store.getState().credit
    expect(before).toBeGreaterThan(0)
    const id = await client.branch('A', 100, {
      agriculture: 40,
      industry: 30,
      research: 20,
      conservation: 10,
    })
    const crossing = await client.cross('A', id, 'knowledge', 1)
    await flush()
    const state = store.getState()
    expect(state.worlds.find((w) => w.info.id === id)?.crossings).toEqual([crossing])
    expect(state.worlds.find((w) => w.info.id === 'A')?.crossings).toEqual([])
    expect(state.credit).toBe(before + 4 - crossing.cost)
  })
})
