import { EVENTS, type EventId, type EventRecord } from '../../engine/events.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { Series } from '../../worker/protocol.ts'
import { PLANET_BODY } from '../planet/uniforms.ts'
import { STRANDS, normalize, type Row, type Strand } from './normalize.ts'

export interface Frame {
  readonly left: number
  readonly right: number
  readonly centerY: number
  readonly height: number
}

export interface StageLayout {
  readonly frame: Frame
  readonly planet: { readonly size: number; readonly cx: number; readonly cy: number }
  readonly stacked: boolean
}

export const WAVELENGTH = 180
export const MIN_WIDTH = 1
export const MAX_WIDTH = 8
export const ERA_ROWS = 3
export const EPISODE_ROWS = 4
const NARROW = 720
const LABEL_GAP = 8
const BAND_GAP = 4

export function stageLayout(width: number, height: number): StageLayout {
  const gutter = Math.max(16, Math.round(width * 0.03))
  if (width < NARROW) {
    const size = Math.round(Math.min(width * 0.8, height * 0.5))
    const cy = gutter + size / 2
    const top = cy + size / 2
    const centerY = top + (height - top) / 2
    return {
      planet: { size, cx: width / 2, cy },
      frame: { left: gutter, right: width - gutter, centerY, height: height - top },
      stacked: true,
    }
  }
  const size = Math.round(Math.min(width * 0.42, height * 0.96, 640))
  const cx = width - gutter - size / 2
  const cy = height / 2
  return {
    planet: { size, cx, cy },
    frame: { left: gutter, right: cx - (size / 2) * PLANET_BODY * 1.04, centerY: cy, height },
    stacked: false,
  }
}

export function yearToX(year: number, from: number, to: number, frame: Frame): number {
  const span = Math.max(1, to - from)
  return frame.left + ((frame.right - frame.left) * (year - from)) / span
}

export function xToYear(x: number, from: number, to: number, frame: Frame): number {
  const span = Math.max(1, to - from)
  const year = from + ((x - frame.left) / Math.max(1, frame.right - frame.left)) * span
  return Math.min(to, Math.max(from, Math.round(year)))
}

export function seedPhase(seed: number): number {
  return ((seed % 360) * Math.PI) / 180
}

export interface Ribbon {
  readonly strand: Strand
  readonly xs: Float32Array
  readonly top: Float32Array
  readonly bottom: Float32Array
}

function jitter(strand: number, column: number): number {
  const s = Math.sin(strand * 127.1 + column * 311.7) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

export function movingAverage(values: Float32Array, radius: number): Float32Array {
  const result = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius)
    const end = Math.min(values.length - 1, i + radius)
    let sum = 0
    for (let j = start; j <= end; j++) sum += values[j] ?? 0
    result[i] = sum / (end - start + 1)
  }
  return result
}

export function sampleRow(series: Series, index: number): Row {
  const row = {} as Record<Variable, number>
  for (const variable of VARIABLES) row[variable] = series[variable][index] ?? 0
  return row
}

function rows(series: Series): Row[] {
  return Array.from({ length: series.population.length }, (_, i) => sampleRow(series, i))
}

export function buildRibbons(series: Series, frame: Frame, phase: number): Ribbon[] {
  const samples = rows(series)
  const count = samples.length
  const xs = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    xs[i] = count <= 1 ? frame.right : frame.left + ((frame.right - frame.left) * i) / (count - 1)
  }
  const amplitude = frame.height * 0.07

  return STRANDS.map((strand, s) => {
    const top = new Float32Array(count)
    const bottom = new Float32Array(count)
    const offset = (s * Math.PI * 2) / STRANDS.length
    const wavelength = WAVELENGTH * (1 + 0.14 * s)
    for (let i = 0; i < count; i++) {
      const row = samples[i]
      const x = xs[i] ?? 0
      if (!row) continue
      const loose = 1 - Math.min(Math.max(row.stability / 100, 0), 1)
      const wave = Math.sin(((frame.right - x) / wavelength) * Math.PI * 2 + phase + offset)
      const center =
        frame.centerY +
        amplitude * (1 + 1.2 * loose) * wave +
        jitter(s, i) * loose * loose * frame.height * 0.02
      const half = (MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * normalize(strand, row)) / 2
      top[i] = center - half
      bottom[i] = center + half
    }
    return { strand, xs, top, bottom }
  })
}

