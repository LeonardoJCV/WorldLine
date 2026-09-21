import { SPEEDS, type Speed } from '../../worker/protocol.ts'
import { GraphicsMenu } from '../graphics/GraphicsMenu.tsx'
import { formatYear } from '../i18n/format.ts'
import { localeStore, useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import type { Mode } from '../sim/store.ts'

const OPTIONS: readonly Speed[] = [...SPEEDS, 'max']
const MODES: readonly Mode[] = ['observe', 'intervene']

export function TopBar({ onLeave }: { readonly onLeave: () => void }) {
  const t = useT()
  const locale = useLocale()
  const seed = useSimulation((s) => s.seed)
  const now = useSimulation((s) => s.now)
  const cursor = useSimulation((s) => s.cursor)
  const playing = useSimulation((s) => s.playing)
  const speed = useSimulation((s) => s.speed)
  const ended = useSimulation((s) => s.ended)
  const mode = useSimulation((s) => s.mode)
  const { togglePlay, step, setSpeed, setCursor, setMode } = simulation.getState()
  const other = locale === 'en' ? 'pt-BR' : 'en'

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="wordmark">{t('app.name')}</span>
        {seed !== null && (
          <span className="topbar__seed">
            {t('seed.label')} <output data-testid="seed">{seed}</output>
          </span>
        )}
        <button type="button" className="topbar__new" onClick={onLeave}>
          {t('nav.newWorld')}
        </button>
      </div>
      <div className="topbar__controls">
        <div className="mode" role="group" aria-label={t('mode.label')}>
          {MODES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {t(`mode.${option}`)}
            </button>
          ))}
        </div>

        <div className="transport" role="group" aria-label={t('transport.label')}>
          <button
            type="button"
            className="transport__play"
            onClick={togglePlay}
            disabled={ended !== null}
          >
            {playing ? t('transport.pause') : t('transport.play')}
          </button>
          <button type="button" onClick={() => step(1)} disabled={ended !== null || playing}>
            {t('transport.step')}
          </button>
          <div className="transport__speeds">
            {OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={speed === option}
                title={
                  option === 'max'
                    ? t('transport.fastest')
                    : t('transport.yearsPerSecond', { speed: option })
                }
                onClick={() => setSpeed(option)}
              >
                {option === 'max' ? t('transport.speed.max') : `×${option}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="topbar__end">
        <GraphicsMenu />
        <button
          type="button"
          className="locale"
          lang={other}
          onClick={() => localeStore.getState().setLocale(other)}
        >
          {t('locale.switch')}
        </button>
        <div className="topbar__year">
          <p className="year">
            <span className="year__label">
              {cursor === null ? t('year.present') : t('year.label')}
            </span>
            <span className="year__value" data-testid="year">
              {formatYear(cursor ?? now)}
            </span>
          </p>
          {cursor !== null && (
            <button type="button" className="year__return" onClick={() => setCursor(null)}>
              {t('current.returnToPresent')}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
