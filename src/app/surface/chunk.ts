import type { Terrain } from './terrain.ts'
import { surfaceRadius } from './terrain.ts'
import { chunkCenter, chunkCorner, cubeDir, chunkSize, keyOf, type ChunkKey } from './cube.ts'

export interface ChunkMesh {
  readonly key: string
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
}

export function skirtDrop(key: ChunkKey): number {
  return Math.min(0.02, chunkSize(key) * 0.25)
}

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
      grid[at] = d[0] * r
      grid[at + 1] = d[1] * r
      grid[at + 2] = d[2] * r
      tint[at] = c[0]
      tint[at + 1] = c[1]
      tint[at + 2] = c[2]
    }
  }

  const triangles = resolution * resolution * 2 + 4 * resolution * 2
  const positions = new Float32Array(triangles * 9)
  const normals = new Float32Array(triangles * 9)
  const colors = new Float32Array(triangles * 9)
  let cursor = 0

  // FIX: vira b/c se a normal apontar para dentro da referência (origem ou centro do bloco).
  const push = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    cr: number,
    cg: number,
    cb: number,
    refX: number,
    refY: number,
    refZ: number,
    outX?: number,
    outY?: number,
    outZ?: number,
  ) => {
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const acx = cx - ax
    const acy = cy - ay
    const acz = cz - az
    let nx = aby * acz - abz * acy
    let ny = abz * acx - abx * acz
    let nz = abx * acy - aby * acx
    let px = bx
    let py = by
    let pz = bz
    let qx = cx
    let qy = cy
    let qz = cz
    if (nx * (ax - refX) + ny * (ay - refY) + nz * (az - refZ) < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
      px = cx
      py = cy
      pz = cz
      qx = bx
      qy = by
      qz = bz
    }
    if (outX !== undefined) {
      nx = outX
      ny = outY ?? 0
      nz = outZ ?? 0
    }
    const length = Math.hypot(nx, ny, nz) || 1
    const nnx = nx / length
    const nny = ny / length
    const nnz = nz / length
    positions[cursor] = ax
    positions[cursor + 1] = ay
    positions[cursor + 2] = az
    normals[cursor] = nnx
    normals[cursor + 1] = nny
    normals[cursor + 2] = nnz
    colors[cursor] = cr
    colors[cursor + 1] = cg
    colors[cursor + 2] = cb
    cursor += 3
    positions[cursor] = px
    positions[cursor + 1] = py
    positions[cursor + 2] = pz
    normals[cursor] = nnx
    normals[cursor + 1] = nny
    normals[cursor + 2] = nnz
    colors[cursor] = cr
    colors[cursor + 1] = cg
    colors[cursor + 2] = cb
    cursor += 3
    positions[cursor] = qx
    positions[cursor + 1] = qy
    positions[cursor + 2] = qz
    normals[cursor] = nnx
    normals[cursor + 1] = nny
    normals[cursor + 2] = nnz
    colors[cursor] = cr
    colors[cursor + 1] = cg
    colors[cursor + 2] = cb
    cursor += 3
  }

  const pushSurface = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    cr: number,
    cg: number,
    cb: number,
  ) => push(ax, ay, az, bx, by, bz, cx, cy, cz, cr, cg, cb, 0, 0, 0)

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * side + i
      const b = a + 1
      const c = a + side + 1
      const d = a + side
      const ax = grid[a * 3] ?? 0
      const ay = grid[a * 3 + 1] ?? 0
      const az = grid[a * 3 + 2] ?? 0
      const bx = grid[b * 3] ?? 0
      const by = grid[b * 3 + 1] ?? 0
      const bz = grid[b * 3 + 2] ?? 0
      const cx = grid[c * 3] ?? 0
      const cy = grid[c * 3 + 1] ?? 0
      const cz = grid[c * 3 + 2] ?? 0
      const dx = grid[d * 3] ?? 0
      const dy = grid[d * 3 + 1] ?? 0
      const dz = grid[d * 3 + 2] ?? 0
      const ar = tint[a * 3] ?? 0
      const ag = tint[a * 3 + 1] ?? 0
      const ab = tint[a * 3 + 2] ?? 0
      const br = tint[b * 3] ?? 0
      const bg = tint[b * 3 + 1] ?? 0
      const bb = tint[b * 3 + 2] ?? 0
      const cr = tint[c * 3] ?? 0
      const cg = tint[c * 3 + 1] ?? 0
      const cb = tint[c * 3 + 2] ?? 0
      const dr = tint[d * 3] ?? 0
      const dg = tint[d * 3 + 1] ?? 0
      const db = tint[d * 3 + 2] ?? 0
      pushSurface(
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        cx,
        cy,
        cz,
        (ar + br + cr) / 3,
        (ag + bg + cg) / 3,
        (ab + bb + cb) / 3,
      )
      pushSurface(
        ax,
        ay,
        az,
        cx,
        cy,
        cz,
        dx,
        dy,
        dz,
        (ar + cr + dr) / 3,
        (ag + cg + dg) / 3,
        (ab + cb + db) / 3,
      )
    }
  }

  const drop = skirtDrop(key)
  const centre = chunkCenter(key)
  const cxr = centre[0]
  const cyr = centre[1]
  const czr = centre[2]
  const pushSkirt = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    cr: number,
    cg: number,
    cb: number,
    upx: number,
    upy: number,
    upz: number,
  ) => push(ax, ay, az, bx, by, bz, cx, cy, cz, cr, cg, cb, cxr, cyr, czr, upx, upy, upz)

  const edges: number[][] = [
    Array.from({ length: side }, (_, i) => i),
    Array.from({ length: side }, (_, i) => resolution * side + i),
    Array.from({ length: side }, (_, j) => j * side),
    Array.from({ length: side }, (_, j) => j * side + resolution),
  ]
  for (const edge of edges) {
    for (let k = 0; k < resolution; k++) {
      const i0 = edge[k] ?? 0
      const i1 = edge[k + 1] ?? 0
      const e0x = grid[i0 * 3] ?? 0
      const e0y = grid[i0 * 3 + 1] ?? 0
      const e0z = grid[i0 * 3 + 2] ?? 0
      const e1x = grid[i1 * 3] ?? 0
      const e1y = grid[i1 * 3 + 1] ?? 0
      const e1z = grid[i1 * 3 + 2] ?? 0
      const rr = (tint[i0 * 3] ?? 0) * 0.8
      const rg = (tint[i0 * 3 + 1] ?? 0) * 0.8
      const rb = (tint[i0 * 3 + 2] ?? 0) * 0.8
      const r0 = Math.hypot(e0x, e0y, e0z) || 1
      const upx = e0x / r0
      const upy = e0y / r0
      const upz = e0z / r0
      const k0 = (r0 - drop) / r0
      const l0x = e0x * k0
      const l0y = e0y * k0
      const l0z = e0z * k0
      const r1 = Math.hypot(e1x, e1y, e1z) || 1
      const k1 = (r1 - drop) / r1
      const l1x = e1x * k1
      const l1y = e1y * k1
      const l1z = e1z * k1
      pushSkirt(e0x, e0y, e0z, e1x, e1y, e1z, l1x, l1y, l1z, rr, rg, rb, upx, upy, upz)
      pushSkirt(e0x, e0y, e0z, l1x, l1y, l1z, l0x, l0y, l0z, rr, rg, rb, upx, upy, upz)
    }
  }

  return { key: keyOf(key), positions, normals, colors }
}
