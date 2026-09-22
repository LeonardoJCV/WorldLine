export function hash3(seed: number, x: number, y: number, z: number): number {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 2147483647) ^
    Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueNoise(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const c = (i: number, j: number, k: number) => hash3(seed, xi + i, yi + j, zi + k)
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}

export function fbm(
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence = 0.5,
): number {
  let amplitude = 1 - persistence
  let sum = 0
  let px = x
  let py = y
  let pz = z
  for (let k = 0; k < octaves; k++) {
    sum += amplitude * valueNoise(seed + k, px, py, pz)
    px *= 2.03
    py *= 2.03
    pz *= 2.03
    amplitude *= persistence
  }
  return sum
}
