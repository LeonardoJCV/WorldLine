import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Current } from '../current/Current.tsx'
import { stageLayout } from '../current/geometry.ts'
import { Minimap } from '../current/Minimap.tsx'
import type { Strand } from '../current/normalize.ts'
import { ZoomControls } from '../current/ZoomControls.tsx'
import { TIERS } from '../graphics/settings.ts'
import { useStage, useTier } from '../graphics/store.ts'
import { useT } from '../i18n/index.ts'
import { Planet } from '../planet/Planet.tsx'
import { Current3D } from '../scene3d/Current3D.tsx'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { lensStore, useLens, type Lens } from '../surface/lens.ts'
import { PlanetView } from '../surface/PlanetView.tsx'
import { isCompatibleVersion, type MultiverseLink } from '../world/link.ts'
import { useLinkSync } from '../world/useLinkSync.ts'
import { AllocationPanel } from './AllocationPanel.tsx'
import { CausalPanel } from './CausalPanel.tsx'
import { CrossPanel } from './CrossPanel.tsx'
import { EventsPanel } from './EventsPanel.tsx'
import { StatePanel } from './StatePanel.tsx'
import { TopBar } from './TopBar.tsx'
import { useElementSize } from './useElementSize.ts'
import { WorldActions } from './WorldActions.tsx'
import { WorldsStrip } from './WorldsStrip.tsx'
import './observatory.css'

export function Observatory({
  link,
  lens,
  onLeave,
}: {
  readonly link: MultiverseLink
  readonly lens: Lens
  readonly onLeave: () => void
}) {
  useEffect(() => {
    simulation.getState().open(link)
  }, [link])
  useEffect(() => {
    lensStore.getState().setLens(lens)
  }, [lens])
  useLinkSync()
  const t = useT()
  const tier = useTier()
  const stage = useStage()
  const currentLens = useLens()
  const planetOpen = stage === '3d' && currentLens === 'planet'
  const exitPlanet = useCallback(() => lensStore.getState().setLens('current'), [])
  const stageRef = useRef<HTMLElement>(null)
  const size = useElementSize(stageRef)
  const [focus, setFocus] = useState<Strand | null>(null)
  const ended = useSimulation((s) => s.ended)
  const error = useSimulation((s) => s.error)
  const mode = useSimulation((s) => s.mode)
  const seed = useSimulation((s) => s.seed ?? 0)
  const worldFocus = useSimulation((s) => s.focus)
  const cursor = useSimulation((s) => s.cursor)
  const inspectedTick = useSimulation((s) => s.inspected?.tick ?? null)
  const observed = useSimulation((s) => s.inspected ?? s.present)
  const linkVersion = useSimulation((s) => s.linkVersion)
  const remount = `${seed}:${worldFocus}:${cursor === null ? 'now' : (inspectedTick ?? 'pending')}`
  const layout = useMemo(() => (size ? stageLayout(size.width, size.height) : null), [size])
  const fullFrame = useMemo(() => {
    if (!size) return null
    const gutter = Math.max(16, Math.round(size.width * 0.03))
    return {
      left: gutter,
      right: size.width - gutter,
      centerY: size.height / 2,
      height: size.height,
    }
  }, [size])

  return (
    <div className="observatory">
      <TopBar onLeave={onLeave} />
      <main
        className="stage"
        ref={stageRef}
        data-view={stage}
        data-lens={planetOpen ? 'planet' : 'current'}
      >
        {size && stage === '3d' && fullFrame && (
          <>
            <Current3D width={size.width} height={size.height} paused={planetOpen} />
            {planetOpen ? (
              <PlanetView width={size.width} height={size.height} onExit={exitPlanet} />
            ) : (
              <ZoomControls />
            )}
            <Minimap frame={fullFrame} />
          </>
        )}
        {size && layout && stage === '2d' && (
          <>
            <div
              className="planet-slot"
              style={{
                left: layout.planet.cx - layout.planet.size / 2,
                top: layout.planet.cy - layout.planet.size / 2,
              }}
            >
              <Planet
                size={layout.planet.size}
                seed={seed}
                snapshot={observed}
                detail={TIERS[tier].focus}
              />
            </div>
            <Current width={size.width} height={size.height} frame={layout.frame} focus={focus} />
            <ZoomControls />
            <Minimap frame={layout.frame} />
          </>
        )}
      </main>
      <footer className="band">
        <WorldsStrip />
        <StatePanel focus={focus} onFocus={setFocus} />
        <div className="band__main">
          {mode === 'intervene' ? (
            <AllocationPanel key={remount} />
          ) : mode === 'cross' ? (
            <CrossPanel key={remount} />
          ) : (
            <>
              <EventsPanel />
              <CausalPanel />
            </>
          )}
        </div>
        <div className="band__footer">
          <WorldActions />
          <div className="notices" role="status">
            {linkVersion !== null && !isCompatibleVersion(linkVersion) && (
              <p>{t('link.version', { version: linkVersion })}</p>
            )}
            {ended !== null && (
              <p>{t(ended === 'extinction' ? 'ended.extinction' : 'ended.horizon')}</p>
            )}
            {error !== null && <p>{t('error.simulation', { message: error })}</p>}
          </div>
        </div>
      </footer>
    </div>
  )
}
