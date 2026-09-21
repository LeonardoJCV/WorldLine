import { useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { TopBar } from './TopBar.tsx'
import './observatory.css'

export function Observatory() {
  const t = useT()
  const ended = useSimulation((s) => s.ended)
  const error = useSimulation((s) => s.error)

  return (
    <div className="observatory">
      <TopBar />
      <main className="stage" />
      <footer className="observatory__footer">
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
