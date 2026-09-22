import { BufferGeometry, Points, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Era } from '../../engine/state.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { surfaceModel } from './civilization.ts'
import { createLife } from './life.ts'
import { createNight } from './night.ts'
import { buildRoads } from './roads.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))
const sites = findSites(terrain)
const values = {
  population: 400_000,
  food: 2_000_000,
  energy: 4,
  technology: 40,
  economy: 6,
  environment: 70,
  stability: 70,
}
const model = surfaceModel({
  sites,
  values,
  eras: Era.agricultural | Era.industrial,
  active: [],
  allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  status: 'running',
  history: { from: 0, to: 800, population: Float32Array.from([100_000, 400_000]) },
})

function seenAfter(ground: number): number {
  const sun = { value: new Vector3(1, 0, 0) }
  const life = createLife({ sun })
  const night = createNight({
    sun,
    shared: life.shared,
    density: 1,
    still: false,
    animated: true,
    ground: () => ground,
  })
  night.setModel(model, sites, [])
  const capital = sites[0]?.dir ?? [1, 0, 0]
  const eye = new Vector3(...capital).multiplyScalar(1.1)
  for (let i = 0; i < 20; i++) night.tick(0.05, 0.1, eye)
  const halos = night.group.children.find(
    (child): child is Points<BufferGeometry> =>
      child instanceof Points && child.geometry.getAttribute('aSeen') !== undefined,
  )
  const seen = halos?.geometry.getAttribute('aSeen').getX(0) ?? -1
  night.dispose()
  life.dispose()
  return seen
}

describe('night halos', () => {
  it('fade out behind relief between the camera and the city', () => {
    expect(seenAfter(1.05)).toBe(0)
  })

  it('stay lit with a clear line of sight', () => {
    expect(seenAfter(1)).toBe(1)
  })
})

function walkersAt(economy: number): number {
  const sun = { value: new Vector3(1, 0, 0) }
  const life = createLife({ sun })
  const night = createNight({
    sun,
    shared: life.shared,
    density: 1,
    still: false,
    animated: true,
    ground: () => 1,
  })
  const rich = surfaceModel({
    sites,
    values: { ...values, population: 6_000_000, economy },
    eras: Era.agricultural | Era.industrial,
    active: [],
    allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
    status: 'running',
    history: { from: 0, to: 800, population: Float32Array.from([1_000_000, 6_000_000]) },
  })
  const roads = buildRoads({ ...rich, economy: 3 }, sites, terrain)
  night.setModel(rich, sites, roads)
  night.tick(0.016, 0.05, new Vector3(2, 0, 0))
  const people = night.people()
  night.dispose()
  life.dispose()
  return people
}

describe('night walkers', () => {
  it('crowd the same roads more when the economy is strong', () => {
    const poor = walkersAt(1)
    expect(poor).toBeGreaterThan(0)
    expect(walkersAt(9)).toBeGreaterThan(poor)
  })
})
