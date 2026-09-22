import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { buildChunk, skirtDrop } from './chunk.ts'
import { chunkCenter, type ChunkKey } from './cube.ts'
import { createTerrain, surfaceRadius } from './terrain.ts'

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

  it('shares identical edge vertices with the chunk on the next face', () => {
    const res = 8
    const front = buildChunk(terrain, { face: 4, level: 1, x: 1, y: 0 }, res)
    const side = buildChunk(terrain, { face: 0, level: 1, x: 0, y: 0 }, res)
    const seam = (mesh: typeof front) => {
      const points = new Set<string>()
      for (let i = 0; i < res * res * 2 * 9; i += 3) {
        const x = mesh.positions[i] ?? 0
        const y = mesh.positions[i + 1] ?? 0
        const z = mesh.positions[i + 2] ?? 0
        if (x === z) points.add(`${x},${y},${z}`)
      }
      return points
    }
    const a = seam(front)
    expect(a.size).toBe(res + 1)
    expect([...a].sort()).toEqual([...seam(side)].sort())
  })

  it('drops every skirt vertex to exactly its edge radius minus skirtDrop', () => {
    const res = 6
    const key: ChunkKey = { face: 4, level: 2, x: 1, y: 1 }
    const mesh = buildChunk(terrain, key, res)
    const drop = skirtDrop(key)
    const surface = res * res * 2 * 9
    for (let i = surface; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] ?? 0
      const y = mesh.positions[i + 1] ?? 0
      const z = mesh.positions[i + 2] ?? 0
      const radius = Math.hypot(x, y, z)
      const top = surfaceRadius(terrain.sample(x / radius, y / radius, z / radius).height)
      const onTop = Math.abs(radius - top) < 1e-5
      const onBottom = Math.abs(radius - (top - drop)) < 1e-5
      expect(onTop || onBottom).toBe(true)
    }
  })

  it('faces every skirt triangle away from its own chunk centre', () => {
    const res = 6
    const keys: ChunkKey[] = [0, 1, 2, 3, 4, 5]
      .map((face): ChunkKey => ({ face, level: 0, x: 0, y: 0 }))
      .concat([{ face: 4, level: 2, x: 1, y: 1 }])
    for (const key of keys) {
      const mesh = buildChunk(terrain, key, res)
      const centre = chunkCenter(key)
      const surface = res * res * 2 * 9
      for (let i = surface; i < mesh.positions.length; i += 9) {
        const ax = mesh.positions[i] ?? 0
        const ay = mesh.positions[i + 1] ?? 0
        const az = mesh.positions[i + 2] ?? 0
        const bx = mesh.positions[i + 3] ?? 0
        const by = mesh.positions[i + 4] ?? 0
        const bz = mesh.positions[i + 5] ?? 0
        const cx = mesh.positions[i + 6] ?? 0
        const cy = mesh.positions[i + 7] ?? 0
        const cz = mesh.positions[i + 8] ?? 0
        const abx = bx - ax
        const aby = by - ay
        const abz = bz - az
        const acx = cx - ax
        const acy = cy - ay
        const acz = cz - az
        const nx = aby * acz - abz * acy
        const ny = abz * acx - abx * acz
        const nz = abx * acy - aby * acx
        const dot = nx * (ax - centre[0]) + ny * (ay - centre[1]) + nz * (az - centre[2])
        expect(dot).toBeGreaterThan(-1e-6)
      }
    }
  })
})
