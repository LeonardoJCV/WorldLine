import type { Colony } from '../../engine/colony.ts'
import type { Debt } from '../../engine/debt.ts'
import type { Variable } from '../../engine/state.ts'
import { STRANDS, type Strand } from '../current/normalize.ts'
import {
  formatChange,
  formatCompact,
  formatList,
  formatVariable,
  formatYear,
} from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { STRAND_COLORS } from '../theme/palette.ts'
import { colonyView } from './colonies.ts'
import { debtView } from './debt.ts'

const ROWS: readonly Variable[] = [...STRANDS, 'stability']
// FIX: referência estável, senão o seletor devolveria um array novo a cada render e travaria a store
const NO_DEBTS: readonly Debt[] = []
const NO_COLONIES: readonly Colony[] = []

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
  const originId = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.info.parent ?? null,
  )
  const origin = useSimulation((s) => {
    const parent = s.worlds.find((world) => world.info.id === s.focus)?.info.parent ?? null
    if (parent === null) return null
    if (s.cursor !== null) return s.inspectedOrigin
    const world = s.worlds.find((candidate) => candidate.info.id === parent)
    return world && world.present.tick === s.present?.tick ? world.present : null
  })
  const comparing = originId !== null
  const debts = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.debts ?? NO_DEBTS,
  )
  // FEAT: a dívida do último ano diferente já relatado pelo store, não uma reconstrução no cliente
  const previousDebts = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.previousDebts ?? null,
  )
  const inPast = useSimulation((s) => s.cursor !== null)
  // FIX: o instantâneo de um ano não carrega dívidas, e a de hoje não vale para o ano observado
  const debt = inPast ? null : debtView(debts, previousDebts)
  const seed = useSimulation((s) => s.seed ?? 0)
  const colonies = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.colonies ?? NO_COLONIES,
  )
  // FIX: mesma regra da dívida — colonies é o presente do mundo, não vale para o ano observado
  const colony = inPast ? null : colonyView(colonies, seed)
  const leader = colony?.leader ?? null

  return (
    <section className="panel state" aria-labelledby="state-title">
      <h2 className="panel__title" id="state-title">
        {t('state.title', { year: formatYear(snapshot?.tick ?? 0) })}
      </h2>
      {comparing && <p className="state__versus">{t('state.versus', { id: originId })}</p>}
      <ul
        className={comparing ? 'state__list state__list--compare' : 'state__list'}
        aria-label={t('legend.label')}
      >
        {ROWS.map((variable) => {
          const change = snapshot
            ? formatChange(
                variable,
                snapshot.values[variable],
                snapshot.previous?.[variable],
                locale,
              )
            : null
          const versus =
            comparing && snapshot
              ? formatChange(variable, snapshot.values[variable], origin?.values[variable], locale)
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
              {comparing && (
                <span
                  className="state__origin"
                  data-direction={versus?.direction ?? 'flat'}
                  title={originId !== null ? t('state.origin', { id: originId }) : undefined}
                >
                  {versus?.text ?? ''}
                </span>
              )}
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
      {debt && (
        <p className="state__debt">
          <span className="state__debtLabel">{t('debt.title')}</span>{' '}
          {t('debt.owed', {
            value: formatCompact(debt.total, locale),
            origins: formatList(debt.origins, locale),
          })}
          {' — '}
          {t(`debt.${debt.trend}`)}
        </p>
      )}
      {colony && leader && (
        <p className="state__colonies">
          <span className="state__coloniesLabel">{t('colonies.title')}</span>{' '}
          {colony.count === 1
            ? t('colonies.one', { body: leader.body })
            : t('colonies.many', { count: colony.count, body: leader.body })}
          {' — '}
          {t(leader.self ? 'colonies.self' : 'colonies.supported')}
        </p>
      )}
    </section>
  )
}
