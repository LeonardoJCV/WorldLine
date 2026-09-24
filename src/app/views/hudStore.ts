import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  readCollapsed,
  toggleCollapsed,
  writeCollapsed,
  type Collapsed,
  type PanelId,
  type SheetState,
} from './hud.ts'

export interface HudState {
  readonly collapsed: Collapsed
  readonly sheet: SheetState
  toggle(id: PanelId): void
  setSheet(sheet: SheetState): void
}

export const hudStore = createStore<HudState>()((set, get) => ({
  collapsed: readCollapsed(),
  // FEAT: o celular abre espreitando: o universo em cima, os cartões ao alcance do polegar
  sheet: 'peek',
  toggle(id) {
    const collapsed = toggleCollapsed(get().collapsed, id)
    set({ collapsed })
    writeCollapsed(collapsed)
  },
  setSheet(sheet) {
    set({ sheet })
  },
}))

export function useCollapsed(id: PanelId): boolean {
  return useStore(hudStore, (state) => state.collapsed[id])
}

export function useSheet(): SheetState {
  return useStore(hudStore, (state) => state.sheet)
}
