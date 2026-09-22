import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { EVENTS } from '../../engine/events.ts'
import type { WorldlineId } from '../../worker/protocol.ts'
import { useT } from '../i18n/index.ts'
import { formatYear } from '../i18n/format.ts'
import { chooseTier } from '../graphics/settings.ts'
import { graphicsStore, useGraphics, useTier } from '../graphics/store.ts'
import { planetPalette, planetState } from '../planet/uniforms.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import type { View } from '../sim/store.ts'
import { terrainMap } from '../surface/runtime.ts'
import type { TerrainMap } from '../surface/terrainClient.ts'
import { currentKey } from '../current/keys.ts'
import { resolveView, zoomView } from '../current/view.ts'
import {
  eraOffsets,
  FOCUS_RADIUS,
  OTHER_RADIUS,
  pickTarget,
  pinchFactor,
  yearAtPointer,
  type ScreenTarget,
  type Vec3,
} from './camera.ts'
import { axisPoint, buildPath, headPoint, type PathData } from './path.ts'
import type { CurrentScene, SceneMarker, SceneWorld } from './scene.ts'
import { SAMPLES, axisOffsets, resample } from './space.ts'
import { screenTargets } from './targets.ts'
import './scene3d.css'

interface Fetched {
  readonly from: number
  readonly to: number
  readonly ranges: ReadonlyMap<WorldlineId, RangeResult>
  readonly distances: ReadonlyMap<WorldlineId, { from: number; to: number; values: Float32Array }>
}

interface Label {
  readonly key: string
  readonly point: Vec3
  readonly text: string
  readonly className: string
  // FEAT: afasta o rótulo do ponto na direção diagonal, em unidades de mundo (ex.: raio do planeta)
  readonly radius?: number
}

interface TouchState {
  readonly points: Map<number, { x: number; y: number }>
  before: number | null
  pinch: { distance: number; view: View | null; year: number } | null
  ended: boolean
}

const ERA_EVENTS = new Set(EVENTS.filter((def) => def.kind === 'era').map((def) => def.id))

