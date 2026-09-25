export type Vec3 = readonly [number, number, number]

export const LEVELS = ['orbit', 'continent', 'region'] as const
export type Level = (typeof LEVELS)[number]

export const ALTITUDE = { min: 0.004, max: 2.4 } as const
export const LEVEL_ALTITUDE: Readonly<Record<Level, number>> = {
  orbit: 2.2,
  continent: 0.35,
  region: 0.03,
}
const ORBIT_FROM = 0.8
const REGION_BELOW = 0.1
const MAX_TILT = 1.1
const LOOK_FROM = 0.25

export function levelOf(altitude: number): Level {
  if (altitude >= ORBIT_FROM) return 'orbit'
  if (altitude >= REGION_BELOW) return 'continent'
  return 'region'
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function tiltFor(altitude: number): number {
  const t = clamp01(
    (Math.log(ORBIT_FROM) - Math.log(altitude)) / (Math.log(ORBIT_FROM) - Math.log(ALTITUDE.min)),
  )
  // FIX: raiz quadrada inclina mais cedo, para mostrar o horizonte já no nível continente
  return MAX_TILT * Math.sqrt(t)
}

export function dirOf(lat: number, lon: number): Vec3 {
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export interface SurfacePose {
  readonly position: Vec3
  readonly target: Vec3
  readonly up: Vec3
}

export function surfacePose(
  lat: number,
  lon: number,
  altitude: number,
  ground: number,
): SurfacePose {
  const n = dirOf(lat, lon)
  const east = Math.abs(n[1]) > 0.999 ? ([1, 0, 0] as Vec3) : normalize(cross(n, [0, 1, 0]))
  const north = cross(east, n)
  const tilt = tiltFor(altitude)
  const c = Math.cos(tilt)
  const s = Math.sin(tilt)
  const offset: Vec3 = [n[0] * c - north[0] * s, n[1] * c - north[1] * s, n[2] * c - north[2] * s]
  const surface: Vec3 = [n[0] * ground, n[1] * ground, n[2] * ground]
  const orbit = clamp01((altitude - LOOK_FROM) / (ORBIT_FROM - LOOK_FROM))
  return {
    position: [
      surface[0] + offset[0] * altitude,
      surface[1] + offset[1] * altitude,
      surface[2] + offset[2] * altitude,
    ],
    target:
      orbit >= 1
        ? [0, 0, 0]
        : [surface[0] * (1 - orbit), surface[1] * (1 - orbit), surface[2] * (1 - orbit)],
    up: normalize([north[0] * c + n[0] * s, north[1] * c + n[1] * s, north[2] * c + n[2] * s]),
  }
}

export function zoomGoal(
  goal: number,
  factor: number,
  min: number,
  max: number,
): { goal: number; beyond: boolean } {
  const raw = goal * factor
  // FEAT: chegar ao teto não é sair; sair é pedir para fora já estando nele
  const beyond = goal === max && raw > max
  return { goal: Math.min(max, Math.max(min, raw)), beyond }
}

export function panBy(
  lat: number,
  lon: number,
  altitude: number,
  dx: number,
  dy: number,
  viewport: number,
): [number, number] {
  // FIX: o terreno acompanha o ponteiro, como num globo que se agarra
  const rate = (altitude * 1.4) / Math.max(1, viewport)
  const nextLat = Math.min(1.45, Math.max(-1.45, lat - dy * rate))
  const nextLon = lon + (dx * rate) / Math.max(0.2, Math.cos(lat))
  return [nextLat, nextLon]
}
