import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorldlineId } from '../../worker/protocol.ts'
import { useT } from '../i18n/index.ts'
import { formatYear } from '../i18n/format.ts'
import { chooseTier } from '../graphics/settings.ts'
import { graphicsStore, useGraphics, useTier } from '../graphics/store.ts'
import { planetPalette, planetState } from '../planet/uniforms.ts'
import type { RangeResult } from '../sim/client.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import { resolveView } from '../current/view.ts'
import { buildPath, headPoint, type PathData } from './path.ts'
import type { CurrentScene, SceneWorld } from './scene.ts'
import { SAMPLES, axisOffsets, resample } from './space.ts'
import './scene3d.css'

interface Fetched {
  readonly from: number
  readonly to: number
  readonly ranges: ReadonlyMap<WorldlineId, RangeResult>
  readonly distances: ReadonlyMap<WorldlineId, { from: number; to: number; values: Float32Array }>
}

export function Current3D({ width, height }: { readonly width: number; readonly height: number }) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CurrentScene | null>(null)
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const latest = useRef<{
    size: { width: number; height: number }
    worlds: readonly SceneWorld[]
  }>({ size: { width, height }, worlds: [] })
  const tier = useTier()
  const setting = useGraphics((s) => s.setting)
  const measured = useGraphics((s) => s.measured)
  const reducedMotion = useGraphics((s) => s.reducedMotion)
  const worlds = useSimulation((s) => s.worlds)
  const focus = useSimulation((s) => s.focus)
  const observed = useSimulation((s) => s.inspected ?? s.present)
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const view = useSimulation((s) => s.view)
  const seed = useSimulation((s) => s.seed ?? 0)
  const { from, to } = resolveView(view, present)
  const palette = useMemo(() => planetPalette(seed), [seed])

  const measure = setting === 'auto' && measured === null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    void import('./scene.ts')
      .then(({ createCurrentScene }) => {
        if (disposed) return
        const scene = createCurrentScene(canvas, {
          palette,
          tier,
          still: reducedMotion,
          seed,
          ...(measure
            ? {
                onMeasured: (ms: number, software: boolean) =>
                  graphicsStore.getState().setMeasured(chooseTier(ms, software)),
              }
            : {}),
        })
        sceneRef.current = scene
        const { size, worlds: current } = latest.current
        scene.resize(size.width, size.height, window.devicePixelRatio || 1)
        scene.setWorlds(current)
      })
      .catch(() => {
        if (!disposed) graphicsStore.getState().setWebglFailed()
      })
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [tier, palette, reducedMotion, seed, measure])

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
    const offsets = axisOffsets(
      worlds.map((world) => {
        const d = fetched.distances.get(world.info.id)
        return {
          id: world.info.id,
          parent: world.info.parent,
          distance: d ? resample(d.values, d.from, d.to, fetched.from, fetched.to) : null,
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
    latest.current = { size: { width, height }, worlds: sceneWorlds }
    sceneRef.current?.setWorlds(sceneWorlds)
  }, [sceneWorlds, width, height])

  return (
    <div className="scene3d" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="scene3d__canvas"
        data-renderer="webgl"
        aria-label={t('scene.label', { year: formatYear(present) })}
        style={{ width, height }}
        onContextMenu={(event) => event.preventDefault()}
      />
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
