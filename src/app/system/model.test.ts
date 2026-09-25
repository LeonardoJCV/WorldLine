import { describe, expect, it } from 'vitest'
import { colonisable, system } from '../../engine/system.ts'
import { Channel } from '../../engine/rng.ts'
import { bodyName } from '../views/colonies.ts'
import { STRIDE, SYSTEM_CHANNEL, systemPlacement } from './model.ts'

describe('systemPlacement', () => {
  it('places every body the engine generated, and only those', () => {
    for (const seed of [1, 2, 3, 482913, 999999]) {
      expect(systemPlacement(seed, null, []).bodies.map((b) => b.index)).toEqual(
        system(seed).map((b) => b.index),
      )
    }
  })

  it('is deterministic for a seed', () => {
    expect(systemPlacement(482913, null, [])).toEqual(systemPlacement(482913, null, []))
  })

  it('gives different bodies different angles, so they do not line up', () => {
    const angles = systemPlacement(482913, null, []).bodies.map((b) => b.angle)
    expect(new Set(angles).size).toBe(angles.length)
  })

  it('keeps every angle inside one turn', () => {
    for (const seed of [1, 7, 482913]) {
      for (const body of systemPlacement(seed, null, []).bodies) {
        expect(body.angle).toBeGreaterThanOrEqual(0)
        expect(body.angle).toBeLessThan(Math.PI * 2)
      }
    }
  })

  it('before any inheritance, the natal body is the one the history lives on', () => {
    const placed = systemPlacement(482913, null, [])
    const living = placed.bodies.filter((b) => b.living)
    expect(living).toHaveLength(1)
    expect(living[0]?.natal).toBe(true)
    expect(placed.bodies.some((b) => b.dead)).toBe(false)
  })

  it('after an inheritance, the natal body is dead and the heir is alive', () => {
    const natal = system(482913).findIndex((b) => b.home)
    const heir = system(482913).findIndex((b) => colonisable(b))
    const placed = systemPlacement(482913, heir, [])
    expect(placed.home).toBe(heir)
    expect(placed.bodies[heir]?.living).toBe(true)
    expect(placed.bodies[heir]?.dead).toBe(false)
    expect(placed.bodies[natal]?.dead).toBe(true)
    expect(placed.bodies[natal]?.living).toBe(false)
  })

  it('hangs each colony on the body it settled', () => {
    const target = system(482913).find((b) => colonisable(b))
    const colony = {
      body: target?.index ?? 0,
      founded: 1803,
      population: 5000,
      support: 0.5,
      record: 0,
    }
    const placed = systemPlacement(482913, null, [colony])
    expect(placed.bodies[colony.body]?.colony).toEqual(colony)
    expect(placed.bodies.filter((b) => b.colony !== null)).toHaveLength(1)
  })

  it('never marks a body both living and dead', () => {
    for (const home of [null, 0, 1, 2]) {
      for (const body of systemPlacement(482913, home, []).bodies) {
        expect(body.living && body.dead).toBe(false)
      }
    }
  })

  it('spans far enough to hold the outermost body', () => {
    const placed = systemPlacement(482913, null, [])
    const far = Math.max(...placed.bodies.map((b) => b.distance))
    // FIX: todo raio é estritamente positivo — sem a soma do disco, span cairia em far e a asserção falharia
    expect(placed.span).toBeGreaterThan(far)
  })

  it('names each body as the state panel names it', () => {
    const placed = systemPlacement(482913, null, [])
    for (const body of placed.bodies) expect(body.name).toBe(bodyName(482913, body.index))
  })

  it('draws from a channel reserve that touches neither the engine nor the planet palette', () => {
    const used = new Set<number>()
    for (let i = 0; i < 6; i++)
      for (let k = 0; k < STRIDE; k++) used.add(SYSTEM_CHANNEL + i * STRIDE + k)
    for (let k = 0; k <= 8; k++) expect(used.has(4096 + k)).toBe(false)
    for (const channel of Object.values(Channel)) expect(used.has(channel as number)).toBe(false)
  })
})
