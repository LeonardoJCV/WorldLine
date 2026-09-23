import { useState } from 'react'
import { DEFAULT_ALLOCATION, HORIZON } from '../../engine/params.ts'
import { SECTORS, type Allocation } from '../../engine/state.ts'
import { MAX_WORLDLINES } from '../../worker/protocol.ts'
import { formatPercent, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { rebalance, sameAllocation } from '../intervene/allocation.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'

export function AllocationPanel() {
  const t = useT()
  const locale = useLocale()
  const present = useSimulation((s) => s.present?.tick ?? 0)
  const status = useSimulation((s) => s.present?.status ?? 'running')
  const current = useSimulation((s) => s.present?.allocation ?? DEFAULT_ALLOCATION)
  const observed = useSimulation((s) => s.inspected?.allocation ?? null)
  const inspectedTick = useSimulation((s) => s.inspected?.tick ?? null)
  const decisions = useSimulation((s) => s.decisions)
  const cursor = useSimulation((s) => s.cursor)
  const full = useSimulation((s) => s.worlds.length >= MAX_WORLDLINES)
  const branching = useSimulation((s) => s.branching)
  const inPast = cursor !== null
  const awaitingInspect = inPast && inspectedTick !== cursor
  const pending = decisions.at(-1)
  const base = inPast
    ? (observed ?? current)
    : pending !== undefined && pending.tick === present
      ? pending.allocation
      : current
  const [draft, setDraft] = useState<Allocation>(base)
  const { decide, branch, setCursor } = simulation.getState()
  // FIX: colapso encerra a realidade como a extinção; o botão precisa morrer com ela
  const ended = status !== 'running' || present >= HORIZON
  const blocked = inPast
    ? full
      ? t('allocation.limit')
      : null
    : ended
      ? t('allocation.ended')
      : null
  const year = formatYear(cursor ?? present)

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
              disabled={blocked !== null || awaitingInspect}
              onChange={(event) => setDraft(rebalance(draft, sector, Number(event.target.value)))}
            />
            <output className="allocation__value">{formatPercent(draft[sector], locale)}</output>
          </label>
        ))}
      </div>
      <div className="allocation__footer">
        <p className="panel__empty">
          {blocked ??
            (inPast ? t('allocation.branchHint', { year }) : t('allocation.effect', { year }))}
          {inPast && (
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
            onClick={() => (inPast ? branch(draft) : decide(draft))}
            disabled={
              blocked !== null ||
              awaitingInspect ||
              branching ||
              (!inPast && sameAllocation(draft, base))
            }
          >
            {inPast ? t('allocation.branch', { year }) : t('allocation.apply')}
          </button>
        </div>
      </div>
    </section>
  )
}
