import { STRANDS, type Strand } from '../current/normalize.ts'
import { formatVariable } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { STRAND_COLORS } from '../theme/palette.ts'

interface LegendProps {
  readonly focus: Strand | null
  readonly onFocus: (strand: Strand | null) => void
}

export function Legend({ focus, onFocus }: LegendProps) {
  const t = useT()
  const locale = useLocale()
  const snapshot = useSimulation((s) => s.inspected ?? s.present)

  return (
    <ul className="legend" aria-label={t('legend.label')}>
      {STRANDS.map((strand) => (
        <li key={strand}>
          <button
            type="button"
            className="legend__item"
            data-active={focus === strand}
            onPointerEnter={() => onFocus(strand)}
            onPointerLeave={() => onFocus(null)}
            onFocus={() => onFocus(strand)}
            onBlur={() => onFocus(null)}
          >
            <span
              className="legend__swatch"
              style={{ background: STRAND_COLORS[strand] }}
              aria-hidden="true"
            />
            <span className="legend__name">{t(`variable.${strand}`)}</span>
            <span className="legend__value">
              {snapshot ? formatVariable(strand, snapshot.values, locale) : '–'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
