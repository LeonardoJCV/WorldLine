import { useMemo, useRef, useState } from 'react'
import { Current } from '../current/Current.tsx'
import { stageLayout } from '../current/geometry.ts'
import type { Strand } from '../current/normalize.ts'
import { useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { Legend } from './Legend.tsx'
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
  const layout = useMemo(() => (size ? stageLayout(size.width, size.height) : null), [size])

  return (
    <div className="observatory">
      <TopBar />
      <main className="stage" ref={stageRef}>
        {size && layout && (
          <Current width={size.width} height={size.height} frame={layout.frame} focus={focus} />
        )}
      </main>
      <footer className="observatory__footer">
        <Legend focus={focus} onFocus={setFocus} />
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
