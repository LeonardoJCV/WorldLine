import { useEffect, useMemo, useRef, useState } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { drawFallbackPlanet } from './fallback.ts'
import type { PlanetScene } from './scene.ts'
import { planetPalette, planetState, type PlanetState } from './uniforms.ts'
import type { Snapshot } from '../../worker/protocol.ts'

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
  } catch {
    return false
  }
}

interface PlanetProps {
  readonly size: number
  readonly seed: number
  readonly snapshot: Snapshot | null
}

export function Planet({ size, seed, snapshot }: PlanetProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PlanetScene | null>(null)
  const latest = useRef<{ size: number; state: PlanetState | null }>({ size, state: null })
  const [renderer, setRenderer] = useState(() => (supportsWebGL() ? 'webgl' : 'fallback'))
  const palette = useMemo(() => planetPalette(seed), [seed])
  const state = useMemo(() => (snapshot ? planetState(snapshot) : null), [snapshot])

  useEffect(() => {
    latest.current = { size, state }
  }, [size, state])

  useEffect(() => {
    if (renderer !== 'webgl') return
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void import('./scene.ts')
      .then(({ createPlanetScene }) => {
        if (disposed) return
        const scene = createPlanetScene(canvas, palette, reducedMotion)
        sceneRef.current = scene
        scene.resize(latest.current.size, window.devicePixelRatio || 1)
        if (latest.current.state) scene.update(latest.current.state)
      })
      .catch(() => {
        if (!disposed) setRenderer('fallback')
      })
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [renderer, palette])

  useEffect(() => {
    sceneRef.current?.resize(size, window.devicePixelRatio || 1)
  }, [size])

  useEffect(() => {
    if (state) sceneRef.current?.update(state)
  }, [state])

  useEffect(() => {
    if (renderer !== 'fallback' || !state) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawFallbackPlanet(ctx, size, palette, state)
  }, [renderer, size, palette, state])

  return (
    <canvas
      key={renderer}
      ref={canvasRef}
      className="planet"
      data-renderer={renderer}
      role="img"
      aria-label={t('planet.label', { year: formatYear(snapshot?.tick ?? 0) })}
      style={{ width: size, height: size }}
    />
  )
}
