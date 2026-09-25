import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { MicroKind } from './micro.ts'

export type Lens = 'current' | 'planet' | 'system'

export interface LensTarget {
  readonly dir: readonly [number, number, number]
  readonly year: number
  readonly site: number
  readonly kind: MicroKind
}

export interface LensState {
  readonly lens: Lens
  readonly target: LensTarget | null
  setLens(lens: Lens): void
  openAt(target: LensTarget): void
  clearTarget(): void
}

export const lensStore = createStore<LensState>()((set) => ({
  lens: 'current',
  target: null,
  setLens(lens) {
    // FIX: só o planeta abre alvo; Corrente e sistema o descartam, como a Corrente já fazia
    set(lens === 'planet' ? { lens } : { lens, target: null })
  },
  openAt(target) {
    set({ lens: 'planet', target })
  },
  clearTarget() {
    set({ target: null })
  },
}))

export function useLens(): Lens {
  return useStore(lensStore, (s) => s.lens)
}
