import { describe, expect, it } from 'vitest'
import { MIN_SPAN, centerView, panView, resolveView, zoomView } from './view.ts'

const PRESENT = 1000

describe('view', () => {
  it('shows the whole history by default', () => {
    expect(resolveView(null, PRESENT)).toEqual({ from: 0, to: 1000 })
  })

  it('zooms around the focus year', () => {
    const view = zoomView(null, PRESENT, 250, 0.5)
    expect(view).toEqual({ span: 500, end: 625 })
    expect(resolveView(view, PRESENT)).toEqual({ from: 125, to: 625 })
  })

  it('keeps following the present when the window touches it', () => {
    expect(zoomView(null, PRESENT, 1000, 0.5)).toEqual({ span: 500, end: null })
    expect(resolveView({ span: 500, end: null }, 1200)).toEqual({ from: 700, to: 1200 })
  })

  it('never zooms below the minimum span', () => {
    const window = resolveView(zoomView({ span: 30, end: 500 }, PRESENT, 490, 0.1), PRESENT)
    expect(window.to - window.from).toBe(MIN_SPAN)
  })

  it('returns to the full view when zooming out past the history', () => {
    expect(zoomView({ span: 800, end: 900 }, PRESENT, 500, 2)).toBeNull()
  })

  it('pans within the history and clamps at both ends', () => {
    expect(panView({ span: 200, end: 500 }, PRESENT, -1000)).toEqual({ span: 200, end: 200 })
    expect(panView({ span: 200, end: 500 }, PRESENT, 1000)).toEqual({ span: 200, end: null })
  })

  it('centers the window on a year', () => {
    expect(centerView({ span: 200, end: 500 }, PRESENT, 700)).toEqual({ span: 200, end: 800 })
  })

  it('fits a fixed window into a shorter history', () => {
    expect(resolveView({ span: 300, end: 900 }, 200)).toEqual({ from: 0, to: 200 })
  })
})
