import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import type { View } from '../sim/store.ts'
import { withAlpha } from '../theme/color.ts'
import { STRAND_COLORS } from '../theme/palette.ts'
import { sampleRow, xToYear, yearToX, type Frame } from './geometry.ts'
import { STRANDS, normalize } from './normalize.ts'
import { MIN_SPAN, centerView, panView, resolveView } from './view.ts'

const HEIGHT = 36

interface MinimapProps {
  readonly frame: Frame
}

export function Minimap({ frame }: MinimapProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; view: View | null } | null>(null)
  const [data, setData] = useState<RangeResult | null>(null)
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const view = useSimulation((s) => s.view)
  const setView = simulation.getState().setView
  const width = Math.max(2, Math.floor(frame.right - frame.left))
  const local = useMemo<Frame>(
    () => ({ left: 0, right: width, centerY: HEIGHT / 2, height: HEIGHT }),
    [width],
  )
  const { from, to } = resolveView(view, present)
  const visible = present >= MIN_SPAN * 2

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      client.range(0, present, width).then(
        (result) => {
          if (!cancelled) setData(result)
        },
        (error: unknown) => {
          if (!cancelled) {
            simulation.setState({ error: error instanceof Error ? error.message : String(error) })
          }
        },
      )
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [visible, present, width])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !data) return
    const frameId = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, HEIGHT)
      const count = data.series.population.length
      for (const strand of STRANDS) {
        ctx.strokeStyle = withAlpha(STRAND_COLORS[strand], 0.7)
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < count; i++) {
          const x = count <= 1 ? width : (width * i) / (count - 1)
          const y = HEIGHT - 2 - normalize(strand, sampleRow(data.series, i)) * (HEIGHT - 4)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      const left = yearToX(from, 0, present, local)
      const right = yearToX(to, 0, present, local)
      ctx.fillStyle = 'rgba(230, 228, 245, 0.08)'
      ctx.strokeStyle = 'rgba(230, 228, 245, 0.6)'
      ctx.fillRect(left, 0.5, Math.max(2, right - left), HEIGHT - 1)
      ctx.strokeRect(left, 0.5, Math.max(2, right - left), HEIGHT - 1)
    })
    return () => cancelAnimationFrame(frameId)
  }, [data, width, from, to, present, local])

  if (!visible) return null

  const xOf = (event: PointerEvent<HTMLCanvasElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const span = to - from
    const stride = Math.max(1, Math.round(span * (event.shiftKey ? 0.5 : 0.1)))
    if (event.key === 'ArrowLeft') setView(panView(view, present, -stride))
    else if (event.key === 'ArrowRight') setView(panView(view, present, stride))
    else if (event.key === 'Home') setView(centerView(view, present, 0))
    else if (event.key === 'End') setView(view === null ? null : { span: view.span, end: null })
    else return
    event.preventDefault()
  }

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      tabIndex={0}
      role="slider"
      aria-label={t('minimap.label')}
      aria-valuemin={0}
      aria-valuemax={present}
      aria-valuenow={to}
      aria-valuetext={t('minimap.value', { from: formatYear(from), to: formatYear(to) })}
      style={{ left: frame.left, width, height: HEIGHT }}
      onPointerDown={(event) => {
        const x = xOf(event)
        const left = yearToX(from, 0, present, local)
        const right = yearToX(to, 0, present, local)
        event.currentTarget.setPointerCapture(event.pointerId)
        if (x >= left && x <= right) drag.current = { x, view }
        else {
          drag.current = null
          setView(centerView(view, present, xToYear(x, 0, present, local)))
        }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || !(event.buttons & 1)) return
        setView(panView(start.view, present, ((xOf(event) - start.x) / width) * present))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onKeyDown={onKeyDown}
    />
  )
}
