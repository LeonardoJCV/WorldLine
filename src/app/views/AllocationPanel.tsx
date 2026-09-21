import { useState } from 'react'
import { DEFAULT_ALLOCATION } from '../../engine/params.ts'
import { SECTORS, type Allocation } from '../../engine/state.ts'
import { formatPercent, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { rebalance, sameAllocation } from '../intervene/allocation.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'

export function AllocationPanel() {
  const t = useT()
  const locale = useLocale()
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const current = useSimulation((s) => s.present?.allocation ?? DEFAULT_ALLOCATION)
  const decisions = useSimulation((s) => s.decisions)
  const cursor = useSimulation((s) => s.cursor)
  const ended = useSimulation((s) => s.ended)
  const pending = decisions.at(-1)
  const base = pending !== undefined && pending.tick === present ? pending.allocation : current
  const [draft, setDraft] = useState<Allocation>(base)
  const { decide, setCursor } = simulation.getState()
  const blocked =
    ended !== null ? t('allocation.ended') : cursor !== null ? t('allocation.returnFirst') : null

  return (
    <section className="panel allocation" aria-labelledby="allocation-title">
      <h2 className="panel__title" id="allocation-title">
        {t('allocation.title')}
      </h2>
      <div className="allocation__rows">
        {SECTORS.map((sector) => (
          <label key={sector} className="allocation__row">
            <span className="allocation__name">{t(`sector.${sector}`)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draft[sector]}
              disabled={blocked !== null}
              onChange={(event) => setDraft(rebalance(draft, sector, Number(event.target.value)))}
            />
            <output className="allocation__value">{formatPercent(draft[sector], locale)}</output>
          </label>
        ))}
      </div>
      <div className="allocation__footer">
        <p className="panel__empty">
          {blocked ?? t('allocation.effect', { year: formatYear(present) })}
          {cursor !== null && ended === null && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setCursor(null)}>
                {t('current.returnToPresent')}
              </button>
            </>
          )}
        </p>
        <div className="allocation__actions">
          <button
            type="button"
            onClick={() => setDraft(base)}
            disabled={sameAllocation(draft, base)}
          >
            {t('allocation.reset')}
          </button>
          <button
            type="button"
            className="allocation__apply"
            onClick={() => decide(draft)}
            disabled={blocked !== null || sameAllocation(draft, base)}
          >
            {t('allocation.apply')}
          </button>
        </div>
      </div>
    </section>
  )
}
