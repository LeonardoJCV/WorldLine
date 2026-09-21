import { useMemo } from 'react'
import { EVENTS, type EventRecord } from '../../engine/events.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'

const EPISODES = new Set(EVENTS.filter((def) => def.kind === 'condition').map((def) => def.id))
const LIMIT = 200

export function EventsPanel() {
  const t = useT()
  const events = useSimulation((s) => s.events)
  const selected = useSimulation((s) => s.selected)
  const select = simulation.getState().select

  const recent = useMemo(() => {
    const list: { readonly record: EventRecord; readonly index: number }[] = []
    for (let i = events.length - 1; i >= 0 && list.length < LIMIT; i--) {
      const record = events[i]
      if (record) list.push({ record, index: i })
    }
    return list
  }, [events])

  return (
    <section className="panel events" aria-labelledby="events-title">
      <h2 className="panel__title" id="events-title">
        {t('events.title')}
      </h2>
      {recent.length === 0 ? (
        <p className="panel__empty">{t('events.empty')}</p>
      ) : (
        <ol className="events__list">
          {recent.map(({ record, index }) => (
            <li key={index}>
              <button
                type="button"
                className="events__item"
                aria-current={selected === index ? 'true' : undefined}
                onClick={() => select(index)}
              >
                <span className="events__year">{formatYear(record.start)}</span>
                <span>{t(`event.${record.event}`)}</span>
                {record.end === null && EPISODES.has(record.event) && (
                  <span className="events__ongoing">{t('events.ongoing')}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
