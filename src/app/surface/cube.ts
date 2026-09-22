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
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
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
  readonly split: number
}

export function selectChunks({ camera, maxLevel, split }: Selection): ChunkKey[] {
  const distance = Math.max(Math.hypot(...camera), 1e-6)
  const toCamera: Vec3 = [camera[0] / distance, camera[1] / distance, camera[2] / distance]
  const horizon = Math.acos(Math.min(1, 1 / Math.max(distance, 1.0001)))
  const out: ChunkKey[] = []
  const visit = (key: ChunkKey) => {
    const center = chunkCenter(key)
    const size = chunkSize(key)
    const angle = size * 0.8
    const facing = center[0] * toCamera[0] + center[1] * toCamera[1] + center[2] * toCamera[2]
    if (facing < Math.cos(Math.min(Math.PI, horizon + angle + 0.05))) return
    const gap = Math.hypot(camera[0] - center[0], camera[1] - center[1], camera[2] - center[2])
    if (key.level < maxLevel && gap < split * size * 0.78) {
      for (const child of childrenOf(key)) visit(child)
      return
    }
    out.push(key)
  }
  for (const root of rootKeys()) visit(root)
  return out
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
