import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useGraphics, useTier } from '../graphics/store.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { useSimulation } from '../sim/runtime.ts'
import { LEVELS, type Level } from './camera.ts'
import { terrainClient } from './runtime.ts'
import type { SurfaceScene } from './scene.ts'
import './surface.css'

const LEAVE_MS = 300
const WHEEL_STEP = 1.15
const HOUR_POLL_MS = 250

export function PlanetView({
  width,
  height,
  onExit,
}: {
  readonly width: number
  readonly height: number
  readonly onExit: () => void
}) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SurfaceScene | null>(null)
  const sizeRef = useRef({ width, height })
  const exitRef = useRef(onExit)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const [level, setLevel] = useState<Level>('orbit')
  const [hour, setHour] = useState<number | null>(null)
  const [liveHour, setLiveHour] = useState(0.5)
  const [leaving, setLeaving] = useState(false)
  const tier = useTier()
  const still = useGraphics((s) => s.reducedMotion)
  const seed = useSimulation((s) => s.seed ?? 0)
  const year = useSimulation((s) => s.cursor ?? s.present?.tick ?? 0)
  const palette = useMemo(() => planetPalette(seed), [seed])

  useEffect(() => {
    exitRef.current = onExit
  }, [onExit])

  useEffect(() => {
    sizeRef.current = { width, height }
    sceneRef.current?.resize(width, height, window.devicePixelRatio || 1)
  }, [width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    void import('./scene.ts')
      .then(({ createSurfaceScene }) => {
        if (disposed) return
        const scene = createSurfaceScene(canvas, {
          seed,
          palette,
          tier,
          still,
          terrain: terrainClient(),
          onLevel: setLevel,
        })
        sceneRef.current = scene
        scene.resize(sizeRef.current.width, sizeRef.current.height, window.devicePixelRatio || 1)
        canvas.focus()
      })
      .catch(() => {
        if (!disposed) exitRef.current()
      })
    return () => {
      disposed = true
      sceneRef.current?.dispose(!canvas.isConnected)
      sceneRef.current = null
    }
  }, [seed, palette, tier, still])

  useEffect(() => {
    sceneRef.current?.setHour(hour)
    if (hour !== null) return
    const id = window.setInterval(() => {
      const scene = sceneRef.current
      if (scene) setLiveHour(scene.hour)
    }, HOUR_POLL_MS)
    return () => window.clearInterval(id)
  }, [hour])

  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => exitRef.current(), LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [leaving])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      sceneRef.current?.zoom(event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const leave = () => (still ? exitRef.current() : setLeaving(true))

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current
    const moves: Record<string, () => void> = {
      '+': () => scene?.zoom(0.8),
      '=': () => scene?.zoom(0.8),
      '-': () => scene?.zoom(1.25),
      ArrowLeft: () => scene?.pan(40, 0),
      ArrowRight: () => scene?.pan(-40, 0),
      ArrowUp: () => scene?.pan(0, 40),
      ArrowDown: () => scene?.pan(0, -40),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const spread = () => {
    const [a, b] = [...touches.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null
  }

  return (
    <div
      className={`surface${leaving ? ' surface--leaving' : ''}`}
      style={{ width, height }}
      data-level={level}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        leave()
      }}
    >
      <canvas
        ref={canvasRef}
        className="surface__canvas"
        tabIndex={0}
        role="img"
        aria-label={t('surface.label', { year: formatYear(year) })}
        aria-describedby="surface-hint"
        style={{ width, height }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          const p = point(event)
          event.currentTarget.setPointerCapture(event.pointerId)
          if (event.pointerType === 'touch') {
            touches.current.set(event.pointerId, p)
            pinch.current = spread()
          }
          drag.current = p
        }}
        onPointerMove={(event) => {
          const p = point(event)
          if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
            touches.current.set(event.pointerId, p)
            const now = spread()
            if (now !== null && pinch.current !== null) {
              sceneRef.current?.zoom(pinch.current / Math.max(now, 1))
              pinch.current = now
              return
            }
          }
          const from = drag.current
          if (!from) return
          sceneRef.current?.pan(p.x - from.x, p.y - from.y)
          drag.current = p
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId)
          pinch.current = spread()
          drag.current = null
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId)
          pinch.current = spread()
          drag.current = null
        }}
      />
      <p id="surface-hint" className="surface__hint">
        {t('surface.hint')}
      </p>
      <div className="surface__levels" role="group" aria-label={t('surface.levels')}>
        {LEVELS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={level === option}
            onClick={() => sceneRef.current?.setLevel(option)}
          >
            {t(`surface.level.${option}`)}
          </button>
        ))}
      </div>
      <div className="surface__hour">
        <label>
          {t('surface.hour')}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((hour ?? liveHour) * 100)}
            onChange={(event) => setHour(Number(event.target.value) / 100)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={hour === null}
            onChange={(event) =>
              setHour(event.target.checked ? null : (sceneRef.current?.hour ?? 0.5))
            }
          />
          {t('surface.autoHour')}
        </label>
      </div>
      <button type="button" className="surface__exit" onClick={leave}>
        {t('surface.exit')}
      </button>
    </div>
  )
}
