import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import { drawCurrent } from './draw.ts'
import { seedPhase, xToYear, type Frame } from './geometry.ts'
import type { Strand } from './normalize.ts'

interface CurrentProps {
  readonly width: number
  readonly height: number
  readonly frame: Frame
  readonly focus: Strand | null
}

export function Current({ width, height, frame, focus }: CurrentProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<RangeResult | null>(null)
  const hasWorld = useSimulation((s) => s.present !== null)
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const cursor = useSimulation((s) => s.cursor)
  const events = useSimulation((s) => s.events)
  const seed = useSimulation((s) => s.seed ?? 0)
  const columns = Math.max(2, Math.floor(frame.right - frame.left))

  useEffect(() => {
    if (!hasWorld) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      client.range(0, present, columns).then(
        (result) => {
          if (!cancelled) setData(result)
        },
        (error: unknown) =>
          simulation.setState({ error: error instanceof Error ? error.message : String(error) }),
      )
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [hasWorld, present, columns])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const frameId = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawCurrent(ctx, {
        width,
        height,
        frame,
        data,
        events,
        present,
        cursor,
        focus,
        phase: seedPhase(seed),
        label: (event) => t(`event.${event}`),
        yearLabel: formatYear,
      })
    })
    return () => cancelAnimationFrame(frameId)
  }, [width, height, frame, data, events, present, cursor, focus, seed, t])

  const setCursor = simulation.getState().setCursor

  const yearAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return xToYear(event.clientX - rect.left, 0, present, frame)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const base = cursor ?? present
    const stride = event.shiftKey ? 10 : 1
    const moves: Record<string, number | null> = {
      ArrowLeft: base - stride,
      ArrowRight: base + stride,
      Home: 0,
      End: null,
      Escape: null,
    }
    if (!(event.key in moves)) return
    event.preventDefault()
    setCursor(moves[event.key] ?? null)
  }

  return (
    <canvas
      ref={canvasRef}
      className="current"
      tabIndex={0}
      role="slider"
      aria-label={t('current.label', { year: formatYear(present) })}
      aria-valuemin={0}
      aria-valuemax={present}
      aria-valuenow={cursor ?? present}
      aria-valuetext={t('current.value', { year: formatYear(cursor ?? present) })}
      style={{ width, height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setCursor(yearAt(event))
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) setCursor(yearAt(event))
      }}
      onDoubleClick={() => setCursor(null)}
      onKeyDown={onKeyDown}
    />
  )
}
