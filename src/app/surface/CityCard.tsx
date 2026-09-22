import { useEffect, useRef } from 'react'
import { formatCompact, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import type { City } from './civilization.ts'
import type { MicroEvent } from './micro.ts'

export type Card =
  | {
      readonly kind: 'city'
      readonly city: City
      readonly name: string
      readonly events: readonly MicroEvent[]
    }
  | { readonly kind: 'micro'; readonly event: MicroEvent; readonly name: string }

export function CityCard({
  card,
  names,
  onClose,
}: {
  readonly card: Card
  readonly names: readonly string[]
  readonly onClose: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const ref = useRef<HTMLElement>(null)
  const opened =
    card.kind === 'city'
      ? `city:${card.city.site}`
      : `micro:${card.event.year}:${card.event.kind}:${card.event.site}`
  useEffect(() => {
    ref.current?.focus()
  }, [opened])
  const describe = (e: MicroEvent) => t(`micro.${e.kind}`, { city: names[e.site] ?? '' })
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="surface__card"
      role="dialog"
      aria-labelledby="surface-card-title"
    >
      <button
        type="button"
        className="surface__card-close"
        onClick={onClose}
        aria-label={t('card.close')}
      >
        ×
      </button>
      {card.kind === 'city' ? (
        <>
          <h2 id="surface-card-title">{card.name}</h2>
          <dl>
            <dt>{t('card.state')}</dt>
            <dd>{t(card.city.state === 'alive' ? 'card.alive' : 'card.ruin')}</dd>
            <dt>{t('card.population')}</dt>
            <dd>
              {card.city.state === 'alive' ? formatCompact(card.city.population, locale) : '—'}
            </dd>
            <dt>{t('card.founded')}</dt>
            <dd>{formatYear(card.city.founded)}</dd>
            <dt>{t('card.activity')}</dt>
            <dd>{t(`card.activity.${card.city.activity}`)}</dd>
          </dl>
          <h3>{t('card.recent')}</h3>
          {card.events.length === 0 ? (
            <p>{t('card.none')}</p>
          ) : (
            <ol>
              {card.events.map((e) => (
                <li key={`${e.year}:${e.kind}`}>
                  <span className="surface__card-year">{formatYear(e.year)}</span> {describe(e)}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <>
          <h2 id="surface-card-title">{describe(card.event)}</h2>
          <p>{t('card.when', { year: formatYear(card.event.year), city: card.name })}</p>
        </>
      )}
    </aside>
  )
}
