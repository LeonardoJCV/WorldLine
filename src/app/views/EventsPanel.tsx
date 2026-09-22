import { useMemo } from 'react'
import { EVENTS } from '../../engine/events.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { historyRows } from './cross.ts'

const EPISODES = new Set(EVENTS.filter((def) => def.kind === 'condition').map((def) => def.id))
const LIMIT = 200
const NO_CROSSINGS = Object.freeze([])

export function EventsPanel() {
  const t = useT()
  const events = useSimulation((s) => s.events)
  const selected = useSimulation((s) => s.selected)
  const world = useSimulation((s) => s.worlds.find((w) => w.info.id === s.focus))
  const fork = world?.info.fork ?? 0
  const crossings = world?.crossings ?? NO_CROSSINGS
  const { select, setCursor } = simulation.getState()

  const recent = useMemo(() => historyRows(events, crossings, LIMIT), [events, crossings])

  return (
    <section className="panel events" aria-labelledby="events-title">
      <h2 className="panel__title" id="events-title">
        {t('events.title')}
      </h2>
      {recent.length === 0 ? (
        <p className="panel__empty">{t('events.empty')}</p>
      ) : (
        <ol className="events__list">
          {recent.map((row) =>
            row.kind === 'event' ? (
              <li key={`e${row.index}`}>
                <button
                  type="button"
                  className="events__item"
                  data-kind="event"
                  aria-current={selected === row.index ? 'true' : undefined}
                  onClick={() => select(row.index)}
                >
                  <span className="events__year">{formatYear(row.year)}</span>
                  <span>{t(`event.${row.record.event}`)}</span>
                  {row.year < fork && (
                    <span className="events__inherited">{t('events.inherited')}</span>
                  )}
                  {row.record.end === null && EPISODES.has(row.record.event) && (
                    <span className="events__ongoing">{t('events.ongoing')}</span>
                  )}
                </button>
              </li>
            ) : (
              // FIX: tick + direção + mundo de origem identificam a travessia, não a posição na lista mesclada
              <li
                key={`c${row.crossing.tick}-${row.crossing.direction}-${row.crossing.origin.world}`}
              >
                <button
                  type="button"
                  className="events__item"
                  data-kind="crossing"
                  onClick={() => {
                    select(null)
                    setCursor(row.year)
                  }}
                >
                  <span className="events__year">{formatYear(row.year)}</span>
                  <span>
                    {row.crossing.direction === 'out'
                      ? // FEAT: só travessia de pessoas sai de uma realidade (validateCrossings garante)
                        t('cross.sent', { id: row.crossing.origin.world })
                      : t('cross.received', {
                          kind: t(`cross.kind.${row.crossing.kind}`),
                          id: row.crossing.origin.world,
                        })}
                  </span>
                  {row.year < fork && (
                    <span className="events__inherited">{t('events.inherited')}</span>
                  )}
                </button>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  )
}
