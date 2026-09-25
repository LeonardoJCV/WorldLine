import { describe, expect, it } from 'vitest'
import { EVENTS } from '../../engine/events.ts'
import { colonisable, system, type BodyKind } from '../../engine/system.ts'
import { Channel } from '../../engine/rng.ts'
import { bodyName } from '../views/colonies.ts'
import { CLEARANCE, STAR_RADIUS, STRIDE, SYSTEM_CHANNEL, systemPlacement } from './model.ts'

// FEAT: a varredura vai do zero para cima, com as duas sementes das capturas dentro dela
const SWEEP = 20_000

function radiusOfKind(kind: BodyKind): number {
  for (let seed = 0; seed < 200; seed++) {
    const body = systemPlacement(seed, null, []).bodies.find((b) => b.kind === kind)
    if (body) return body.radius
  }
  throw new Error(`no ${kind} body in the first two hundred seeds`)
}

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

    // FEAT: os canais que o motor SORTEIA, não as quatro bases de Channel — a colisão mora nas somas
    const engine = new Set<number>([Channel.harvest])
    for (let k = 0; k <= 4; k++) engine.add(Channel.genesis + k)
    for (let i = 0; i < EVENTS.length; i++) engine.add(Channel.event + i)
    const most = Math.max(...[0, 1, 2, 3, 7, 4242, 482913, 999999].map((s) => system(s).length))
    expect(most).toBe(6)
    for (let k = 0; k <= 2 + (most - 1) * 3 + 2; k++) engine.add(Channel.space + k)
    expect(engine.has(275)).toBe(true)

    for (const channel of engine) expect(used.has(channel)).toBe(false)
    for (let k = 0; k <= 8; k++) expect(used.has(4096 + k)).toBe(false)
  })

  it('never draws a body inside the star, on any seed', () => {
    let worst = Infinity
    let worstSeed = -1
    for (let seed = 0; seed < SWEEP; seed++) {
      for (const body of systemPlacement(seed, null, []).bodies) {
        const gap = body.drawn - body.radius - STAR_RADIUS
        if (gap < worst) {
          worst = gap
          worstSeed = seed
        }
      }
    }
    // FEAT: a folga é construída, não sorteada — o pior caso da varredura é o piso, não um acidente
    expect(worst, `worst clearance at seed ${worstSeed}`).toBeGreaterThan(0)
    expect(worst).toBeGreaterThanOrEqual(CLEARANCE - 1e-9)
  })

  it('clears the star on the seeds the captures use', () => {
    for (const seed of [482913, 4242]) {
      for (const body of systemPlacement(seed, null, []).bodies) {
        expect(
          body.drawn - body.radius - STAR_RADIUS,
          `seed ${seed} body ${body.index}`,
        ).toBeGreaterThanOrEqual(CLEARANCE - 1e-9)
      }
    }
  })

  it('keeps every orbit gap the engine drew, only farther out', () => {
    for (const seed of [482913, 4242, 1, 7]) {
      const bodies = systemPlacement(seed, null, []).bodies
      const lift = (bodies[0]?.drawn ?? 0) - (bodies[0]?.distance ?? 0)
      expect(lift).toBeGreaterThanOrEqual(0)
      // FEAT: o afastamento é o mesmo para todos, então nenhuma distância relativa se mexe
      for (const body of bodies) expect(body.drawn - body.distance).toBeCloseTo(lift, 12)
    }
  })

  it('draws a gas giant bigger than an ice body, and an ice body bigger than a rocky one', () => {
    const gas = radiusOfKind('gas')
    const ice = radiusOfKind('ice')
    const rocky = radiusOfKind('rocky')
    // FEAT: um quinto de diferença, senão o tipo do corpo deixa de se ler no tamanho
    expect(gas).toBeGreaterThan(ice * 1.2)
    expect(ice).toBeGreaterThan(rocky * 1.2)
  })
})
