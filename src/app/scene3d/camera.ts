export type Vec3 = readonly [number, number, number]

export interface Pose {
  readonly target: Vec3
  readonly position: Vec3
}

export const RAIL_BACK = 10.5
export const RAIL_OFFSET: Vec3 = [-3, 4, 15.5]
export const FOCUS_RADIUS = 0.9
export const OTHER_RADIUS = 0.45

export function railPose(head: Vec3): Pose {
  const target: Vec3 = [head[0] - RAIL_BACK, head[1], head[2]]
  return {
    target,
    position: [target[0] + RAIL_OFFSET[0], target[1] + RAIL_OFFSET[1], target[2] + RAIL_OFFSET[2]],
  }
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
  readonly kind: 'world' | 'event'
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
