import type { EventId, EventRecord } from '../../engine/events.ts'
import type { RangeResult } from '../sim/client.ts'
import { withAlpha } from '../theme/color.ts'
import { STRAND_COLORS } from '../theme/palette.ts'
import { buildRibbons, layoutEvents, yearToX, type Frame, type Ribbon } from './geometry.ts'
import type { Strand } from './normalize.ts'

export interface DrawInput {
  readonly width: number
  readonly height: number
  readonly frame: Frame
  readonly data: RangeResult | null
  readonly events: readonly EventRecord[]
  readonly present: number
  readonly cursor: number | null
  readonly focus: Strand | null
  readonly phase: number
  readonly label: (event: EventId) => string
  readonly yearLabel: (year: number) => string
}

const AXIS = 'rgba(142, 136, 181, 0.28)'
const INK = 'rgba(230, 228, 245, 0.86)'
const MUTED = 'rgba(142, 136, 181, 0.7)'
const FONT = '500 12px "Archivo Variable", system-ui, sans-serif'
export const LABEL_WIDTH = 150

function traceRibbon(ctx: CanvasRenderingContext2D, ribbon: Ribbon): void {
  const count = ribbon.xs.length
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const x = ribbon.xs[i] ?? 0
    const y = ribbon.top[i] ?? 0
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = count - 1; i >= 0; i--) ctx.lineTo(ribbon.xs[i] ?? 0, ribbon.bottom[i] ?? 0)
  ctx.closePath()
}

function drawRibbons(ctx: CanvasRenderingContext2D, input: DrawInput, data: RangeResult): void {
  const { frame, focus } = input
  const ribbons = buildRibbons(data.series, frame, input.phase)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const ribbon of ribbons) {
    const color = STRAND_COLORS[ribbon.strand]
    const dimmed = focus !== null && focus !== ribbon.strand
    const gradient = ctx.createLinearGradient(frame.left, 0, frame.right, 0)
    gradient.addColorStop(0, withAlpha(color, dimmed ? 0.04 : 0.22))
    gradient.addColorStop(1, withAlpha(color, dimmed ? 0.12 : 0.95))
    ctx.fillStyle = gradient
    ctx.shadowColor = withAlpha(color, dimmed ? 0 : 0.55)
    ctx.shadowBlur = dimmed ? 0 : 10
    traceRibbon(ctx, ribbon)
    ctx.fill()
  }
  ctx.restore()
}

function drawEvents(ctx: CanvasRenderingContext2D, input: DrawInput, data: RangeResult): void {
  const { frame } = input
  const markers = layoutEvents(input.events, data.from, data.to, input.present, frame, LABEL_WIDTH)
  const eraBase = frame.centerY - frame.height * 0.26
  const bandBase = frame.centerY + frame.height * 0.2
  ctx.save()
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  for (const marker of markers) {
    if (marker.kind === 'era') {
      const y = eraBase - Math.max(marker.row, 0) * 20
      ctx.strokeStyle = AXIS
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(marker.x, frame.centerY)
      ctx.lineTo(marker.x, y)
      ctx.stroke()
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.arc(marker.x, frame.centerY, 2.5, 0, Math.PI * 2)
      ctx.fill()
      if (marker.row >= 0) ctx.fillText(input.label(marker.event), marker.x + 6, y)
    } else if (marker.kind === 'episode') {
      const y = bandBase + marker.row * 8
      ctx.fillStyle = MUTED
      ctx.fillRect(marker.x, y, Math.max(2, marker.x2 - marker.x), 3)
      const text = input.label(marker.event)
      if (marker.x2 - marker.x > ctx.measureText(text).width + 12) {
        ctx.fillText(text, marker.x, y + 12)
      }
    } else {
      ctx.strokeStyle = MUTED
      ctx.beginPath()
      ctx.moveTo(marker.x, frame.centerY + 6)
      ctx.lineTo(marker.x, frame.centerY + 14)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawCursor(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  if (input.cursor === null) return
  const { frame } = input
  const x = yearToX(input.cursor, 0, Math.max(1, input.present), frame)
  const top = frame.centerY - frame.height * 0.45
  ctx.save()
  ctx.strokeStyle = 'rgba(230, 228, 245, 0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, frame.centerY + frame.height * 0.45)
  ctx.stroke()
  ctx.font = FONT
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.fillText(input.yearLabel(input.cursor), x, top - 10)
  ctx.restore()
}

function drawPresent(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
  ctx.shadowBlur = 18
  ctx.beginPath()
  ctx.arc(frame.right, frame.centerY, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawCurrent(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { frame, data } = input
  ctx.clearRect(0, 0, input.width, input.height)
  ctx.strokeStyle = AXIS
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(frame.left, frame.centerY)
  ctx.lineTo(frame.right, frame.centerY)
  ctx.stroke()
  if (data && data.series.population.length >= 2) {
    drawRibbons(ctx, input, data)
    drawEvents(ctx, input, data)
  }
  drawCursor(ctx, input)
  drawPresent(ctx, frame)
}
