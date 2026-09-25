import { describe, expect, it } from 'vitest'
import type { BodyKind } from '../../engine/system.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../../engine/golden.ts'
import { Worldline } from '../../engine/worldline.ts'
import { toSnapshot, type Snapshot } from '../../worker/protocol.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { systemPlacement, type PlacedBody } from './model.ts'
import { bodyPalette, bodyState } from './palette.ts'

// FEAT: um Snapshot de verdade, do mundo que chegou ao espaço, em vez de um literal inventado
function snapshotFixture(year = INHERITANCE_CASE.ended - 1): Snapshot {
  const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
  const line = new Worldline(INHERITANCE_CASE.seed, plan.decisions, null, plan.crossings)
  line.advance(3000)
  return toSnapshot(line.stateAt(year))
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
})
