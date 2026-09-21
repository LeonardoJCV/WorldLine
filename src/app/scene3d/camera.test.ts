import { describe, expect, it } from 'vitest'
import { RAIL_BACK, RAIL_OFFSET, approach, pickTarget, railPose, yearAtPointer } from './camera.ts'

describe('railPose', () => {
  it('looks at the focused present from behind and to the left', () => {
    const pose = railPose([12, 1, -2])
    expect(pose.target).toEqual([12 - RAIL_BACK, 1, -2])
    expect(pose.position).toEqual([
      12 - RAIL_BACK + RAIL_OFFSET[0],
      1 + RAIL_OFFSET[1],
      -2 + RAIL_OFFSET[2],
    ])
  })

  it('approaches the goal smoothly', () => {
    const next = approach([0, 0, 0], [10, 0, 0], 0.1)
    expect(next[0]).toBeGreaterThan(0)
    expect(next[0]).toBeLessThan(10)
    expect(approach([0, 0, 0], [10, 0, 0], 10)).toEqual([10, 0, 0])
  })
})

describe('yearAtPointer', () => {
  it('projects the pointer onto the screen segment of the axis', () => {
    expect(yearAtPointer({ x: 50, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 1000)).toBe(500)
    expect(yearAtPointer({ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 1000)).toBe(0)
    expect(yearAtPointer({ x: 500, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 1000)).toBe(1000)
  })
})

describe('pickTarget', () => {
  const targets = [
    { kind: 'world' as const, key: 'A', x: 100, y: 100, radius: 30 },
    { kind: 'event' as const, key: '3', x: 110, y: 100, radius: 8 },
  ]

  it('prefers the target whose radius the pointer is deepest inside', () => {
    expect(pickTarget(targets, 110, 100)?.key).toBe('3')
    expect(pickTarget(targets, 80, 100)?.key).toBe('A')
  })

  it('returns nothing far from every target', () => {
    expect(pickTarget(targets, 400, 400)).toBeNull()
  })
})
