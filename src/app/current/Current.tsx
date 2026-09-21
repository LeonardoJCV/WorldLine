import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import { LABEL_WIDTH, drawCurrent } from './draw.ts'
import { layoutEvents, markerAt, seedPhase, xToYear, type Frame } from './geometry.ts'
import type { Strand } from './normalize.ts'
import { resolveView } from './view.ts'

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
  const view = useSimulation((s) => s.view)
  const selected = useSimulation((s) => s.selected)
  const decisions = useSimulation((s) => s.decisions)
  const { from, to } = resolveView(view, present)
  const columns = Math.max(2, Math.floor(frame.right - frame.left))
  const shownFrom = data?.from ?? from
  const shownTo = data?.to ?? to

  useEffect(() => {
    if (!hasWorld) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      client.range(from, to, columns).then(
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
  }, [hasWorld, from, to, columns])

  const markers = useMemo(
    () => (data ? layoutEvents(events, data.from, data.to, present, frame, LABEL_WIDTH) : []),
    [data, events, present, frame],
  )

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
        markers,
        selected,
        decisions,
        from: shownFrom,
        to: shownTo,
        present,
        cursor,
        focus,
        phase: seedPhase(seed),
        label: (event) => t(`event.${event}`),
        yearLabel: formatYear,
      })
    })
    return () => cancelAnimationFrame(frameId)
  }, [
    width,
    height,
    frame,
    data,
    markers,
    selected,
    decisions,
    shownFrom,
    shownTo,
    present,
    cursor,
    focus,
    seed,
    t,
  ])

  const { setCursor, select } = simulation.getState()

  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
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
    if (!Object.hasOwn(moves, event.key)) return
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
        const { x, y } = pointAt(event)
        const hit = markerAt(markers, x, y, frame, LABEL_WIDTH)
        if (hit) {
          select(hit.index)
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        setCursor(xToYear(x, shownFrom, shownTo, frame))
      }}
      onPointerMove={(event) => {
        const { x, y } = pointAt(event)
        if (event.buttons & 1) {
          setCursor(xToYear(x, shownFrom, shownTo, frame))
          return
        }
        event.currentTarget.style.cursor = markerAt(markers, x, y, frame, LABEL_WIDTH)
          ? 'pointer'
          : ''
      }}
      onDoubleClick={() => setCursor(null)}
      onKeyDown={onKeyDown}
    />
  )
}
