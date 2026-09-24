import { SPEEDS, type Speed } from '../../worker/protocol.ts'
import { GraphicsMenu } from '../graphics/GraphicsMenu.tsx'
import { formatYear } from '../i18n/format.ts'
import { localeStore, useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import type { Mode } from '../sim/store.ts'
import { usePhone } from './BottomSheet.tsx'
import { SetupMenu } from './SetupMenu.tsx'

const OPTIONS: readonly Speed[] = [...SPEEDS, 'max']
const MODES: readonly Mode[] = ['observe', 'intervene', 'cross']

export function TopBar({ onLeave }: { readonly onLeave: () => void }) {
  const t = useT()
  const locale = useLocale()
  const phone = usePhone()
  const seed = useSimulation((s) => s.seed)
  const now = useSimulation((s) => s.now)
  const cursor = useSimulation((s) => s.cursor)
  const playing = useSimulation((s) => s.playing)
  const speed = useSimulation((s) => s.speed)
  const ended = useSimulation((s) => s.ended)
  const mode = useSimulation((s) => s.mode)
  const { togglePlay, step, setSpeed, setCursor, setMode } = simulation.getState()
  const other = locale === 'en' ? 'pt-BR' : 'en'
  const playName = playing ? t('transport.pause') : t('transport.play')
  const stepName = t('transport.step')
  const returnName = t('current.returnToPresent')

  const wordmark = <span className="wordmark">{t('app.name')}</span>
  const seedOut =
    seed === null ? null : (
      <span className="topbar__seed">
        {t('seed.label')} <output data-testid="seed">{seed}</output>
      </span>
    )
  const newWorld = (
    <button type="button" className="topbar__new" onClick={onLeave}>
      {t('nav.newWorld')}
    </button>
  )
  const localeSwitch = (
    <button
      type="button"
      className="locale"
      lang={other}
      onClick={() => localeStore.getState().setLocale(other)}
    >
      {t('locale.switch')}
    </button>
  )

  const controls = (
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
        {/* FEAT: no celular a marcha vira sinal, como o zoom já é − e +; o nome acessível fica */}
        <button
          type="button"
          className="transport__play"
          aria-label={playName}
          title={phone ? playName : undefined}
          onClick={togglePlay}
          disabled={ended !== null}
        >
          {phone ? <span aria-hidden="true">{playing ? '❚❚' : '►'}</span> : playName}
        </button>
        <button
          type="button"
          className="transport__step"
          aria-label={stepName}
          title={phone ? stepName : undefined}
          onClick={() => step(1)}
          disabled={ended !== null || playing}
        >
          {phone ? <span aria-hidden="true">+1</span> : stepName}
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
  )

  const year = (
    <div className="topbar__year">
      <p className="year">
        <span className="year__label">{cursor === null ? t('year.present') : t('year.label')}</span>
        <span className="year__value" data-testid="year">
          {formatYear(cursor ?? now)}
        </span>
      </p>
      <button
        type="button"
        className="year__return"
        aria-label={returnName}
        title={phone ? returnName : undefined}
        data-idle={cursor === null || undefined}
        onClick={() => setCursor(null)}
      >
        {phone ? t('year.present') : returnName}
      </button>
    </div>
  )

  // FEAT: no celular a barra guarda o ano e o que se toca enquanto o mundo corre; a montagem mora atrás do ⋯
  if (phone) {
    return (
      <header className="topbar">
        <div className="topbar__end">
          {year}
          <div className="topbar__setup">
            <SetupMenu>
              {wordmark}
              {seedOut}
              {newWorld}
              {localeSwitch}
            </SetupMenu>
            <GraphicsMenu />
          </div>
        </div>
        {controls}
      </header>
    )
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        {wordmark}
        {seedOut}
        {newWorld}
      </div>
      {controls}
      <div className="topbar__end">
        <GraphicsMenu />
        {localeSwitch}
        {year}
      </div>
    </header>
  )
}
