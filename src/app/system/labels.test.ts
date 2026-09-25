import { describe, expect, it } from 'vitest'
import { layoutLabels, type LabelBox, type LabelFrame, type LabelSpot } from './labels.ts'

const PHONE: LabelFrame = { width: 390, height: 844, gutter: 16, floor: 52 }
const DESKTOP: LabelFrame = { width: 1440, height: 900, gutter: 16, floor: 52 }

function box(index: number, x: number, y: number, width = 180, height = 16): LabelBox {
  return { index, x, y, width, height, visible: true }
}

function rects(spots: readonly LabelSpot[], boxes: readonly LabelBox[]) {
  return spots
    .filter((spot) => spot.visible)
    .map((spot) => {
      const source = boxes.find((candidate) => candidate.index === spot.index)
      if (!source) throw new Error(`no box for label ${spot.index}`)
      return {
        index: spot.index,
        left: spot.left,
        top: spot.top,
        right: spot.left + source.width,
        bottom: spot.top + source.height,
      }
    })
}

function collisions(spots: readonly LabelSpot[], boxes: readonly LabelBox[]): string[] {
  const placed = rects(spots, boxes)
  const found: string[] = []
  for (const a of placed) {
    for (const b of placed) {
      if (a.index >= b.index) continue
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        found.push(`${a.index}x${b.index}`)
      }
    }
  }
  return found
}

describe('layoutLabels', () => {
  it('pushes two labels drawn on the same spot apart', () => {
    // FEAT: o caso de 390x844 da semente 482913 — Shosen e Lulia pediam a mesma linha
    const boxes = [box(0, 200, 511, 160), box(1, 250, 519, 190)]
    const spots = layoutLabels(boxes, PHONE)
    expect(collisions(spots, boxes)).toEqual([])
  })

  it('keeps five labels stacked on one point all readable', () => {
    const boxes = [0, 1, 2, 3, 4].map((i) => box(i, 195, 400))
    const spots = layoutLabels(boxes, PHONE)
    expect(collisions(spots, boxes)).toEqual([])
    expect(new Set(spots.map((spot) => spot.top)).size).toBe(5)
  })

  it('leaves labels that do not touch each other exactly where they were asked for', () => {
    const boxes = [box(0, 100, 200, 120), box(1, 300, 600, 120)]
    const spots = layoutLabels(boxes, DESKTOP)
    expect(spots.map((spot) => ({ left: spot.left, top: spot.top }))).toEqual([
      { left: 40, top: 200 },
      { left: 240, top: 600 },
    ])
  })

  it('clamps a label to the frame instead of letting the container crop it', () => {
    // FEAT: "Drogrades — no one there" terminava rente a x=390 de 390, com zero de folga
    const boxes = [box(0, 380, 500, 170), box(1, 4, 700, 170)]
    const spots = layoutLabels(boxes, PHONE)
    for (const rect of rects(spots, boxes)) {
      expect(rect.left).toBeGreaterThanOrEqual(PHONE.gutter)
      expect(rect.right).toBeLessThanOrEqual(PHONE.width - PHONE.gutter)
    }
  })

  it('keeps every label off the band the minimap draws in', () => {
    const boxes = [box(0, 700, 880, 200), box(1, 300, 863, 200)]
    const spots = layoutLabels(boxes, DESKTOP)
    for (const rect of rects(spots, boxes)) {
      expect(rect.bottom).toBeLessThanOrEqual(DESKTOP.height - DESKTOP.floor)
      expect(rect.top).toBeGreaterThanOrEqual(DESKTOP.gutter)
    }
  })

  it('never lets the de-collision pass push a label out of the frame', () => {
    const boxes = [0, 1, 2, 3, 4, 5].map((i) => box(i, 195, 800))
    const spots = layoutLabels(boxes, PHONE)
    expect(collisions(spots, boxes)).toEqual([])
    for (const rect of rects(spots, boxes)) {
      expect(rect.top).toBeGreaterThanOrEqual(PHONE.gutter)
      expect(rect.bottom).toBeLessThanOrEqual(PHONE.height - PHONE.floor)
    }
  })

  it('is deterministic and keeps one spot per label, hidden ones included', () => {
    const boxes = [box(0, 200, 511), box(1, 250, 519), { ...box(2, 9, 9), visible: false }]
    const first = layoutLabels(boxes, PHONE)
    expect(layoutLabels(boxes, PHONE)).toEqual(first)
    expect(first.map((spot) => spot.index).sort()).toEqual([0, 1, 2])
    expect(first.find((spot) => spot.index === 2)?.visible).toBe(false)
  })

  it('does not let a hidden label reserve room from a visible one', () => {
    const boxes = [{ ...box(0, 200, 400), visible: false }, box(1, 200, 400)]
    const spots = layoutLabels(boxes, PHONE)
    expect(spots.find((spot) => spot.index === 1)?.top).toBe(400)
  })
})
