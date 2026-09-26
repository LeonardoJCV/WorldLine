export const PANELS = [
  'state',
  'allocation',
  'cross',
  'merge',
  'events',
  'causal',
  'worlds',
  'actions',
] as const

export type PanelId = (typeof PANELS)[number]
export type Collapsed = Readonly<Record<PanelId, boolean>>

const KEY = 'worldline.hud'

export const NOTHING_COLLAPSED: Collapsed = {
  state: false,
  allocation: false,
  cross: false,
  merge: false,
  events: false,
  causal: false,
  worlds: false,
  actions: false,
}

export function isPanel(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANELS as readonly string[]).includes(value)
}

export function toggleCollapsed(collapsed: Collapsed, id: PanelId): Collapsed {
  const next: Record<PanelId, boolean> = { ...collapsed }
  next[id] = !collapsed[id]
  return next
}

export function parseCollapsed(raw: string | null): Collapsed {
  const next: Record<PanelId, boolean> = { ...NOTHING_COLLAPSED }
  if (raw === null) return next
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return next
    const stored = parsed as Readonly<Record<string, unknown>>
    for (const id of PANELS) if (stored[id] === true) next[id] = true
    return next
  } catch {
    return next
  }
}

export function serializeCollapsed(collapsed: Collapsed): string {
  return JSON.stringify(collapsed)
}

export function readCollapsed(): Collapsed {
  try {
    return parseCollapsed(localStorage.getItem(KEY))
  } catch {
    return NOTHING_COLLAPSED
  }
}

export function writeCollapsed(collapsed: Collapsed): void {
  try {
    localStorage.setItem(KEY, serializeCollapsed(collapsed))
  } catch {
    // armazenamento bloqueado: o arranjo vale só nesta sessão
  }
}

export const SHEET_STATES = ['hidden', 'peek', 'open'] as const

export type SheetState = (typeof SHEET_STATES)[number]

// FEAT: frações da altura do palco; escondida deixa o universo inteiro à vista
export const SHEET_HEIGHTS: Readonly<Record<SheetState, number>> = {
  hidden: 0.12,
  peek: 0.4,
  open: 0.85,
}

export const SHEET_MIN = 76

export function nextSheet(state: SheetState): SheetState {
  const index = SHEET_STATES.indexOf(state)
  return SHEET_STATES[(index + 1) % SHEET_STATES.length] ?? 'hidden'
}

export function clampSheet(fraction: number): number {
  if (!Number.isFinite(fraction)) return SHEET_HEIGHTS.hidden
  return Math.min(SHEET_HEIGHTS.open, Math.max(SHEET_HEIGHTS.hidden, fraction))
}

export function snapSheet(fraction: number): SheetState {
  const height = clampSheet(fraction)
  let nearest: SheetState = 'hidden'
  let distance = Number.POSITIVE_INFINITY
  for (const state of SHEET_STATES) {
    const gap = Math.abs(SHEET_HEIGHTS[state] - height)
    if (gap < distance) {
      distance = gap
      nearest = state
    }
  }
  return nearest
}

export function sheetHeight(state: SheetState, available: number): number {
  const room = Math.max(0, available)
  const exact = Math.round(SHEET_HEIGHTS[state] * room)
  return state === 'hidden' ? Math.min(room, Math.max(SHEET_MIN, exact)) : exact
}

export function dragSheet(height: number, available: number): number {
  if (!Number.isFinite(height)) return sheetHeight('hidden', available)
  const low = sheetHeight('hidden', available)
  const high = sheetHeight('open', available)
  return Math.min(Math.max(low, high), Math.max(low, Math.round(height)))
}

// FEAT: o palco cede à folha só até a altura de espreita; mais alta que isso, ela já cobre o resto
export function sheetReserve(state: SheetState, available: number): number {
  return Math.min(sheetHeight(state, available), sheetHeight('peek', available))
}
