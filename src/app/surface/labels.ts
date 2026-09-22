import type { City } from './civilization.ts'
import type { Vec3 } from './cube.ts'
import type { MicroEvent } from './micro.ts'
import type { Site } from './sites.ts'
import { surfaceRadius } from './terrain.ts'

export const RECENT_YEARS = 5
export const CARD_EVENTS = 6
const LIFT = 0.002

export function anchorOf(site: Site): Vec3 {
  const r = surfaceRadius(site.height) + LIFT
  return [site.dir[0] * r, site.dir[1] * r, site.dir[2] * r]
}

export function recentEvents(events: readonly MicroEvent[], tick: number): MicroEvent[] {
  return events.filter(
    (e) => (e.year >= tick - RECENT_YEARS && e.kind !== 'founding') || e.year === tick,
  )
}

export function cityEvents(events: readonly MicroEvent[], site: number): MicroEvent[] {
  const out: MicroEvent[] = []
  for (let i = events.length - 1; i >= 0 && out.length < CARD_EVENTS; i--) {
    const e = events[i]
    if (e?.site === site) out.push(e)
  }
  return out
}

// a fundação anual é exata; a do modelo vem de médias por balde
export function foundedYear(events: readonly MicroEvent[], city: City): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.site === city.site && e.kind === 'founding') return e.year
  }
  return city.founded
}
