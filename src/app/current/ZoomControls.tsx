import { useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { MIN_SPAN, resolveView, zoomView } from './view.ts'

export function ZoomControls() {
  const t = useT()
  const view = useSimulation((s) => s.view)
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const cursor = useSimulation((s) => s.cursor)
  const setView = simulation.getState().setView
  const { from, to } = resolveView(view, present)
  const focusYear = cursor ?? Math.round((from + to) / 2)

  return (
    <div className="zoom" role="group" aria-label={t('zoom.label')}>
      <button
        type="button"
        aria-label={t('zoom.out')}
        title={t('zoom.out')}
        disabled={view === null}
        onClick={() => setView(zoomView(view, present, focusYear, 1.25))}
      >
        −
      </button>
      <button
        type="button"
        aria-label={t('zoom.in')}
        title={t('zoom.in')}
        disabled={to - from <= MIN_SPAN}
        onClick={() => setView(zoomView(view, present, focusYear, 0.8))}
      >
        +
      </button>
      <button type="button" disabled={view === null} onClick={() => setView(null)}>
        {t('zoom.fit')}
      </button>
    </div>
  )
}
