import type { View } from '../sim/store.ts'
import { zoomView } from './view.ts'

export interface KeyState {
  readonly present: number
  readonly cursor: number | null
  readonly view: View | null
}

export type KeyEffect = { readonly cursor: number | null } | { readonly view: View | null }

const ZOOM: Readonly<Record<string, number>> = { '+': 0.8, '=': 0.8, '-': 1.25 }

export function currentKey(key: string, shift: boolean, state: KeyState): KeyEffect | null {
  const { present, cursor, view } = state
  if (Object.hasOwn(ZOOM, key)) {
    return { view: zoomView(view, present, cursor ?? present, ZOOM[key] ?? 1) }
  }
  if (key === '0') return { view: null }
  const base = cursor ?? present
  const stride = shift ? 10 : 1
  switch (key) {
    case 'ArrowLeft':
      return { cursor: base - stride }
    case 'ArrowRight':
      return { cursor: base + stride }
    case 'Home':
      return { cursor: 0 }
    case 'End':
    case 'Escape':
      return { cursor: null }
    default:
      return null
  }
}
