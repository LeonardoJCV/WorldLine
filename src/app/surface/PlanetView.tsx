import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useGraphics, useTier } from '../graphics/store.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { client, useSimulation } from '../sim/runtime.ts'
import { LEVELS, type Level } from './camera.ts'
import { surfaceModel, type SurfaceModel } from './civilization.ts'
import { TILE_BUDGET } from './lifeTiles.ts'
import { DENSITY } from './objects.ts'
import { terrainClient, terrainSites } from './runtime.ts'
import type { SurfaceScene } from './scene.ts'
import type { Site } from './sites.ts'
import './surface.css'

const LEAVE_MS = 300
const WHEEL_STEP = 1.15
const HOUR_POLL_MS = 250
const HISTORY_BUCKETS = 256

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
  const focus = useSimulation((s) => s.focus)
  const observed = useSimulation((s) => s.inspected ?? s.present)
  const tick = observed?.tick ?? null
  const [sites, setSites] = useState<{ seed: number; sites: readonly Site[] } | null>(null)
  const [history, setHistory] = useState<{
    focus: string
    tick: number
    from: number
    to: number
    population: Float32Array
  } | null>(null)
  const model = useMemo(
    () =>
      sites?.seed === seed && observed && history?.focus === focus
        ? surfaceModel({
            sites: sites.sites,
            values: observed.values,
            eras: observed.eras,
            active: observed.active,
            allocation: observed.allocation,
            status: observed.status,
            history,
          })
        : null,
    [sites, seed, observed, history, focus],
  )
  const modelRef = useRef<SurfaceModel | null>(model)

  useEffect(() => {
    exitRef.current = onExit
  }, [onExit])

  useEffect(() => {
    let live = true
    terrainSites(seed).then(
      (list) => {
        if (live) setSites({ seed, sites: list })
      },
      () => {
        if (live) setSites(null)
      },
    )
    return () => {
      live = false
    }
  }, [seed])

  useEffect(() => {
    if (tick === null) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      client.range(focus, 0, tick, HISTORY_BUCKETS).then(
        (result) => {
          if (cancelled) return
          setHistory({
            focus,
            tick,
            from: result.from,
            to: result.to,
            population: result.series.population,
          })
        },
        () => {
          if (!cancelled) setHistory(null)
        },
      )
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [focus, tick])

  useEffect(() => {
    modelRef.current = model
    sceneRef.current?.setModel(model)
  }, [model])

  useEffect(() => {
    sizeRef.current = { width, height }
    sceneRef.current?.resize(width, height, window.devicePixelRatio || 1)
  }, [width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    void Promise.all([import('./scene.ts'), terrainSites(seed).catch((): readonly Site[] => [])])
      .then(([{ createSurfaceScene }, list]) => {
        if (disposed) return
        const scene = createSurfaceScene(canvas, {
          seed,
          palette,
          tier,
          still,
          terrain: terrainClient(),
          density: DENSITY[tier],
          tileBudget: TILE_BUDGET[tier],
          start: list[0]?.dir ?? null,
          sites: list,
          onLevel: setLevel,
        })
        sceneRef.current = scene
        scene.setModel(modelRef.current)
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
