import { BufferGeometry, Points, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Era } from '../../engine/state.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { surfaceModel } from './civilization.ts'
import { createLife } from './life.ts'
import { createNight } from './night.ts'
import { findSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))
const sites = findSites(terrain)
const model = surfaceModel({
  sites,
  values: {
    population: 400_000,
    food: 2_000_000,
    energy: 4,
    technology: 40,
    economy: 6,
    environment: 70,
    stability: 70,
  },
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
