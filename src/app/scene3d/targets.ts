import { FOCUS_RADIUS, type ScreenTarget, type Vec3 } from './camera.ts'
import { axisPoint, type PathData } from './path.ts'

export const OTHER_PLANET_PICK = 32
export const STREAM_PICK = 14
export const EVENT_PICK = 10

export interface TargetWorld {
  readonly key: string
  readonly focused: boolean
  readonly path: PathData
  readonly head: Vec3 | null
}

export interface TargetMarker {
  readonly key: string
  readonly kind: 'event' | 'decision' | 'fork'
  readonly position: Vec3
}

interface ScreenPoint {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export function screenTargets(
  worlds: readonly TargetWorld[],
  markers: readonly TargetMarker[],
  project: (point: Vec3) => ScreenPoint,
): ScreenTarget[] {
  const list: ScreenTarget[] = []
  for (const world of worlds) {
    if (!world.path.visible) continue
    const id = world.key.split(':')[0] ?? ''
    if (world.focused) {
      if (world.head) {
        const p = project(world.head)
        if (p.visible) {
          const edge = project([world.head[0], world.head[1] + FOCUS_RADIUS, world.head[2]])
          const radius = Math.hypot(edge.x - p.x, edge.y - p.y)
          list.push({ kind: 'enter', key: id, x: p.x, y: p.y, radius })
        }
      }
      continue
    }
    if (world.head) {
      const p = project(world.head)
      if (p.visible)
        list.push({ kind: 'world', key: id, x: p.x, y: p.y, radius: OTHER_PLANET_PICK })
    }
    for (let k = 0; k <= 16; k++) {
      const u = world.path.alive[0] + ((world.path.alive[1] - world.path.alive[0]) * k) / 16
      const point = axisPoint(world.path, u)
      const p = point ? project(point) : null
      if (p?.visible) list.push({ kind: 'world', key: id, x: p.x, y: p.y, radius: STREAM_PICK })
    }
  }
  for (const marker of markers) {
    if (marker.kind !== 'event') continue
    const p = project(marker.position)
    if (p.visible) list.push({ kind: 'event', key: marker.key, x: p.x, y: p.y, radius: EVENT_PICK })
  }
  return list
}
