import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { buildChunk } from './chunk.ts'
import { createTerrain } from './terrain.ts'

const terrain = createTerrain(482913, planetPalette(482913))

describe('buildChunk', () => {
  it('builds a faceted grid with skirts', () => {
    const res = 8
    const mesh = buildChunk(terrain, { face: 4, level: 2, x: 1, y: 1 }, res)
    const triangles = res * res * 2 + 4 * res * 2
    expect(mesh.positions.length).toBe(triangles * 9)
    expect(mesh.normals.length).toBe(triangles * 9)
    expect(mesh.colors.length).toBe(triangles * 9)
    for (let i = 0; i < res * res * 2 * 9; i += 9) {
      expect(mesh.colors[i]).toBe(mesh.colors[i + 3])
      expect(mesh.colors[i]).toBe(mesh.colors[i + 6])
    }
  })

  it('points every surface normal outward and keeps radii near one', () => {
    const mesh = buildChunk(terrain, { face: 0, level: 1, x: 0, y: 1 }, 8)
    const surface = 8 * 8 * 2 * 9
    for (let i = 0; i < surface; i += 3) {
      const [x, y, z] = [
        mesh.positions[i] ?? 0,
        mesh.positions[i + 1] ?? 0,
        mesh.positions[i + 2] ?? 0,
      ]
      const dot =
        x * (mesh.normals[i] ?? 0) + y * (mesh.normals[i + 1] ?? 0) + z * (mesh.normals[i + 2] ?? 0)
      expect(dot).toBeGreaterThan(0)
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.98)
      expect(Math.hypot(x, y, z)).toBeLessThan(1.06)
    }
  })

  it('shares identical edge vertices with the neighbouring chunk', () => {
    const res = 8
    const left = buildChunk(terrain, { face: 4, level: 1, x: 0, y: 0 }, res)
    const right = buildChunk(terrain, { face: 4, level: 1, x: 1, y: 0 }, res)
    const edge = (mesh: typeof left, u: number) => {
      const points = new Set<string>()
      for (let i = 0; i < res * res * 2 * 9; i += 3) {
        const x = mesh.positions[i] ?? 0
        const y = mesh.positions[i + 1] ?? 0
        const z = mesh.positions[i + 2] ?? 0
        const cu = x / z
        if (Math.abs(cu - u) < 1e-9) points.add(`${x},${y},${z}`)
      }
      return points
    }
    const a = edge(left, 0)
    const b = edge(right, 0)
    expect(a.size).toBe(res + 1)
    expect([...a].sort()).toEqual([...b].sort())
  })
})
