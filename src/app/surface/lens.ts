import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type Lens = 'current' | 'planet'

export interface LensState {
  readonly lens: Lens
  setLens(lens: Lens): void
}

export const lensStore = createStore<LensState>()((set) => ({
  lens: 'current',
  setLens(lens) {
    set({ lens })
  },
}))

export function useLens(): Lens {
  return useStore(lensStore, (s) => s.lens)
}
