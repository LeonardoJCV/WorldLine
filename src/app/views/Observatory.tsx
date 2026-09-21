import { useMemo, useRef, useState } from 'react'
import { Current } from '../current/Current.tsx'
import { stageLayout } from '../current/geometry.ts'
import { Minimap } from '../current/Minimap.tsx'
import type { Strand } from '../current/normalize.ts'
import { ZoomControls } from '../current/ZoomControls.tsx'
import { useT } from '../i18n/index.ts'
import { Planet } from '../planet/Planet.tsx'
import { useSimulation } from '../sim/runtime.ts'
import { AllocationPanel } from './AllocationPanel.tsx'
import { CausalPanel } from './CausalPanel.tsx'
import { EventsPanel } from './EventsPanel.tsx'
import { StatePanel } from './StatePanel.tsx'
import { TopBar } from './TopBar.tsx'
import { useElementSize } from './useElementSize.ts'
import './observatory.css'

export function Observatory() {
  const t = useT()
  const stageRef = useRef<HTMLElement>(null)
  const size = useElementSize(stageRef)
  const [focus, setFocus] = useState<Strand | null>(null)
  const ended = useSimulation((s) => s.ended)
  const error = useSimulation((s) => s.error)
  const mode = useSimulation((s) => s.mode)
  const seed = useSimulation((s) => s.seed)
  const layout = useMemo(() => (size ? stageLayout(size.width, size.height) : null), [size])

  return (
    <div className="observatory">
      <TopBar />
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
              <Planet size={layout.planet.size} />
            </div>
            <Current width={size.width} height={size.height} frame={layout.frame} focus={focus} />
            <ZoomControls />
            <Minimap frame={layout.frame} />
          </>
        )}
      </main>
      <footer className="band">
        <StatePanel focus={focus} onFocus={setFocus} />
        <div className="band__main">
          {mode === 'intervene' ? (
            <AllocationPanel key={seed ?? 0} />
          ) : (
            <>
              <EventsPanel />
              <CausalPanel />
            </>
          )}
        </div>
        <div className="notices" role="status">
          {ended !== null && (
            <p>{t(ended === 'extinction' ? 'ended.extinction' : 'ended.horizon')}</p>
          )}
          {error !== null && <p>{t('error.simulation', { message: error })}</p>}
        </div>
      </footer>
    </div>
  )
}
