export const PANELS = [
  'state',
  'allocation',
  'cross',
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
