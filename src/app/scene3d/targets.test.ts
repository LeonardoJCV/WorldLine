import { describe, expect, it } from 'vitest'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { RangeResult } from '../sim/client.ts'
import { FOCUS_RADIUS, pickTarget, type Vec3 } from './camera.ts'
import { buildPath, headPoint } from './path.ts'
import type { Site } from '../surface/sites.ts'
import { EVENT_PICK, microKey, microTarget, screenTargets, type TargetWorld } from './targets.ts'

function series(): RangeResult {
  const out = {} as Record<Variable, Float32Array>
  for (const variable of VARIABLES) out[variable] = new Float32Array(11).fill(50)
  out.population = new Float32Array(11).fill(1e6)
  return { from: 0, to: 100, series: out }
}

function world(key: string, focused: boolean, lift: number): TargetWorld {
  const path = buildPath(series(), new Float32Array(16 * 2).fill(lift), 0, 100, 0, 16)
  return { key, focused, path, head: headPoint(path) }
}

const project = (point: Vec3) => ({
  x: point[0] * 10 + 500,
  y: point[1] * 100 + 300,
  visible: true,
})

describe('screenTargets', () => {
  const worlds = [world('A:0', true, 0), world('B:1', false, 1)]

  it('focuses another world from its planet or its stream', () => {
    const targets = screenTargets(worlds, [], project)
    const head = worlds[1]?.head
    if (!head) throw new Error('missing head')
    const p = project(head)
    expect(pickTarget(targets, p.x, p.y)).toMatchObject({ kind: 'world', key: 'B' })
    expect(pickTarget(targets, 500, 402)).toMatchObject({ kind: 'world', key: 'B' })
  })

  it('enters the focused planet within its projected radius, and falls through outside it', () => {
    const targets = screenTargets(worlds, [], project)
    const head = worlds[0]?.head
    if (!head) throw new Error('missing head')
    const p = project(head)
    const edge = project([head[0], head[1] + FOCUS_RADIUS, head[2]])
    const radius = Math.hypot(edge.x - p.x, edge.y - p.y)
    expect(pickTarget(targets, p.x, p.y)).toMatchObject({ kind: 'enter', key: 'A' })
    expect(pickTarget(targets, p.x + radius + 20, p.y)).toBeNull()
  })

  it('selects events on the focused stream', () => {
    const targets = screenTargets(
      worlds,
      [
        { key: '3', kind: 'event', position: [0, 0, 0] },
        { key: 'fork:B', kind: 'fork', position: [1, 0, 0] },
      ],
      project,
    )
    expect(pickTarget(targets, 501, 300)).toMatchObject({ kind: 'event', key: '3' })
    expect(targets.some((target) => target.key === 'fork:B')).toBe(false)
  })
})

describe('microTarget', () => {
  const sites: Site[] = Array.from({ length: 5 }, (_, index) => ({
    index,
    dir: [index / 10, 1, 0],
    height: 0.1,
    coast: false,
    score: 1,
  }))

  it('decodes the key of a microevent into a planet target', () => {
    expect(microTarget(microKey({ year: 1724, kind: 'fire', site: 3 }), sites)).toEqual({
      dir: sites[3]?.dir,
      year: 1724,
      site: 3,
      kind: 'fire',
    })
  })

  it('rejects other keys, missing sites and unknown kinds', () => {
    expect(microTarget('event:12', sites)).toBeNull()
    expect(microTarget('micro:1724:fire:9', sites)).toBeNull()
    expect(microTarget('micro:1724:flood:3', sites)).toBeNull()
    expect(microTarget('micro:abc:fire:3', sites)).toBeNull()
    expect(microTarget('micro:17.5:fire:3', sites)).toBeNull()
    expect(microTarget('micro::fire:3', sites)).toBeNull()
  })

  it('turns visible micro markers into pick targets', () => {
    const targets = screenTargets(
      [],
      [{ key: 'micro:1724:fire:3', kind: 'micro', position: [0, 0, 0] }],
      project,
    )
    expect(targets).toEqual([
      { kind: 'micro', key: 'micro:1724:fire:3', x: 500, y: 300, radius: EVENT_PICK },
    ])
  })
})
