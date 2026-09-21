import { describe, expect, it } from 'vitest'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { RangeResult } from '../sim/client.ts'
import { pickTarget, type Vec3 } from './camera.ts'
import { buildPath, headPoint } from './path.ts'
import { screenTargets, type TargetWorld } from './targets.ts'

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

  it('lets a click on the focused planet fall through to scrubbing', () => {
    const targets = screenTargets(worlds, [], project)
    const head = worlds[0]?.head
    if (!head) throw new Error('missing head')
    const p = project(head)
    expect(pickTarget(targets, p.x, p.y)).toBeNull()
    expect(targets.some((target) => target.key === 'A')).toBe(false)
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
