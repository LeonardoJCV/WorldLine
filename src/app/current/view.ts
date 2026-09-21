import type { View } from '../sim/store.ts'

export const MIN_SPAN = 20

export interface Window {
  readonly from: number
  readonly to: number
}

export function resolveView(view: View | null, present: number): Window {
  if (view === null || present <= 0) return { from: 0, to: Math.max(present, 0) }
  const span = Math.min(Math.max(view.span, 1), present)
  const to = view.end === null ? present : Math.min(Math.max(view.end, span), present)
  return { from: to - span, to }
}

function toView(from: number, span: number, present: number): View | null {
  if (span >= present) return null
  const start = Math.min(Math.max(from, 0), present - span)
  const end = start + span
  return { span, end: end >= present ? null : end }
}

export function zoomView(
  view: View | null,
  present: number,
  focus: number,
  factor: number,
): View | null {
  const { from, to } = resolveView(view, present)
  const current = Math.max(to - from, 1)
  const span = Math.round(Math.min(Math.max(current * factor, MIN_SPAN), present))
  const ratio = (focus - from) / current
  return toView(Math.round(focus - ratio * span), span, present)
}

export function panView(view: View | null, present: number, delta: number): View | null {
  const { from, to } = resolveView(view, present)
  return toView(from + Math.round(delta), to - from, present)
}

export function centerView(view: View | null, present: number, year: number): View | null {
  const { from, to } = resolveView(view, present)
  const span = to - from
  return toView(Math.round(year - span / 2), span, present)
}
