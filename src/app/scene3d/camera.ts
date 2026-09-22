export type Vec3 = readonly [number, number, number]

export interface Pose {
  readonly target: Vec3
  readonly position: Vec3
}

export const RAIL_BACK = 10.5
export const RAIL_OFFSET: Vec3 = [-3, 4, 15.5]
export const FOCUS_RADIUS = 0.9
export const OTHER_RADIUS = 0.45
export const RAIL_FOV = 38
// FIX: do alvo do trilho até o início da janela de tempo [-12, 12], com folga
export const FRAME_HALF_WIDTH = 24 - RAIL_BACK + 1

export function railPose(head: Vec3): Pose {
  const target: Vec3 = [head[0] - RAIL_BACK, head[1], head[2]]
  return {
    target,
    position: [target[0] + RAIL_OFFSET[0], target[1] + RAIL_OFFSET[1], target[2] + RAIL_OFFSET[2]],
  }
}

export function railDistance(aspect: number, fov = RAIL_FOV): number {
  const distance = Math.hypot(...RAIL_OFFSET)
  const visible = distance * Math.tan((fov * Math.PI) / 360) * aspect
  if (!(visible > 0)) return 1
  return Math.max(1, FRAME_HALF_WIDTH / visible)
}

export function approach(current: Vec3, goal: Vec3, dt: number, rate = 4): Vec3 {
  const k = Math.min(1, dt * rate)
  return [
    current[0] + (goal[0] - current[0]) * k,
    current[1] + (goal[1] - current[1]) * k,
    current[2] + (goal[2] - current[2]) * k,
  ]
}

interface Point {
  readonly x: number
  readonly y: number
}

export function yearAtPointer(p: Point, a: Point, b: Point, from: number, to: number): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 1 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / length
  return Math.round(from + (to - from) * Math.min(1, Math.max(0, t)))
}

export interface ScreenTarget {
  readonly kind: 'world' | 'event' | 'enter' | 'micro'
  readonly key: string
  readonly x: number
  readonly y: number
  readonly radius: number
}

export function pickTarget(
  targets: readonly ScreenTarget[],
  x: number,
  y: number,
): ScreenTarget | null {
  let best: ScreenTarget | null = null
  let score = Infinity
  for (const target of targets) {
    const d = Math.hypot(target.x - x, target.y - y) / Math.max(target.radius, 1)
    if (d <= 1 && d < score) {
      best = target
      score = d
    }
  }
  return best
}

export const ERA_GAP = 140
export const ERA_ROW = 20

export function eraOffsets(points: readonly { x: number; y: number }[]): number[] {
  const order = points.map((point, index) => ({ ...point, index })).sort((a, b) => a.x - b.x)
  const offsets = new Array<number>(points.length).fill(0)
  const placed: { x: number; y: number }[] = []
  for (const { x, y, index } of order) {
    let offset = 0
    const clash = () =>
      placed.some((p) => x - p.x < ERA_GAP && Math.abs(y + offset - p.y) < ERA_ROW)
    for (let tries = 0; tries < 4 && clash(); tries++) offset += ERA_ROW
    offsets[index] = offset
    placed.push({ x, y: y + offset })
  }
  return offsets
}

export function pinchFactor(start: number, distance: number): number {
  if (!(start > 0) || !(distance > 0)) return 1
  return Math.min(Math.max(start / distance, 0.05), 20)
}
