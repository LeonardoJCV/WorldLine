import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  readMeasured,
  readSetting,
  resolveStage,
  tierOf,
  writeMeasured,
  writeSetting,
  type GraphicsSetting,
  type Stage,
  type Tier,
} from './settings.ts'

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
  } catch {
    return false
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export interface GraphicsState {
  readonly setting: GraphicsSetting
  readonly measured: Tier | null
  readonly webgl: boolean
  readonly reducedMotion: boolean
  setSetting(setting: GraphicsSetting): void
  setMeasured(tier: Tier): void
  setWebglFailed(): void
}

export const graphicsStore = createStore<GraphicsState>()((set) => ({
  setting: readSetting(),
  measured: readMeasured(),
  webgl: supportsWebGL(),
  reducedMotion: prefersReducedMotion(),
  setSetting(setting) {
    set({ setting })
    writeSetting(setting)
  },
  setMeasured(tier) {
    set({ measured: tier })
    writeMeasured(tier)
  },
  setWebglFailed() {
    set({ webgl: false })
  },
}))

export function useGraphics<T>(selector: (state: GraphicsState) => T): T {
  return useStore(graphicsStore, selector)
}

export function useStage(): Stage {
  return useGraphics((s) => resolveStage(s.setting, s))
}

export function useTier(): Tier {
  return useGraphics((s) => tierOf(s.setting, s.measured))
}
