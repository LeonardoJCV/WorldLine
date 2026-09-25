import { describe, expect, it } from 'vitest'
import type { Colony } from '../../engine/colony.ts'
import { colonisable, system, type BodyKind } from '../../engine/system.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../../engine/golden.ts'
import { Worldline } from '../../engine/worldline.ts'
import { toSnapshot, type Snapshot } from '../../worker/protocol.ts'
import { planetPalette, planetState } from '../planet/uniforms.ts'
import { bodyLabelKey, systemPlacement, type PlacedBody } from './model.ts'
import { bodyPalette, bodyState, bodyYaw } from './palette.ts'

// FEAT: um Snapshot de verdade, do mundo que chegou ao espaço, em vez de um literal inventado
function snapshotFixture(year = INHERITANCE_CASE.ended - 1): Snapshot {
  const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
  const line = new Worldline(INHERITANCE_CASE.seed, plan.decisions, null, plan.crossings)
  line.advance(3000)
  return toSnapshot(line.stateAt(year))
}

// FEAT: o índice do primeiro corpo colonizável da semente — o herdeiro possível
const heirIndex = system(482913).find((b) => colonisable(b))?.index ?? -1

function colonyOn(body: number, population: number): Colony {
  return { body, founded: 1803, population, support: 0.9, record: 0 }
}

function bodyAt(home: number | null, colonies: readonly Colony[], index: number): PlacedBody {
  const body = systemPlacement(482913, home, colonies).bodies[index]
  if (!body) throw new Error(`seed 482913 has no body ${index}`)
  return body
}

// FEAT: a primeira semente da lista que tem um corpo do tipo pedido, para o teste não depender de sorte
function anyBodyOfKind(kind: BodyKind): { seed: number; body: PlacedBody } {
  for (const seed of [482913, 4242, 1, 2, 3, 7, 999999]) {
    const body = systemPlacement(seed, null, []).bodies.find((b) => b.kind === kind)
    if (body) return { seed, body }
  }
  throw new Error(`no ${kind} body in the sampled seeds`)
}

describe('bodyPalette', () => {
  it('gives the body the history lives on the palette the planet lens already uses', () => {
    // FEAT: o mundo em que se está é o mesmo nas duas lentes; trocar de paleta ao subir seria mentira
    const placed = systemPlacement(482913, null, [])
    const living = placed.bodies.find((b) => b.living)
    expect(living && bodyPalette(482913, living)).toEqual(planetPalette(482913))
  })

  it('gives each other body its own palette', () => {
    const placed = systemPlacement(482913, null, [])
    const seen = placed.bodies.map((b) => JSON.stringify(bodyPalette(482913, b)))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('is deterministic', () => {
    const placed = systemPlacement(482913, null, [])
    for (const body of placed.bodies) {
      expect(bodyPalette(482913, body)).toEqual(bodyPalette(482913, body))
    }
  })

  it('reads a gas body differently from a rocky one', () => {
    // FEAT: um gasoso não tem mar; se as duas paletas saíssem iguais, o tipo não estaria dizendo nada
    const gas = anyBodyOfKind('gas')
    const rocky = anyBodyOfKind('rocky')
    const a = bodyPalette(gas.seed, gas.body)
    const b = bodyPalette(rocky.seed, rocky.body)
    expect(a.seaLevel).not.toBeCloseTo(b.seaLevel)
    expect(a).not.toEqual(b)
  })
})

describe('bodyYaw', () => {
  it('is deterministic and stays inside one turn', () => {
    const placed = systemPlacement(482913, null, [])
    for (const body of placed.bodies) {
      const yaw = bodyYaw(482913, body)
      expect(bodyYaw(482913, body)).toBe(yaw)
      expect(yaw).toBeGreaterThanOrEqual(0)
      expect(yaw).toBeLessThan(Math.PI * 2)
    }
  })

  it('turns each body a different amount, so none faces the camera the same way', () => {
    const placed = systemPlacement(482913, null, [])
    const seen = placed.bodies.map((b) => bodyYaw(482913, b))
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('bodyState', () => {
  it('leaves an empty body dark, and shows nothing that is not there', () => {
    const placed = systemPlacement(482913, null, [])
    const empty = placed.bodies.find((b) => !b.living && !b.natal && b.colony === null)
    const state = empty && bodyState(empty, snapshotFixture())
    expect(state?.lights).toBe(0)
    expect(state?.satellites).toBe(0)
  })

  it('keeps every state field inside the range the shader expects', () => {
    const placed = systemPlacement(482913, 1, [])
    for (const body of placed.bodies) {
      const state = bodyState(body, snapshotFixture())
      for (const value of Object.values(state)) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('lights a body in proportion to the colony on it', () => {
    const dim = bodyState(bodyAt(null, [colonyOn(heirIndex, 1_000)], heirIndex), snapshotFixture())
    const bright = bodyState(
      bodyAt(null, [colonyOn(heirIndex, 500_000)], heirIndex),
      snapshotFixture(),
    )
    expect(dim.lights).toBeGreaterThan(0)
    expect(bright.lights).toBeGreaterThan(dim.lights)
  })

  it('lights a hundred thousand settlers well below a hundred million citizens', () => {
    // FEAT: a mesma forma logarítmica do mundo natal, senão uma colônia recém-fundada brilha como capital
    const colony = bodyState(
      bodyAt(null, [colonyOn(heirIndex, 100_000)], heirIndex),
      snapshotFixture(),
    )
    const world = planetState(snapshotFixture())
    expect(colony.lights).toBeLessThan(world.lights)
  })

  it('leaves the dead home world dark and marked as ended', () => {
    const natal = systemPlacement(482913, heirIndex, []).bodies.find((b) => b.dead)
    if (!natal) throw new Error('the natal body should be dead once the history moved')
    const state = bodyState(natal, snapshotFixture())
    expect(state.lights).toBe(0)
    expect(state.extinct).toBe(1)
  })
})

describe('bodyLabelKey', () => {
  it('tells a dead world, an empty one and a living one apart in words', () => {
    // FEAT: apagado não basta — um corpo vazio também é apagado; quem separa é o texto do rótulo
    const moved = systemPlacement(482913, heirIndex, [])
    const dead = moved.bodies.find((b) => b.dead)
    const living = moved.bodies.find((b) => b.living)
    const empty = moved.bodies.find((b) => !b.dead && !b.living && b.colony === null)
    if (!dead || !living || !empty) {
      throw new Error('seed 482913 should have a dead, a living and an empty body once moved')
    }
    // FIX: cada corpo com a chave que lhe é própria — um Set só de tamanho não pega troca nem falta
    expect(bodyLabelKey(dead)).toBe('system.dead')
    expect(bodyLabelKey(living)).toBe('system.home')
    expect(bodyLabelKey(empty)).toBe('system.empty')
  })
})
