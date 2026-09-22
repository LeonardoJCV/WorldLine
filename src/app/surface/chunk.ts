import type { Terrain } from './terrain.ts'
import { surfaceRadius } from './terrain.ts'
import { chunkCorner, cubeDir, chunkSize, keyOf, type ChunkKey } from './cube.ts'

export interface ChunkMesh {
  readonly key: string
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
}

export function skirtDrop(key: ChunkKey): number {
  return Math.min(0.02, chunkSize(key) * 0.25)
}

type Point = readonly [number, number, number]

export function buildChunk(terrain: Terrain, key: ChunkKey, resolution: number): ChunkMesh {
  const { u0, v0, size } = chunkCorner(key)
  const side = resolution + 1
  const grid = new Float32Array(side * side * 3)
  const tint = new Float32Array(side * side * 3)
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const d = cubeDir(key.face, u0 + (size * i) / resolution, v0 + (size * j) / resolution)
      const s = terrain.sample(d[0], d[1], d[2])
      const r = surfaceRadius(s.height)
      const c = terrain.color(s)
      const at = (j * side + i) * 3
      grid.set([d[0] * r, d[1] * r, d[2] * r], at)
      tint.set(c, at)
    }
  }
  const triangles = resolution * resolution * 2 + 4 * resolution * 2
  const positions = new Float32Array(triangles * 9)
  const normals = new Float32Array(triangles * 9)
  const colors = new Float32Array(triangles * 9)
  let cursor = 0

  const point = (index: number): Point => [
    grid[index * 3] ?? 0,
    grid[index * 3 + 1] ?? 0,
    grid[index * 3 + 2] ?? 0,
  ]
  const color = (index: number): Point => [
    tint[index * 3] ?? 0,
    tint[index * 3 + 1] ?? 0,
    tint[index * 3 + 2] ?? 0,
  ]

  const push = (a: Point, b: Point, c: Point, rgb: Point, outward?: Point) => {
    const ab: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n: Point = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    let [p, q] = [b, c]
    if (n[0] * a[0] + n[1] * a[1] + n[2] * a[2] < 0) {
      n = [-n[0], -n[1], -n[2]]
      ;[p, q] = [c, b]
    }
    if (outward) n = outward
    const length = Math.hypot(n[0], n[1], n[2]) || 1
    for (const v of [a, p, q]) {
      positions.set(v, cursor)
      normals.set([n[0] / length, n[1] / length, n[2] / length], cursor)
      colors.set(rgb, cursor)
      cursor += 3
    }
  }

  const average = (...list: Point[]): Point => {
    const sum: [number, number, number] = [0, 0, 0]
    for (const c of list) {
      sum[0] += c[0]
      sum[1] += c[1]
      sum[2] += c[2]
    }
    return [sum[0] / list.length, sum[1] / list.length, sum[2] / list.length]
  }

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * side + i
      const b = a + 1
      const c = a + side + 1
      const d = a + side
      push(point(a), point(b), point(c), average(color(a), color(b), color(c)))
      push(point(a), point(c), point(d), average(color(a), color(c), color(d)))
    }
  }

  const drop = skirtDrop(key)
  const lowered = (p: Point): Point => {
    const r = Math.hypot(...p)
    const k = (r - drop) / r
    return [p[0] * k, p[1] * k, p[2] * k]
  }
  const edges: number[][] = [
    Array.from({ length: side }, (_, i) => i),
    Array.from({ length: side }, (_, i) => resolution * side + i),
    Array.from({ length: side }, (_, j) => j * side),
    Array.from({ length: side }, (_, j) => j * side + resolution),
  ]
  for (const edge of edges) {
    for (let k = 0; k < resolution; k++) {
      const e0 = point(edge[k] ?? 0)
      const e1 = point(edge[k + 1] ?? 0)
      const rgb0 = color(edge[k] ?? 0)
      const rgb: Point = [rgb0[0] * 0.8, rgb0[1] * 0.8, rgb0[2] * 0.8]
      const length0 = Math.hypot(...e0) || 1
      const up: Point = [e0[0] / length0, e0[1] / length0, e0[2] / length0]
      push(e0, e1, lowered(e1), rgb, up)
      push(e0, lowered(e1), lowered(e0), rgb, up)
    }
  }

  return { key: keyOf(key), positions, normals, colors }
}
