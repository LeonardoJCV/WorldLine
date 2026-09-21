import { useEffect, useMemo, useRef, useState } from 'react'
import { MODEL_VERSION } from '../../engine/params.ts'
import { Current } from '../current/Current.tsx'
import { stageLayout } from '../current/geometry.ts'
import { Minimap } from '../current/Minimap.tsx'
import type { Strand } from '../current/normalize.ts'
import { ZoomControls } from '../current/ZoomControls.tsx'
import { TIERS } from '../graphics/settings.ts'
import { useTier } from '../graphics/store.ts'
import { useT } from '../i18n/index.ts'
import { Planet } from '../planet/Planet.tsx'
import { simulation, useSimulation } from '../sim/runtime.ts'
import type { MultiverseLink } from '../world/link.ts'
import { useLinkSync } from '../world/useLinkSync.ts'
import { AllocationPanel } from './AllocationPanel.tsx'
import { CausalPanel } from './CausalPanel.tsx'
import { EventsPanel } from './EventsPanel.tsx'
import { StatePanel } from './StatePanel.tsx'
import { TopBar } from './TopBar.tsx'
import { useElementSize } from './useElementSize.ts'
import { WorldActions } from './WorldActions.tsx'
import { WorldsStrip } from './WorldsStrip.tsx'
import './observatory.css'

export function Observatory({
  link,
  onLeave,
}: {
  readonly link: MultiverseLink
  readonly onLeave: () => void
}) {
  useEffect(() => {
    simulation.getState().open(link)
  }, [link])
  useLinkSync()
  const t = useT()
  const tier = useTier()
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
  const layout = useMemo(() => (size ? stageLayout(size.width, size.height) : null), [size])

  return (
    <div className="observatory">
      <TopBar onLeave={onLeave} />
      <main className="stage" ref={stageRef}>
        {size && layout && (
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
            <AllocationPanel
              key={`${seed}:${worldFocus}:${cursor === null ? 'now' : (inspectedTick ?? 'pending')}`}
            />
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
            {linkVersion !== null && linkVersion !== MODEL_VERSION && (
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
