export type Vec3 = readonly [number, number, number]

export interface ChunkKey {
  readonly face: number
  readonly level: number
  readonly x: number
  readonly y: number
}

export function keyOf(key: ChunkKey): string {
  return `${key.face}/${key.level}/${key.x}/${key.y}`
}

export function parseKey(text: string): ChunkKey {
  const [face, level, x, y] = text.split('/').map(Number)
  return { face: face ?? 0, level: level ?? 0, x: x ?? 0, y: y ?? 0 }
}

export function rootKeys(): ChunkKey[] {
  return [0, 1, 2, 3, 4, 5].map((face) => ({ face, level: 0, x: 0, y: 0 }))
}

export function parentOf(key: ChunkKey): ChunkKey | null {
  if (key.level === 0) return null
  return { face: key.face, level: key.level - 1, x: key.x >> 1, y: key.y >> 1 }
}

export function childrenOf(key: ChunkKey): ChunkKey[] {
  const level = key.level + 1
  const x = key.x * 2
  const y = key.y * 2
  return [
    { face: key.face, level, x, y },
    { face: key.face, level, x: x + 1, y },
    { face: key.face, level, x, y: y + 1 },
    { face: key.face, level, x: x + 1, y: y + 1 },
  ]
}

export function chunkSize(key: ChunkKey): number {
  return 2 / 2 ** key.level
}

function facePoint(face: number, u: number, v: number): Vec3 {
  switch (face) {
    case 0:
      return [1, v, -u]
    case 1:
      return [-1, v, u]
    case 2:
      return [u, 1, -v]
    case 3:
      return [u, -1, v]
    case 4:
      return [u, v, 1]
    default:
      return [-u, v, -1]
  }
}

export function cubeDir(face: number, u: number, v: number): [number, number, number] {
  const [x, y, z] = facePoint(face, u, v)
  const length = Math.sqrt(x * x + y * y + z * z)
  return [x / length, y / length, z / length]
}

export function faceUV(dir: Vec3): { face: number; u: number; v: number } {
  const [x, y, z] = dir
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (ax >= ay && ax >= az) {
    return x > 0 ? { face: 0, u: -z / ax, v: y / ax } : { face: 1, u: z / ax, v: y / ax }
  }
  if (ay >= az) {
    return y > 0 ? { face: 2, u: x / ay, v: -z / ay } : { face: 3, u: x / ay, v: z / ay }
  }
  return z > 0 ? { face: 4, u: x / az, v: y / az } : { face: 5, u: -x / az, v: y / az }
}

export function tileOf(dir: Vec3, level: number): ChunkKey {
  const { face, u, v } = faceUV(dir)
  const cells = 2 ** level
  const clamp = (value: number) =>
    Math.min(cells - 1, Math.max(0, Math.floor(((value + 1) / 2) * cells)))
  return { face, level, x: clamp(u), y: clamp(v) }
}

export function chunkCorner(key: ChunkKey): { u0: number; v0: number; size: number } {
  const size = chunkSize(key)
  return { u0: -1 + key.x * size, v0: -1 + key.y * size, size }
}

export function chunkCenter(key: ChunkKey): [number, number, number] {
  const { u0, v0, size } = chunkCorner(key)
  return cubeDir(key.face, u0 + size / 2, v0 + size / 2)
}

export interface Selection {
  readonly camera: Vec3
  readonly maxLevel: number
  readonly focal: number
  readonly error: number
  readonly budget: number
  readonly resolution: number
  readonly minTriangle: number
  readonly inView?: (center: Vec3, radius: number) => boolean
}

export interface Selected {
  readonly key: ChunkKey
  readonly distance: number
}

interface Leaf extends Selected {
  readonly pixels: number
  readonly final: boolean
}

export function chunkExtent(key: ChunkKey): number {
  return chunkSize(key) * 0.8
}

export function chunkRadius(key: ChunkKey): number {
  return chunkExtent(key) * 0.75 + 0.05
}

export function selectChunks({
  camera,
  maxLevel,
  focal,
  error,
  budget,
  resolution,
  minTriangle,
  inView,
}: Selection): Selected[] {
  // FIX: só divide se os triângulos dos filhos continuarem com pelo menos minTriangle px na tela
  const limit = Math.max(error, 2 * resolution * minTriangle)
  const distance = Math.max(Math.hypot(...camera), 1e-6)
  const toCamera: Vec3 = [camera[0] / distance, camera[1] / distance, camera[2] / distance]
  const horizon = Math.acos(Math.min(1, 1 / Math.max(distance, 1.0001)))
  const visible = (key: ChunkKey): Leaf | null => {
    const center = chunkCenter(key)
    const facing = center[0] * toCamera[0] + center[1] * toCamera[1] + center[2] * toCamera[2]
    if (facing < Math.cos(Math.min(Math.PI, horizon + chunkExtent(key) + 0.05))) return null
    const gap = Math.max(
      Math.hypot(camera[0] - center[0], camera[1] - center[1], camera[2] - center[2]),
      1e-6,
    )
    const splittable = key.level < maxLevel && (inView ? inView(center, chunkRadius(key)) : true)
    return { key, distance: gap, pixels: (chunkExtent(key) / gap) * focal, final: !splittable }
  }
  const leaves: Leaf[] = []
  for (const root of rootKeys()) {
    const leaf = visible(root)
    if (leaf) leaves.push(leaf)
  }
  // FEAT: refina primeiro o bloco com maior erro na tela; o orçamento corta os mais distantes
  for (;;) {
    let best = -1
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]
      if (!leaf || leaf.final || leaf.pixels <= limit) continue
      if (best < 0 || leaf.pixels > (leaves[best]?.pixels ?? 0)) best = i
    }
    const parent = leaves[best]
    if (!parent) break
    const children = childrenOf(parent.key)
      .map(visible)
      .filter((leaf): leaf is Leaf => leaf !== null)
    if (children.length === 0) {
      leaves[best] = { ...parent, final: true }
      continue
    }
    if (leaves.length - 1 + children.length > budget) break
    leaves.splice(best, 1, ...children)
  }
  return leaves.map(({ key, distance: gap }) => ({ key, distance: gap }))
}

export function displaySet(wanted: readonly string[], loaded: ReadonlySet<string>): string[] {
  const shown = new Set<string>()
  for (const text of wanted) {
    let key: ChunkKey | null = parseKey(text)
    while (key && !loaded.has(keyOf(key))) key = parentOf(key)
    if (key) shown.add(keyOf(key))
  }
  return [...shown].filter((text) => {
    let parent = parentOf(parseKey(text))
    while (parent) {
      if (shown.has(keyOf(parent))) return false
      parent = parentOf(parent)
    }
    return true
  })
}