export function Current3D({ width, height }: { readonly width: number; readonly height: number }) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CurrentScene | null>(null)
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const latest = useRef<{
    size: { width: number; height: number }
    worlds: readonly SceneWorld[]
    markers: readonly SceneMarker[]
    selected: string | null
    cursorPoint: Vec3 | null
  }>({ size: { width, height }, worlds: [], markers: [], selected: null, cursorPoint: null })
  const labelsRef = useRef<readonly Label[]>([])
  const labelElsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const tier = useTier()
  const setting = useGraphics((s) => s.setting)
  const measured = useGraphics((s) => s.measured)
  const reducedMotion = useGraphics((s) => s.reducedMotion)
  const worlds = useSimulation((s) => s.worlds)
  const focus = useSimulation((s) => s.focus)
  const observed = useSimulation((s) => s.inspected ?? s.present)
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const view = useSimulation((s) => s.view)
  const cursor = useSimulation((s) => s.cursor)
  const events = useSimulation((s) => s.events)
  const decisions = useSimulation((s) => s.decisions)
  const selected = useSimulation((s) => s.selected)
  const seed = useSimulation((s) => s.seed ?? 0)
  const { from, to } = resolveView(view, present)
  const palette = useMemo(() => planetPalette(seed), [seed])
  const [map, setMap] = useState<TerrainMap | null>(null)

  const measure = setting === 'auto' && measured === null
  const measureRef = useRef(measure)

  useEffect(() => {
    measureRef.current = measure
    if (measure) sceneRef.current?.measure()
  }, [measure])

  useEffect(() => {
    let live = true
    terrainMap(seed).then(
      (m) => {
        if (live) setMap(m)
      },
      () => {
        if (live) graphicsStore.getState().setWebglFailed()
      },
    )
    return () => {
      live = false
    }
  }, [seed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !map) return
    let disposed = false
    let unsubscribeFrame: (() => void) | null = null
    void import('./scene.ts')
      .then(({ createCurrentScene }) => {
        if (disposed) return
        const scene = createCurrentScene(canvas, {
          palette,
          tier,
          still: reducedMotion,
          seed,
          map,
          onMeasured: (ms: number, software: boolean) => {
            if (measureRef.current) graphicsStore.getState().setMeasured(chooseTier(ms, software))
          },
        })
        sceneRef.current = scene
        const {
          size,
          worlds: current,
          markers,
          selected: selectedKey,
          cursorPoint,
        } = latest.current
        scene.resize(size.width, size.height, window.devicePixelRatio || 1)
        scene.setWorlds(current)
        scene.setMarkers(markers, selectedKey)
        scene.setCursor(cursorPoint)
        unsubscribeFrame = scene.onFrame(() => {
          const eras: { el: HTMLSpanElement; x: number; y: number }[] = []
          for (const label of labelsRef.current) {
            const el = labelElsRef.current.get(label.key)
            if (!el) continue
            const projected = scene.project(label.point)
            el.style.visibility = projected.visible ? 'visible' : 'hidden'
            let x = projected.x
            let y = projected.y
            if (label.radius) {
              const edge = scene.project([
                label.point[0],
                label.point[1] + label.radius,
                label.point[2],
              ])
              const offset = Math.hypot(edge.x - projected.x, edge.y - projected.y)
              x += offset * 0.7
              y -= offset * 0.7
            }
            if (label.className === 'scene3d__era' && projected.visible) eras.push({ el, x, y })
            else el.style.transform = `translate(${x}px, ${y}px)`
          }
          const offsets = eraOffsets(eras)
          eras.forEach((era, index) => {
            const y = era.y + (offsets[index] ?? 0)
            era.el.style.transform = `translate(${era.x}px, ${y}px)`
          })
        })
      })
      .catch(() => {
        if (!disposed) graphicsStore.getState().setWebglFailed()
      })
    return () => {
      disposed = true
      unsubscribeFrame?.()
      sceneRef.current?.dispose(!canvas.isConnected)
      sceneRef.current = null
    }
  }, [tier, palette, reducedMotion, seed, map])

  useEffect(() => {
    sceneRef.current?.resize(width, height, window.devicePixelRatio || 1)
  }, [width, height])

  useEffect(() => {
    if (worlds.length === 0) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      const ranges = Promise.all(
        worlds.map((world) =>
          client.range(world.info.id, from, to, SAMPLES).then((r) => [world.info.id, r] as const),
        ),
      )
      const distances = Promise.all(
        worlds.flatMap((world) =>
          world.info.parent === null
            ? []
            : [
                client
                  .distance(world.info.id, world.info.parent, from, to, SAMPLES)
                  .then((d) => [world.info.id, d] as const),
              ],
        ),
      )
      Promise.all([ranges, distances]).then(
        ([r, d]) => {
          if (!cancelled) setFetched({ from, to, ranges: new Map(r), distances: new Map(d) })
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
  }, [worlds, from, to])

  const sceneWorlds = useMemo<SceneWorld[]>(() => {
    if (!fetched) return []
    const span = Math.max(1, fetched.to - fetched.from)
    const offsets = axisOffsets(
      worlds.map((world) => {
        const d = fetched.distances.get(world.info.id)
        return {
          id: world.info.id,
          parent: world.info.parent,
          distance: d ? resample(d.values, d.from, d.to, fetched.from, fetched.to) : null,
          fork: ((world.info.fork - fetched.from) / span) * (SAMPLES - 1),
        }
      }),
    )
    return worlds.flatMap((world) => {
      const range = fetched.ranges.get(world.info.id)
      if (!range) return []
      const start = world.info.parent === null ? 0 : world.info.fork
      const path: PathData = buildPath(
        range,
        offsets.get(world.info.id) ?? new Float32Array(SAMPLES * 2),
        fetched.from,
        fetched.to,
        start,
      )
      const focused = world.info.id === focus
      const snapshot = focused && observed ? observed : world.present
      return [
        {
          key: `${world.info.id}:${world.info.generation}`,
          focused,
          path,
          head: headPoint(path),
          planet: planetState(snapshot),
        },
      ]
    })
  }, [fetched, worlds, focus, observed])

  useEffect(() => {
    latest.current = { ...latest.current, size: { width, height }, worlds: sceneWorlds }
    sceneRef.current?.setWorlds(sceneWorlds)
  }, [sceneWorlds, width, height])

  const focusPath = sceneWorlds.find((world) => world.focused)?.path ?? null

  const markers = useMemo<SceneMarker[]>(() => {
    if (!fetched) return []
    const span = Math.max(1, fetched.to - fetched.from)
    const list: SceneMarker[] = []
    if (focusPath && focusPath.visible) {
      events.forEach((record, index) => {
        if (record.start < fetched.from || record.start > fetched.to) return
        const point = axisPoint(focusPath, (record.start - fetched.from) / span)
        if (point) list.push({ key: String(index), kind: 'event', position: point })
      })
      for (const decision of decisions) {
        if (decision.tick < fetched.from) continue
        const point = axisPoint(focusPath, (decision.tick - fetched.from) / span)
        if (point)
          list.push({ key: `decision:${decision.tick}`, kind: 'decision', position: point })
      }
    }
    const pathsById = new Map(
      sceneWorlds.map((world) => [world.key.split(':')[0] ?? '', world.path]),
    )
    for (const world of worlds) {
      if (world.info.parent === null) continue
      const parentPath = pathsById.get(world.info.parent)
      if (!parentPath || !parentPath.visible) continue
      const point = axisPoint(parentPath, (world.info.fork - fetched.from) / span)
      if (point) list.push({ key: `fork:${world.info.id}`, kind: 'fork', position: point })
    }
    return list
  }, [fetched, focusPath, events, decisions, sceneWorlds, worlds])

  useEffect(() => {
    const selectedKey = selected === null ? null : String(selected)
    latest.current = { ...latest.current, markers, selected: selectedKey }
    sceneRef.current?.setMarkers(markers, selectedKey)
  }, [markers, selected])

  const cursorPoint = useMemo<Vec3 | null>(() => {
    if (cursor === null || !focusPath || !fetched) return null
    return axisPoint(focusPath, (cursor - fetched.from) / Math.max(1, fetched.to - fetched.from))
  }, [cursor, focusPath, fetched])

  useEffect(() => {
    latest.current = { ...latest.current, cursorPoint }
    sceneRef.current?.setCursor(cursorPoint)
  }, [cursorPoint])

  const cursorLabel = useMemo<Label | null>(() => {
    if (cursor === null || !cursorPoint) return null
    return {
      key: 'cursor',
      point: cursorPoint,
      text: formatYear(cursor),
      className: 'scene3d__cursor',
    }
  }, [cursor, cursorPoint])

  const letterLabels = useMemo<Label[]>(
    () =>
      sceneWorlds.flatMap((world) =>
        world.head
          ? [
              {
                key: `letter:${world.key}`,
                point: world.head,
                text: world.key.split(':')[0] ?? '',
                className: 'scene3d__letter',
                radius: world.focused ? FOCUS_RADIUS : OTHER_RADIUS,
              },
            ]
          : [],
      ),
    [sceneWorlds],
  )

  const eraLabels = useMemo<Label[]>(() => {
    if (!fetched || !focusPath || !focusPath.visible) return []
    const span = Math.max(1, fetched.to - fetched.from)
    return events.flatMap((record, index) => {
      if (!ERA_EVENTS.has(record.event)) return []
      if (record.start < fetched.from || record.start > fetched.to) return []
      const point = axisPoint(focusPath, (record.start - fetched.from) / span)
      return point
        ? [
            {
              key: `era:${index}`,
              point,
              text: t(`event.${record.event}`),
              className: 'scene3d__era',
            },
          ]
        : []
    })
  }, [fetched, focusPath, events, t])

  const selectedLabel = useMemo<Label | null>(() => {
    if (selected === null || !focusPath || !fetched) return null
    const record = events[selected]
    if (!record) return null
    const span = Math.max(1, fetched.to - fetched.from)
    const point = axisPoint(focusPath, (record.start - fetched.from) / span)
    return point
      ? { key: 'selected', point, text: t(`event.${record.event}`), className: 'scene3d__selected' }
      : null
  }, [selected, focusPath, fetched, events, t])

  const labels = useMemo<readonly Label[]>(
    () => [
      ...(cursorLabel ? [cursorLabel] : []),
      ...letterLabels,
      ...eraLabels,
      ...(selectedLabel ? [selectedLabel] : []),
    ],
    [cursorLabel, letterLabels, eraLabels, selectedLabel],
  )

  useEffect(() => {
    labelsRef.current = labels
  }, [labels])

  const targets = (): ScreenTarget[] => {
    const scene = sceneRef.current
    return scene ? screenTargets(sceneWorlds, markers, (point) => scene.project(point)) : []
  }

  const yearAt = useCallback(
    (x: number, y: number): number | null => {
      const scene = sceneRef.current
      if (!scene || !focusPath || !fetched) return null
      const a = axisPoint(focusPath, 0)
      const b = axisPoint(focusPath, 1)
      if (!a || !b) return null
      return yearAtPointer({ x, y }, scene.project(a), scene.project(b), fetched.from, fetched.to)
    },
    [focusPath, fetched],
  )

  const touchRef = useRef<TouchState>({
    points: new Map(),
    before: null,
    pinch: null,
    ended: false,
  })

  const pinchSpread = (): { distance: number; x: number; y: number } | null => {
    const [first, second] = [...touchRef.current.points.values()]
    if (!first || !second) return null
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    }
  }

  const startPinch = () => {
    const touch = touchRef.current
    const spread = pinchSpread()
    const state = simulation.getState()
    // FIX: o segundo dedo desfaz a varredura do primeiro e passa a controlar o zoom
    state.setCursor(touch.before)
    touch.ended = true
    if (!spread) return
    const presentTick = state.present?.tick ?? 0
    touch.pinch = {
      distance: spread.distance,
      view: state.view,
      year: yearAt(spread.x, spread.y) ?? touch.before ?? presentTick,
    }
  }

  const movePinch = () => {
    const pinch = touchRef.current.pinch
    const spread = pinchSpread()
    if (!pinch || !spread) return
    const state = simulation.getState()
    const presentTick = state.present?.tick ?? 0
    const factor = pinchFactor(pinch.distance, spread.distance)
    state.setView(zoomView(pinch.view, presentTick, pinch.year, factor))
  }

  const releaseTouch = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType !== 'touch') return
    const touch = touchRef.current
    touch.points.delete(event.pointerId)
    if (touch.points.size < 2) touch.pinch = null
    if (touch.points.size === 0) touch.ended = false
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const state = simulation.getState()
      const presentTick = state.present?.tick ?? 0
      const year =
        yearAt(event.clientX - rect.left, event.clientY - rect.top) ?? state.cursor ?? presentTick
      state.setView(zoomView(state.view, presentTick, year, event.deltaY > 0 ? 1.25 : 0.8))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [yearAt])

  return (
    <div className="scene3d" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="scene3d__canvas"
        data-renderer="webgl"
        tabIndex={0}
        role="slider"
        aria-label={t('current.label', { year: formatYear(present) })}
        aria-describedby="scene3d-hint"
        aria-valuemin={0}
        aria-valuemax={present}
        aria-valuenow={cursor ?? present}
        aria-valuetext={t('current.value', { year: formatYear(cursor ?? present) })}
        style={{ width, height }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event: PointerEvent<HTMLCanvasElement>) => {
          if (event.button !== 0) return
          const rect = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const touch = touchRef.current
          if (event.pointerType === 'touch') {
            touch.points.set(event.pointerId, { x, y })
            if (touch.points.size === 1) {
              touch.before = simulation.getState().cursor
              touch.pinch = null
            } else {
              startPinch()
              return
            }
          }
          const hit = pickTarget(targets(), x, y)
          if (hit?.kind === 'world') {
            simulation.getState().setFocus(hit.key as WorldlineId)
            return
          }
          if (hit?.kind === 'event') {
            simulation.getState().select(Number(hit.key))
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          const year = yearAt(x, y)
          if (year !== null) simulation.getState().setCursor(year)
        }}
        onPointerMove={(event: PointerEvent<HTMLCanvasElement>) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const touch = touchRef.current
          if (event.pointerType === 'touch' && touch.points.has(event.pointerId)) {
            touch.points.set(event.pointerId, { x, y })
            if (touch.pinch) {
              movePinch()
              return
            }
            if (touch.ended) return
          }
          if (event.buttons & 1) {
            const year = yearAt(x, y)
            if (year !== null) simulation.getState().setCursor(year)
            return
          }
          event.currentTarget.style.cursor = pickTarget(targets(), x, y) ? 'pointer' : ''
        }}
        onPointerUp={releaseTouch}
        onPointerCancel={releaseTouch}
        onDoubleClick={() => simulation.getState().setCursor(null)}
        onKeyDown={(event: KeyboardEvent<HTMLCanvasElement>) => {
          const effect = currentKey(event.key, event.shiftKey, { present, cursor, view })
          if (!effect) return
          event.preventDefault()
          if ('view' in effect) simulation.getState().setView(effect.view)
          else simulation.getState().setCursor(effect.cursor)
        }}
      />
      <p id="scene3d-hint" className="scene3d__hint">
        {t('scene.label', { year: formatYear(present) })}
      </p>
      <div className="scene3d__labels" aria-hidden="true">
        {labels.map((label) => (
          <span
            key={label.key}
            ref={(el) => {
              if (el) labelElsRef.current.set(label.key, el)
              else labelElsRef.current.delete(label.key)
            }}
            className={label.className}
          >
            {label.text}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="scene3d__recenter"
        onClick={() => sceneRef.current?.recenter()}
      >
        {t('scene.recenter')}
      </button>
    </div>
  )
}
