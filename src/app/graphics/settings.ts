export const GRAPHICS = ['auto', 'low', 'high', 'ultra', '2d'] as const
export type GraphicsSetting = (typeof GRAPHICS)[number]
export type Tier = 'low' | 'high' | 'ultra'
export type PlanetDetail = 'disc' | 'base' | 'clouds' | 'max'
export type Stage = '3d' | '2d'

export interface TierSpec {
  readonly particles: number
  readonly bloom: number
  readonly bloomHalf: boolean
  readonly dpr: number
  readonly focus: PlanetDetail
  readonly others: PlanetDetail
}

export const TIERS: Readonly<Record<Tier, TierSpec>> = {
  low: { particles: 4000, bloom: 0, bloomHalf: false, dpr: 1, focus: 'base', others: 'disc' },
  high: {
    particles: 30000,
    bloom: 0.9,
    bloomHalf: false,
    dpr: 1.5,
    focus: 'clouds',
    others: 'base',
  },
  ultra: { particles: 80000, bloom: 1.35, bloomHalf: true, dpr: 2, focus: 'max', others: 'clouds' },
}

export const AUTO_START: Tier = 'high'
export const MEASURE_DELAY_MS = 2000
export const MEASURE_FRAMES = 60

const SETTING_KEY = 'worldline.graphics'
const MEASURED_KEY = 'worldline.tier'

export function chooseTier(frameMs: number, software: boolean): Tier {
  if (!(frameMs <= 20)) return 'low'
  if (frameMs < 9 && !software) return 'ultra'
  return 'high'
}

export function resolveStage(
  setting: GraphicsSetting,
  env: { readonly webgl: boolean; readonly reducedMotion: boolean },
): Stage {
  if (!env.webgl || setting === '2d') return '2d'
  if (setting === 'auto' && env.reducedMotion) return '2d'
  return '3d'
}

export function tierOf(setting: GraphicsSetting, measured: Tier | null): Tier {
  if (setting === 'low' || setting === 'high' || setting === 'ultra') return setting
  return measured ?? AUTO_START
}

function isSetting(value: unknown): value is GraphicsSetting {
  return typeof value === 'string' && (GRAPHICS as readonly string[]).includes(value)
}

function isTier(value: unknown): value is Tier {
  return value === 'low' || value === 'high' || value === 'ultra'
}

export function readSetting(): GraphicsSetting {
  try {
    const value = localStorage.getItem(SETTING_KEY)
    return isSetting(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeSetting(setting: GraphicsSetting): void {
  try {
    localStorage.setItem(SETTING_KEY, setting)
  } catch {
    // armazenamento bloqueado: a escolha vale só nesta sessão
  }
}

export function readMeasured(): Tier | null {
  try {
    const value = sessionStorage.getItem(MEASURED_KEY)
    return isTier(value) ? value : null
  } catch {
    return null
  }
}

export function writeMeasured(tier: Tier): void {
  try {
    sessionStorage.setItem(MEASURED_KEY, tier)
  } catch {
    // armazenamento bloqueado: mede de novo na próxima sessão
  }
}
