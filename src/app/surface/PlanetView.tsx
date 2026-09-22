import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useStore } from 'zustand'
import { useGraphics, useTier } from '../graphics/store.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { planetPalette } from '../planet/uniforms.ts'
import { client, useSimulation } from '../sim/runtime.ts'
import { LEVELS, type Level } from './camera.ts'
import { CityCard, type Card } from './CityCard.tsx'
import { surfaceModel, type SurfaceModel } from './civilization.ts'
import type { Vec3 } from './cube.ts'
import { lensStore } from './lens.ts'
import { anchorOf, cityEvents, foundedYear, RECENT_YEARS, recentEvents } from './labels.ts'
import { TILE_BUDGET } from './lifeTiles.ts'
import { microevents, type MicroEvent, type YearSeries } from './micro.ts'
import { cityNames } from './names.ts'
import { DENSITY } from './objects.ts'
import { terrainClient, terrainSites } from './runtime.ts'
import type { SurfaceScene } from './scene.ts'
import { MAX_SITES, type Site } from './sites.ts'
import './surface.css'

const LEAVE_MS = 300
const WHEEL_STEP = 1.15
const HOUR_POLL_MS = 250
const HISTORY_BUCKETS = 256
const YEARLY_SPAN = 100
const MARKER_GAP = 14
const FADE_NEAR = 0.85
const FADE_FAR = 0.4

// FEAT: o ano observado fica pleno; os anteriores esmaecem com a idade
function fade(age: number): number {
  if (age <= 0) return 1
  const k = Math.min(1, (age - 1) / Math.max(1, RECENT_YEARS - 1))
  return FADE_NEAR + (FADE_FAR - FADE_NEAR) * k
}

type Chosen =
  | { readonly kind: 'city'; readonly site: number }
  | { readonly kind: 'micro'; readonly event: MicroEvent }

