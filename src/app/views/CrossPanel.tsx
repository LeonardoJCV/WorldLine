import { useEffect, useState } from 'react'
import { CROSSING_KINDS, type CrossingKind, type Dose } from '../../engine/crossing.ts'
import { HORIZON } from '../../engine/params.ts'
import type { Snapshot, WorldlineId } from '../../worker/protocol.ts'
import { formatCompact, formatDecimal, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { client, simulation, useSimulation } from '../sim/runtime.ts'
import { crossBlock, crossQuote, DOSES_FOR } from './cross.ts'

interface Done {
  readonly kind: CrossingKind
  readonly id: WorldlineId
}

const CONFIRMATION = 6000

function ended(snapshot: Snapshot): boolean {
  return snapshot.status === 'extinct' || snapshot.tick >= HORIZON
}

export function CrossPanel() {
  const t = useT()
  const locale = useLocale()
  const worlds = useSimulation((s) => s.worlds)
  const focus = useSimulation((s) => s.focus)
  const credit = useSimulation((s) => s.credit)
  const origin = useSimulation((s) => s.crossOrigin)
  const cursor = useSimulation((s) => s.cursor)
  const present = useSimulation((s) => s.present)
  const inspected = useSimulation((s) => s.inspected)
  const branching = useSimulation((s) => s.branching)
  const [kind, setKind] = useState<CrossingKind>('knowledge')
  const [dose, setDose] = useState<Dose>(1)
  const [observed, setObserved] = useState<Snapshot | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const { cross, setCrossOrigin, setCursor } = simulation.getState()
  const inPast = cursor !== null

  useEffect(() => {
    if (origin === null || cursor === null) return
    let cancelled = false
    const frameId = requestAnimationFrame(() => {
      client.inspect(origin, cursor).then(
        (snapshot) => {
          if (!cancelled) setObserved(snapshot)
        },
        (error: unknown) => {
          if (!cancelled) {
            simulation.setState({ error: error instanceof Error ? error.message : String(error) })
          }
        },
      )
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [origin, cursor])

  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), CONFIRMATION)
    return () => clearTimeout(timer)
  }, [done])

  const world = worlds.find((candidate) => candidate.info.id === origin) ?? null
  const originEnded = world !== null && ended(world.present)
  // FIX: no passado só serve o estado do próprio ano observado, nunca o que sobrou do ano anterior
  const source = inPast ? (observed?.tick === cursor ? observed : null) : (world?.present ?? null)
  const destination = inPast ? (inspected?.tick === cursor ? inspected : null) : present
  const doses = DOSES_FOR(kind)
  const carried = doses.includes(dose) ? dose : 1
  const year = formatYear(cursor ?? present?.tick ?? 0)
  const awaiting =
    inPast && origin !== null && !originEnded && (source === null || destination === null)
  const blocked = crossBlock({
    kind,
    dose: carried,
    cursor,
    credit,
    worlds: worlds.length,
    origin: source ?? world?.present ?? null,
    destination,
    originEnded,
    destinationEnded: !inPast && present !== null && ended(present),
  })
  const quote =
    source !== null && destination !== null
      ? crossQuote({ kind, dose: carried, origin: source, destination })
      : null
  const [first = 0, second = 0] = quote?.amounts ?? []
  const open = () => {
    if (origin === null) return
    cross(kind, carried)
    if (!inPast) setDone({ kind, id: origin })
  }

  return (
    <section className="panel cross" aria-labelledby="cross-title">
      <h2 className="panel__title" id="cross-title">
        {t('cross.title', { id: focus })}
      </h2>
      <div className="cross__groups">
        {worlds.length > 1 && (
          <div className="cross__row">
            <span className="cross__label" id="cross-origin-label">
              {t('cross.originLabel')}
            </span>
            <div className="cross__group" role="group" aria-labelledby="cross-origin-label">
              {worlds
                .filter((candidate) => candidate.info.id !== focus && !ended(candidate.present))
                .map((candidate) => (
                  <button
                    key={candidate.info.id}
                    type="button"
                    aria-pressed={candidate.info.id === origin}
                    onClick={() => setCrossOrigin(candidate.info.id)}
                  >
                    {t('cross.origin', { id: candidate.info.id })}
                  </button>
                ))}
            </div>
          </div>
        )}
        <div className="cross__row">
          <span className="cross__label" id="cross-kind-label">
            {t('cross.kindLabel')}
          </span>
          <div className="cross__group" role="group" aria-labelledby="cross-kind-label">
            {CROSSING_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                disabled={inPast && option === 'people'}
                {...(inPast && option === 'people'
                  ? { 'aria-describedby': 'cross-people-note' }
                  : {})}
                onClick={() => setKind(option)}
              >
                {t(`cross.kind.${option}`)}
              </button>
            ))}
          </div>
        </div>
        {inPast && (
          <p className="cross__note" id="cross-people-note">
            {t('cross.peopleOnlyNow')}
          </p>
        )}
        {doses.length > 1 && (
          <div className="cross__row">
            <span className="cross__label" id="cross-dose-label">
              {t('cross.doseLabel')}
            </span>
            <div className="cross__group" role="group" aria-labelledby="cross-dose-label">
              {doses.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={carried === option}
                  onClick={() => setDose(option)}
                >
                  {t(`cross.dose.${option}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {quote !== null && world !== null && (
        <div className="cross__quote">
          <p className="cross__price">{t('cross.price', { cost: quote.cost, credit })}</p>
          <p className="cross__carries">
            {kind === 'knowledge' &&
              t('cross.carries.knowledge', { value: formatDecimal(first, locale, 1) })}
            {kind === 'resource' &&
              t('cross.carries.resource', {
                food: formatCompact(first, locale),
                energy: formatDecimal(second, locale, 1),
              })}
            {kind === 'doctrine' && t('cross.carries.doctrine', { id: world.info.id })}
            {kind === 'people' &&
              t('cross.carries.people', {
                value: formatCompact(first, locale),
                id: world.info.id,
              })}
          </p>
        </div>
      )}
      <div className="cross__footer">
        <p className="panel__empty" id="cross-reason">
          {blocked === null
            ? t(inPast ? 'cross.hintPast' : 'cross.hint', { year })
            : t(blocked.key, { id: origin ?? focus, ...blocked.params })}
          {inPast && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setCursor(null)}>
                {t('current.returnToPresent')}
              </button>
            </>
          )}
        </p>
        <div className="cross__actions">
          <button
            type="button"
            className="cross__open"
            aria-describedby="cross-reason"
            disabled={blocked !== null || awaiting || branching || quote === null}
            onClick={open}
          >
            {awaiting
              ? t('cross.loading')
              : inPast
                ? t('cross.openFromYear', { year })
                : t('cross.open')}
          </button>
        </div>
      </div>
      <p className="cross__status" role="status">
        {done === null ? '' : t('cross.done', { kind: t(`cross.kind.${done.kind}`), id: done.id })}
      </p>
    </section>
  )
}
