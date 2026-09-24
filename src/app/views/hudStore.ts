import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  readCollapsed,
  toggleCollapsed,
  writeCollapsed,
  type Collapsed,
  type PanelId,
} from './hud.ts'

export interface HudState {
  readonly collapsed: Collapsed
  toggle(id: PanelId): void
}

export const hudStore = createStore<HudState>()((set, get) => ({
  collapsed: readCollapsed(),
  toggle(id) {
    const collapsed = toggleCollapsed(get().collapsed, id)
    set({ collapsed })
    writeCollapsed(collapsed)
  },
}))

export function useCollapsed(id: PanelId): boolean {
  return useStore(hudStore, (state) => state.collapsed[id])
}