export type MarkerKind = 'era' | 'episode' | 'pulse'

export interface Marker {
  readonly kind: MarkerKind
  readonly event: EventId
  readonly index: number
  readonly x: number
  readonly x2: number
  readonly row: number
  readonly align: 'start' | 'end'
}

const KIND_OF = new Map<EventId, MarkerKind>(
  EVENTS.map((def) => [
    def.id,
    def.kind === 'era' ? 'era' : def.kind === 'condition' ? 'episode' : 'pulse',
  ]),
)

export function layoutEvents(
  records: readonly EventRecord[],
  from: number,
  to: number,
  present: number,
  frame: Frame,
  labelWidth: number,
): Marker[] {
  const eraRows: number[] = []
  const episodeRows: number[] = []
  const markers: Marker[] = []

  records.forEach((record, index) => {
    const end = record.end ?? present
    if (end < from || record.start > to) return
    const kind = KIND_OF.get(record.event) ?? 'pulse'
    const x = yearToX(Math.max(record.start, from), from, to, frame)
    const x2 = yearToX(Math.min(end, to), from, to, frame)
    let row = 0
    let align: 'start' | 'end' = 'start'
    if (kind === 'era') {
      align = x + labelWidth > frame.right ? 'end' : 'start'
      const labelLeft = align === 'end' ? x - labelWidth : x
      row = eraRows.findIndex((rowRight) => labelLeft >= rowRight + LABEL_GAP)
      if (row === -1 && eraRows.length < ERA_ROWS) row = eraRows.length
      if (row !== -1) eraRows[row] = labelLeft + labelWidth
    } else if (kind === 'episode') {
      row = episodeRows.findIndex((right) => x >= right + BAND_GAP)
      if (row === -1)
        row = episodeRows.length < EPISODE_ROWS ? episodeRows.length : EPISODE_ROWS - 1
      episodeRows[row] = Math.max(x2, episodeRows[row] ?? 0)
    }
    markers.push({ kind, event: record.event, index, x, x2, row, align })
  })

  return markers
}

export const ERA_ROW_HEIGHT = 20
export const EPISODE_ROW_HEIGHT = 8

export function eraLabelY(frame: Frame, row: number): number {
  return frame.centerY - frame.height * 0.26 - Math.max(row, 0) * ERA_ROW_HEIGHT
}

export function episodeY(frame: Frame, row: number): number {
  return frame.centerY + frame.height * 0.2 + row * EPISODE_ROW_HEIGHT
}

export function markerAt(
  markers: readonly Marker[],
  x: number,
  y: number,
  frame: Frame,
  labelWidth: number,
): Marker | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i]
    if (!marker) continue
    if (marker.kind === 'era') {
      const labelY = eraLabelY(frame, marker.row)
      const onStem = Math.abs(x - marker.x) <= 6 && y >= labelY - 8 && y <= frame.centerY + 6
      const left = marker.align === 'end' ? marker.x - labelWidth : marker.x
      const onLabel =
        marker.row >= 0 && x >= left && x <= left + labelWidth && Math.abs(y - labelY) <= 9
      if (onStem || onLabel) return marker
    } else if (marker.kind === 'episode') {
      const bandY = episodeY(frame, marker.row) + 1.5
      const right = Math.max(marker.x2, marker.x + 2)
      if (x >= marker.x - 3 && x <= right + 3 && Math.abs(y - bandY) <= 6) return marker
    } else if (Math.abs(x - marker.x) <= 5 && y >= frame.centerY && y <= frame.centerY + 18) {
      return marker
    }
  }
  return null
}