interface Anchor {
  readonly point: Vec3
  readonly dx: number
  readonly city: boolean
}

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
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const anchorsRef = useRef<ReadonlyMap<string, Anchor>>(new Map())
  const elsRef = useRef(new Map<string, HTMLElement>())
  const tier = useTier()
  const target = useStore(lensStore, (s) => s.target)
  const [ready, setReady] = useState(false)
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
  const fresh = useMemo(
    () =>
      sites?.seed === seed && observed && history?.focus === focus && history.tick === tick
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
    [sites, seed, observed, history, focus, tick],
  )
  // FIX: mantém o último modelo do mesmo planeta até a história do novo mundo ou ano chegar
  const [kept, setKept] = useState<{ seed: number; model: SurfaceModel } | null>(null)
  if (fresh && fresh !== kept?.model) setKept({ seed, model: fresh })
  const model = fresh ?? (kept?.seed === seed ? kept.model : null)
  const modelRef = useRef<SurfaceModel | null>(model)
  const names = useMemo(() => cityNames(seed, MAX_SITES), [seed])
  const [yearly, setYearly] = useState<
    (YearSeries & { seed: number; focus: string; tick: number }) | null
  >(null)
  const freshEvents = useMemo(
    () =>
      yearly &&
      sites?.seed === seed &&
      yearly.seed === seed &&
      yearly.focus === focus &&
      yearly.tick === tick
        ? microevents({ seed, sites: sites.sites, series: yearly })
        : null,
    [yearly, sites, seed, focus, tick],
  )
  // FIX: mantém os microeventos do último ano até a série do novo ano chegar
  const [keptEvents, setKeptEvents] = useState<{
    seed: number
    focus: string
    events: readonly MicroEvent[]
  } | null>(null)
  if (freshEvents && freshEvents !== keptEvents?.events)
    setKeptEvents({ seed, focus, events: freshEvents })
  const events = useMemo<readonly MicroEvent[]>(() => {
    if (freshEvents) return freshEvents
    if (tick === null || keptEvents?.seed !== seed || keptEvents.focus !== focus) return []
    return keptEvents.events.filter((e) => e.year <= tick)
  }, [freshEvents, keptEvents, seed, focus, tick])
  const recent = useMemo(() => (tick === null ? [] : recentEvents(events, tick)), [events, tick])
  const cities = useMemo(
    () =>
      model && sites?.seed === seed
        ? model.cities.flatMap((city) => {
            const site = sites.sites[city.site]
            return site ? [{ city, site }] : []
          })
        : [],
    [model, sites, seed],
  )
  const anchors = useMemo(() => {
    const map = new Map<string, Anchor>()
    for (const { city, site } of cities) {
      map.set(`city:${city.site}`, { point: anchorOf(site), dx: 0, city: true })
    }
    const slots = new Map<number, number>()
    for (const e of recent) {
      const site = sites?.sites[e.site]
      if (!site) continue
      const slot = slots.get(e.site) ?? 0
      slots.set(e.site, slot + 1)
      map.set(`micro:${e.year}:${e.kind}:${e.site}`, {
        point: anchorOf(site),
        dx: slot * MARKER_GAP,
        city: false,
      })
    }
    return map
  }, [cities, recent, sites])
  // FIX: a cidade que sumiu do modelo fecha a ficha de vez
  if (chosen?.kind === 'city' && model && !model.cities.some((c) => c.site === chosen.site))
    setChosen(null)
  const card = useMemo<Card | null>(() => {
    if (!chosen) return null
    if (chosen.kind === 'micro') {
      return { kind: 'micro', event: chosen.event, name: names[chosen.event.site] ?? '' }
    }
    const found = cities.find((c) => c.city.site === chosen.site)
    if (!found) return null
    return {
      kind: 'city',
      city: { ...found.city, founded: foundedYear(events, found.city) },
      name: names[chosen.site] ?? '',
      events: cityEvents(events, chosen.site),
    }
  }, [chosen, cities, events, names])

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
    if (tick === null) return
    let cancelled = false
    const from = Math.max(0, tick - YEARLY_SPAN)
    const frameId = requestAnimationFrame(() => {
      client.range(focus, from, tick, tick - from + 1).then(
        (result) => {
          if (cancelled || result.to !== tick) return
          setYearly({
            seed,
            focus,
            tick,
            from: result.from,
            to: result.to,
            values: result.series,
          })
        },
        () => {
          if (!cancelled) setYearly(null)
        },
      )
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [seed, focus, tick])

  useEffect(() => {
    anchorsRef.current = anchors
  }, [anchors])

  useEffect(() => {
    const scene = sceneRef.current
    if (!target || !ready || !scene) return
    scene.goTo(target.dir, 'region')
    setChosen({
      kind: 'micro',
      event: { year: target.year, kind: target.kind, site: target.site },
    })
    lensStore.getState().clearTarget()
  }, [target, ready])

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
    let unsubscribe: (() => void) | null = null
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
        unsubscribe = scene.onFrame(() => {
          for (const [key, anchor] of anchorsRef.current) {
            const el = elsRef.current.get(key)
            if (!el) continue
            const p = scene.project(anchor.point)
            el.style.visibility = p.visible ? 'visible' : 'hidden'
            if (!p.visible) continue
            el.style.transform = anchor.city
              ? `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
              : `translate(${p.x + anchor.dx}px, ${p.y}px) translate(-50%, 25%)`
          }
        })
        canvas.focus()
        setReady(true)
      })
      .catch(() => {
        if (disposed) return
        lensStore.getState().clearTarget()
        exitRef.current()
      })
    return () => {
      disposed = true
      unsubscribe?.()
      sceneRef.current?.dispose(!canvas.isConnected)
      sceneRef.current = null
      setReady(false)
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

  const bind = (key: string) => (el: HTMLElement | null) => {
    if (el) elsRef.current.set(key, el)
    else elsRef.current.delete(key)
  }

  const closeCard = () => {
    setChosen(null)
    canvasRef.current?.focus()
  }

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
      className={`surface${leaving ? ' surface--leaving' : ''}${still ? ' surface--still' : ''}`}
      style={{ width, height }}
      data-level={level}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (card) closeCard()
        else leave()
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
      <div className="surface__labels">
        {cities.map(({ city }) => {
          const name = names[city.site] ?? ''
          return (
            <button
              key={`city:${city.site}`}
              ref={bind(`city:${city.site}`)}
              type="button"
              className="surface__city"
              data-state={city.state}
              aria-label={t('city.label', {
                name,
                state: t(city.state === 'alive' ? 'card.alive' : 'card.ruin'),
              })}
              style={{ '--size': city.size } as CSSProperties}
              onClick={() => setChosen({ kind: 'city', site: city.site })}
            >
              {name}
            </button>
          )
        })}
        {recent.map((e) => {
          const key = `micro:${e.year}:${e.kind}:${e.site}`
          const text = t(`micro.${e.kind}`, { city: names[e.site] ?? '' })
          return (
            <button
              key={key}
              ref={bind(key)}
              type="button"
              className={`surface__micro${e.year === tick ? ' surface__micro--now' : ''}`}
              data-kind={e.kind}
              style={{ '--fade': fade(tick === null ? 0 : tick - e.year) } as CSSProperties}
              aria-label={text}
              title={text}
              onClick={() => setChosen({ kind: 'micro', event: e })}
            />
          )
        })}
      </div>
      {card && <CityCard card={card} names={names} onClose={closeCard} />}
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
