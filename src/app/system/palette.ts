import type { BodyKind } from '../../engine/system.ts'
import { uniform } from '../../engine/rng.ts'
import type { Snapshot } from '../../worker/protocol.ts'
import { hexToRgb, mixRgb, type Rgb } from '../theme/color.ts'
import {
  planetPalette,
  planetState,
  type PlanetPalette,
  type PlanetState,
} from '../planet/uniforms.ts'
import { STRIDE, SYSTEM_CHANNEL, type PlacedBody } from './model.ts'

// FEAT: primeiro deslocamento livre da paleta — 0..3 já pertencem à colocação da Tarefa 2
const OFFSET = 4

// FEAT: par seco/úmido por tipo, para o mesmo formato de mistura do mundo natal render cada corpo com jeito próprio
interface KindPalette {
  readonly arid: readonly [Rgb, Rgb]
  readonly wet: readonly [Rgb, Rgb]
  readonly deep: readonly [Rgb, Rgb]
  readonly shallow: readonly [Rgb, Rgb]
  readonly sky: readonly [Rgb, Rgb]
  // FEAT: faixa do nível do mar sorteada; null é o gasoso, que não tem mar nenhum
  readonly sea: readonly [number, number] | null
}

const ROCKY: KindPalette = {
  arid: [hexToRgb('#a9743f'), hexToRgb('#6b4226')],
  wet: [hexToRgb('#8a6a3a'), hexToRgb('#4f6a3a')],
  deep: [hexToRgb('#23364a'), hexToRgb('#3a2418')],
  shallow: [hexToRgb('#3f5e73'), hexToRgb('#6b4a2c')],
  sky: [hexToRgb('#d9b98a'), hexToRgb('#e0c9a6')],
  sea: [0.3, 0.42],
}

const ICE: KindPalette = {
  arid: [hexToRgb('#c7d3e0'), hexToRgb('#9fb0c4')],
  wet: [hexToRgb('#b7c9c6'), hexToRgb('#8fa9a3')],
  deep: [hexToRgb('#132c42'), hexToRgb('#1c3a52')],
  shallow: [hexToRgb('#6f9db8'), hexToRgb('#8fc0d6')],
  sky: [hexToRgb('#dcecff'), hexToRgb('#eef6ff')],
  sea: [0.18, 0.28],
}

const GAS: KindPalette = {
  arid: [hexToRgb('#c9a06a'), hexToRgb('#8a5a3a')],
  wet: [hexToRgb('#d8c39a'), hexToRgb('#a97b4f')],
  deep: [hexToRgb('#6b4a2c'), hexToRgb('#3a2818')],
  shallow: [hexToRgb('#e6c98f'), hexToRgb('#b98a52')],
  sky: [hexToRgb('#f0d9a8'), hexToRgb('#c9a06a')],
  sea: null,
}

const KIND: Readonly<Record<BodyKind, KindPalette>> = { rocky: ROCKY, ice: ICE, gas: GAS }
const SNOW = hexToRgb('#e6e4f5')
const SMOG = hexToRgb('#8a7a6a')
// FEAT: nível do mar do gasoso — baixo o bastante para nunca contar como mar, sem depender de sorteio
const NO_SEA = 0.02

function draw(seed: number, body: PlacedBody, k: number): number {
  // FEAT: só os deslocamentos 4..15 são da paleta; 0..3 já saíram na colocação
  return uniform(seed, 0, SYSTEM_CHANNEL + body.index * STRIDE + OFFSET + k)
}

export function bodyPalette(seed: number, body: PlacedBody): PlanetPalette {
  // FEAT: o corpo vivo é o mesmo mundo da lente do planeta — a paleta não pode mudar ao subir de lente
  if (body.living) return planetPalette(seed)
  const kind = KIND[body.kind]
  const t = (k: number) => draw(seed, body, k)
  const pick = (pair: readonly [Rgb, Rgb], k: number) => mixRgb(pair[0], pair[1], t(k))
  return {
    offset: [t(0) * 100, t(1) * 100, t(2) * 100],
    seaLevel: kind.sea ? kind.sea[0] + t(3) * (kind.sea[1] - kind.sea[0]) : NO_SEA,
    oceanDeep: pick(kind.deep, 4),
    oceanShallow: pick(kind.shallow, 5),
    vegetation: pick(kind.wet, 6),
    arid: pick(kind.arid, 7),
    snow: SNOW,
    atmosphere: pick(kind.sky, 8),
    smog: SMOG,
    tilt: 0.15 + t(9) * 0.3,
  }
}

// FEAT: gira o corpo antes do primeiro quadro — mesma textura, outro pedaço de litoral virado à câmera
export function bodyYaw(seed: number, body: PlacedBody): number {
  return draw(seed, body, 10) * Math.PI * 2
}

function unit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

const EMPTY_STATE: PlanetState = {
  vegetation: 0,
  lights: 0,
  haze: 0,
  ring: 0,
  satellites: 0,
  famine: 0,
  blight: 0,
  unrest: 0,
  extinct: 0,
  clouds: 0,
}

export function bodyState(body: PlacedBody, present: Snapshot): PlanetState {
  if (body.living) return planetState(present)
  // FEAT: a colônia é o único dado que se conhece de um corpo que não é o lar — só a luz dela aparece
  if (body.colony) {
    const lights = unit((Math.log10(Math.max(body.colony.population, 1)) - 5) / 3)
    return { ...EMPTY_STATE, lights }
  }
  // FEAT: o corpo natal abandonado ainda se lê como morto, não como se nunca tivesse tido dono
  return body.dead ? { ...EMPTY_STATE, extinct: 1 } : EMPTY_STATE
}
