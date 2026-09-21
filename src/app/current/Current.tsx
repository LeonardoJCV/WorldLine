import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { WorldlineId } from '../../worker/protocol.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import { LABEL_WIDTH, drawCurrent } from './draw.ts'
import {
  companionAt,
  companionPoints,
  companionSide,
  layoutEvents,
  markerAt,
  movingAverage,
  seedPhase,
  xToYear,
  type CompanionTrack,
  type Frame,
} from './geometry.ts'
import type { Strand } from './normalize.ts'
import { resolveView, zoomView } from './view.ts'

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
  const [tracks, setTracks] = useState<readonly CompanionTrack[]>([])
  const hasWorld = useSimulation((s) => s.present !== null)
  const worldFocus = useSimulation((s) => s.focus)
  const worlds = useSimulation((s) => s.worlds)
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
      client.range(worldFocus, from, to, columns).then(
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
  }, [hasWorld, worldFocus, from, to, columns])

  useEffect(() => {
    if (!hasWorld) return
    let cancelled = false
    const others = worlds.filter((world) => world.info.id !== worldFocus)
    const frameId = requestAnimationFrame(() => {
      Promise.all(
        others.map((world) =>
          client
            .distance(world.info.id, worldFocus, from, to, columns)
            .then((result): CompanionTrack => ({
              id: world.info.id,
              from: result.from,
              to: result.to,
              // FIX: suaviza os saltos entre amostras (mesmo raio do minimapa)
              values: movingAverage(result.values, 3),
              extinct: world.present.status === 'extinct',
            })),
        ),
      ).then(
        (list) => {
          if (!cancelled) setTracks(list)
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
  }, [hasWorld, worlds, worldFocus, from, to, columns])

  const markers = useMemo(
    () => (data ? layoutEvents(events, data.from, data.to, present, frame, LABEL_WIDTH) : []),
    [data, events, present, frame],
  )

  const companions = useMemo(
    () =>
      tracks.map((track) => ({
        id: track.id,
        extinct: track.extinct,
        points: companionPoints(track, companionSide(track.id), shownFrom, shownTo, frame),
      })),
    [tracks, shownFrom, shownTo, frame],
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
        followsPresent: view === null || view.end === null,
        cursor,
        focus,
        phase: seedPhase(seed),
        label: (event) => t(`event.${event}`),
        yearLabel: formatYear,
        companions,
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
    view,
    cursor,
    focus,
    seed,
    t,
    companions,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const state = simulation.getState()
      const tick = state.present?.tick ?? 0
      const shown = resolveView(state.view, tick)
      const rect = canvas.getBoundingClientRect()
      const focusYear = xToYear(event.clientX - rect.left, shown.from, shown.to, frame)
      state.setView(zoomView(state.view, tick, focusYear, event.deltaY > 0 ? 1.25 : 0.8))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [frame])

  const { setCursor, select, setView } = simulation.getState()

  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const zoomKeys: Record<string, number> = { '+': 0.8, '=': 0.8, '-': 1.25 }
    if (Object.hasOwn(zoomKeys, event.key)) {
      event.preventDefault()
      setView(zoomView(view, present, cursor ?? present, zoomKeys[event.key] ?? 1))
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      setView(null)
      return
    }
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
        const other = companionAt(companions, x, y, frame)
        if (other) {
          simulation.getState().setFocus(other as WorldlineId)
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
        event.currentTarget.style.cursor =
          markerAt(markers, x, y, frame, LABEL_WIDTH) || companionAt(companions, x, y, frame)
            ? 'pointer'
            : ''
      }}
      onDoubleClick={() => setCursor(null)}
      onKeyDown={onKeyDown}
    />
  )
}
