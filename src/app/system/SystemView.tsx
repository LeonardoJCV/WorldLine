import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { TIERS } from '../graphics/settings.ts'
import { useGraphics, useTier } from '../graphics/store.ts'
import { formatCompact } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { terrainMap } from '../surface/runtime.ts'
import type { TerrainMap } from '../surface/terrainClient.ts'
import { bodyLabelKey, systemPlacement, type PlacedBody } from './model.ts'
import type { Escape, SystemScene } from './scene.ts'
import './system.css'

const WHEEL_STEP = 1.15
const LABEL_GAP = 6

export function SystemView({
  width,
  height,
  onExit,
  onDive,
}: {
  readonly width: number
  readonly height: number
  readonly onExit: () => void
  readonly onDive: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SystemScene | null>(null)
  const sizeRef = useRef({ width, height })
  const exitRef = useRef(onExit)
  const diveRef = useRef(onDive)
  const elsRef = useRef(new Map<number, HTMLElement>())
  const [hover, setHover] = useState<number | null>(null)
  const still = useGraphics((s) => s.reducedMotion)
  const stillRef = useRef(still)
  const tier = useTier()
  const seed = useSimulation((s) => s.seed ?? 0)
  const present = useSimulation((s) => s.present)
  const home = present?.home ?? null
  const colonies = useSimulation((s) => s.colonies)
  const placement = useMemo(() => systemPlacement(seed, home, colonies), [seed, home, colonies])
  const placementRef = useRef(placement)
  const presentRef = useRef(present)
  const [loaded, setLoaded] = useState<{ seed: number; map: TerrainMap } | null>(null)

  useEffect(() => {
    exitRef.current = onExit
    diveRef.current = onDive
  }, [onExit, onDive])

  // FEAT: as duas pontas do zoom são saídas — para fora a Corrente, para dentro o planeta
  const leaveBy = useCallback((escape: Escape | undefined) => {
    if (escape === 'out') exitRef.current()
    else if (escape === 'in') diveRef.current()
  }, [])

  useEffect(() => {
    stillRef.current = still
    sceneRef.current?.setStill(still)
  }, [still])

  useEffect(() => {
    placementRef.current = placement
    sceneRef.current?.setPlacement(placement)
  }, [placement])

  useEffect(() => {
    presentRef.current = present
    if (present) sceneRef.current?.setPresent(present)
  }, [present])

  useEffect(() => {
    sizeRef.current = { width, height }
    sceneRef.current?.resize(width, height)
  }, [width, height])

  // FEAT: o único terreno que existe é o do mundo natal — a cena espera ele chegar antes de nascer
  useEffect(() => {
    let live = true
    terrainMap(seed).then(
      (map) => {
        if (live) setLoaded({ seed, map })
      },
      () => {
        if (live) exitRef.current()
      },
    )
    return () => {
      live = false
    }
  }, [seed])

  const hasPresent = present !== null

  useEffect(() => {
    const canvas = canvasRef.current
    const snapshot = presentRef.current
    if (!canvas || !loaded || loaded.seed !== seed || !snapshot) return
    let disposed = false
    void import('./scene.ts')
      .then(({ createSystemScene }) => {
        if (disposed) return
        const scene = createSystemScene(canvas, {
          placement: placementRef.current,
          seed,
          tier,
          terrain: loaded.map,
          present: snapshot,
          dpr: Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr),
          still: stillRef.current,
          onPick: setHover,
        })
        sceneRef.current = scene
        scene.resize(sizeRef.current.width, sizeRef.current.height)
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
    // FEAT: a cena só precisa nascer de novo quando o presente sai do nada — não a cada ano simulado
  }, [seed, tier, loaded, hasPresent])

  // FEAT: os rótulos seguem os corpos quadro a quadro, porque a deriva os move o tempo todo
  useEffect(() => {
    let frame = 0
    const step = () => {
      frame = requestAnimationFrame(step)
      const scene = sceneRef.current
      if (!scene) return
      for (const body of placementRef.current.bodies) {
        const el = elsRef.current.get(body.index)
        if (!el) continue
        const p = scene.project(body.index)
        el.style.visibility = p.visible ? 'visible' : 'hidden'
        if (p.visible) {
          el.style.transform = `translate(${p.x}px, ${p.y + LABEL_GAP}px) translate(-50%, 0)`
        }
      }
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      leaveBy(sceneRef.current?.zoom(event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [leaveBy])

  const bind = (index: number) => (el: HTMLElement | null) => {
    if (el) elsRef.current.set(index, el)
    else elsRef.current.delete(index)
  }

  // FEAT: o texto do rótulo é a distinção sem cor — morto e vazio só se separam pelas palavras
  const label = (body: PlacedBody): string => {
    const params: Record<string, string> = { name: body.name }
    if (body.colony) params.people = formatCompact(body.colony.population, locale)
    return t(bodyLabelKey(body), params)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current
    const moves: Record<string, () => void> = {
      '+': () => leaveBy(scene?.zoom(0.8)),
      '=': () => leaveBy(scene?.zoom(0.8)),
      '-': () => leaveBy(scene?.zoom(1.25)),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  return (
    <div
      className={`system${still ? ' system--still' : ''}`}
      style={{ width, height }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        exitRef.current()
      }}
    >
      <canvas
        ref={canvasRef}
        className="system__canvas"
        tabIndex={0}
        role="img"
        aria-label={t('system.label', { seed })}
        style={{ width, height }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      />
      <div className="system__labels">
        {placement.bodies.map((body) => (
          <span
            key={body.index}
            ref={bind(body.index)}
            className="system__body"
            data-hover={hover === body.index ? 'true' : 'false'}
          >
            {label(body)}
          </span>
        ))}
      </div>
      <h2 className="system__title">{t('system.title')}</h2>
      <div className="system__ways">
        <button type="button" className="system__exit" onClick={() => exitRef.current()}>
          {t('system.exit')}
        </button>
        {/* FEAT: sem pinça funcionando aqui, o toque só desce ao planeta por este botão */}
        <button type="button" className="system__dive" onClick={() => diveRef.current()}>
          {t('system.dive')}
        </button>
      </div>
    </div>
  )
}
