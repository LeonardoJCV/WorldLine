import type { Variable } from '../../engine/state.ts'
import { STRANDS, type Strand } from '../current/normalize.ts'
import { formatChange, formatVariable, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { STRAND_COLORS } from '../theme/palette.ts'

const ROWS: readonly Variable[] = [...STRANDS, 'stability']

function isStrand(variable: Variable): variable is Strand {
  return (STRANDS as readonly Variable[]).includes(variable)
}

interface StatePanelProps {
  readonly focus: Strand | null
  readonly onFocus: (strand: Strand | null) => void
}

export function StatePanel({ focus, onFocus }: StatePanelProps) {
  const t = useT()
  const locale = useLocale()
  const snapshot = useSimulation((s) => s.inspected ?? s.present)

  return (
    <section className="panel state" aria-labelledby="state-title">
      <h2 className="panel__title" id="state-title">
        {t('state.title', { year: formatYear(snapshot?.tick ?? 0) })}
      </h2>
      <ul className="state__list" aria-label={t('legend.label')}>
        {ROWS.map((variable) => {
          const change = snapshot
            ? formatChange(
                variable,
                snapshot.values[variable],
                snapshot.previous?.[variable],
                locale,
              )
            : null
          const content = (
            <>
              <span
                className={
                  isStrand(variable) ? 'state__swatch' : 'state__swatch state__swatch--hollow'
                }
                style={isStrand(variable) ? { background: STRAND_COLORS[variable] } : undefined}
                aria-hidden="true"
              />
              <span className="state__name">{t(`variable.${variable}`)}</span>
              <span className="state__value">
                {snapshot ? formatVariable(variable, snapshot.values, locale) : '–'}
              </span>
              <span
                className="state__change"
                data-direction={change?.direction ?? 'flat'}
                title={t('state.change')}
              >
                {change?.text ?? ''}
              </span>
            </>
          )
          return (
            <li key={variable}>
              {isStrand(variable) ? (
                <button
                  type="button"
                  className="state__row"
                  data-active={focus === variable}
                  onPointerEnter={() => onFocus(variable)}
                  onPointerLeave={() => onFocus(null)}
                  onFocus={() => onFocus(variable)}
                  onBlur={() => onFocus(null)}
                >
                  {content}
                </button>
              ) : (
                <div className="state__row">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
