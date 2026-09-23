import { useEffect, useRef } from 'react'
import { embedLabel, formatCompact, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { assimilationLeft, ECHO_KINDS, ECHO_YEARS, type CrossingArc } from './crossings.ts'

export function CrossingCard({
  arc,
  observed,
  onClose,
}: {
  readonly arc: CrossingArc
  readonly observed: number
  readonly onClose: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [arc.key])
  const echoing = ECHO_KINDS.includes(arc.kind)
  const spent = observed - arc.year >= ECHO_YEARS
  const left = echoing && !spent ? assimilationLeft(arc.kind, arc.amounts, arc.year, observed) : 0
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="scene3d__card"
      role="dialog"
      aria-labelledby="scene3d-crossing-title"
    >
      <button
        type="button"
        className="scene3d__card-close"
        onClick={onClose}
        aria-label={t('crossing.close')}
      >
        ×
      </button>
      <h2 id="scene3d-crossing-title">
        {t('crossing.card', { kind: embedLabel(locale, t(`cross.kind.${arc.kind}`)) })}
      </h2>
      <p>
        {t('crossing.route', {
          origin: arc.origin,
          destination: arc.destination,
          year: formatYear(arc.year),
        })}
      </p>
      <p>{t('crossing.cost', { cost: arc.cost })}</p>
      {echoing && (
        <p>
          {spent ? t('crossing.spent') : t('crossing.left', { value: formatCompact(left, locale) })}
        </p>
      )}
    </aside>
  )
}
