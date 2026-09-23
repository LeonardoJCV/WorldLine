import { ASSIMILATION, KEEP } from '../../engine/echo.ts'
import type { Crossing, CrossingKind } from '../../engine/crossing.ts'
import { axisPoint, type PathData } from './path.ts'
import type { Vec3 } from './camera.ts'

export const ECHO_YEARS = 30
export const MAX_ARCS = 12

export const ECHO_KINDS: readonly CrossingKind[] = ['knowledge', 'resource']

export interface CrossingWorld {
  readonly id: string
  readonly crossings: readonly Crossing[]
  readonly path: PathData
}

export interface CrossingArc {
  readonly key: string
  readonly kind: CrossingKind
  readonly year: number
  readonly from: Vec3
  readonly to: Vec3
  readonly origin: string
  readonly destination: string
  readonly cost: number
  readonly amounts: readonly number[]
}

export interface EchoWindow {
  readonly world: string
  readonly from: number
  readonly to: number
}

export interface EchoAxisWindow {
  readonly world: string
  readonly from: number
  readonly to: number
}

export function crossingArcs(
  worlds: readonly CrossingWorld[],
  from: number,
  to: number,
): CrossingArc[] {
  const span = Math.max(1, to - from)
  const byId = new Map(worlds.map((world) => [world.id, world] as const))
  const arcs: CrossingArc[] = []
  for (const world of worlds) {
    if (!world.path.visible) continue
    for (const crossing of world.crossings) {
      if (crossing.direction !== 'in') continue
      if (crossing.tick < from || crossing.tick > to) continue
      if (crossing.origin.tick < from || crossing.origin.tick > to) continue
      const originWorld = byId.get(crossing.origin.world)
      if (!originWorld || !originWorld.path.visible) continue
      const start = axisPoint(originWorld.path, (crossing.origin.tick - from) / span)
      const end = axisPoint(world.path, (crossing.tick - from) / span)
      if (!start || !end) continue
      arcs.push({
        key: `crossing:${world.id}:${crossing.tick}:${crossing.kind}`,
        kind: crossing.kind,
        year: crossing.tick,
        from: start,
        to: end,
        origin: crossing.origin.world,
        destination: world.id,
        cost: crossing.cost,
        amounts: crossing.amounts,
      })
    }
  }
  arcs.sort((a, b) => a.year - b.year)
  return arcs.length > MAX_ARCS ? arcs.slice(arcs.length - MAX_ARCS) : arcs
}

export function echoWindows(
  worlds: readonly Pick<CrossingWorld, 'id' | 'crossings'>[],
): EchoWindow[] {
  const windows: EchoWindow[] = []
  for (const world of worlds) {
    for (const crossing of world.crossings) {
      if (crossing.direction !== 'in') continue
      if (!ECHO_KINDS.includes(crossing.kind)) continue
      windows.push({ world: world.id, from: crossing.tick, to: crossing.tick + ECHO_YEARS })
    }
  }
  return windows
}

export function echoAxisWindows(
  worlds: readonly Pick<CrossingWorld, 'id' | 'crossings'>[],
  from: number,
  to: number,
): EchoAxisWindow[] {
  const span = Math.max(1, to - from)
  // FEAT: um mundo com mais de uma janela sobreposta só acende a mais recente
  const recent = new Map<string, EchoWindow>()
  for (const window of echoWindows(worlds)) {
    const current = recent.get(window.world)
    if (!current || window.from > current.from) recent.set(window.world, window)
  }
  return [...recent.values()].map((window) => ({
    world: window.world,
    from: (window.from - from) / span,
    to: (window.to - from) / span,
  }))
}

export function assimilationLeft(
  kind: CrossingKind,
  amounts: readonly number[],
  year: number,
  observed: number,
): number {
  if (!ECHO_KINDS.includes(kind)) return 0
  if (observed < year) return 0
  const initial = amounts.reduce((sum, amount) => sum + amount, 0)
  const decay = (1 - ASSIMILATION) * KEEP
  return initial * decay ** (observed - year)
}
