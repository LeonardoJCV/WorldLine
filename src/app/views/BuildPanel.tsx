import {
  eraKey,
  formatCompact,
  formatList,
  formatPercent,
  formatSignedDecimal,
  formatSignedPercent,
  workKey,
} from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { buildGroups, effectsOf, siteProgress, type WorkRow } from './build.ts'

export function BuildPanel() {
  const t = useT()
  const locale = useLocale()
  const present = useSimulation((s) => s.present)

  if (present === null) {
    return (
      <section className="panel build" aria-labelledby="build-title">
        <h2 className="panel__title" id="build-title">
          {t('mode.build')}
        </h2>
        <p className="panel__empty">{t('build.empty')}</p>
      </section>
    )
  }

  const groups = buildGroups(present)
  const share = siteProgress(present)

  function when(row: WorkRow) {
    if (row.state === 'done') return null
    if (row.years === null) return '—'
    return t(row.years === 1 ? 'build.year' : 'build.years', {
      years: formatCompact(row.years, locale),
    })
  }

  return (
    <section className="panel build" aria-labelledby="build-title">
      <h2 className="panel__title" id="build-title">
        {t('mode.build')}
      </h2>
      {present.rate <= 0 && <p className="build__note">{t('build.noRate')}</p>}
      {groups.map((group) => (
        <section
          key={group.era}
          className="build__era"
          data-open={group.open ? 'true' : 'false'}
          aria-labelledby={`build-era-${group.era}`}
        >
          <h3 className="build__eraName" id={`build-era-${group.era}`}>
            {t(eraKey(group.era))}
            {!group.open && <span className="build__closed">{t('build.closed')}</span>}
          </h3>
          <ul className="build__list">
            {group.rows.map((row) => {
              const changes = effectsOf(row.def)
              const years = when(row)
              return (
                <li key={row.id} className="build__work" data-state={row.state}>
                  <span className="build__name">{t(`work.${row.id}`)}</span>
                  <span className="build__state">{t(`build.state.${row.state}`)}</span>
                  {/* FEAT: o que muda e quanto demora fluem na mesma linha que quebra, porque em
                      português os dois juntos não cabem na largura de um telefone */}
                  <span className="build__meta">
                    <span className="build__effect">
                      {changes.length === 0
                        ? t('build.noEffect')
                        : changes.map((change) => (
                            <span
                              key={change.key}
                              className="build__change"
                              data-kind={change.kind}
                            >
                              {t(workKey(change.key))}{' '}
                              {change.kind === 'factor'
                                ? formatSignedPercent(change.value - 1, locale)
                                : formatSignedDecimal(change.value, locale)}
                            </span>
                          ))}
                    </span>
                    <span className="build__when">
                      {/* FEAT: o canteiro mostra o quanto já está de pé, que é o que faz esperar
                          valer mais a pena do que trocar de obra */}
                      {row.state === 'building' && share !== null && (
                        <span className="build__progress">
                          {t('build.progress', { percent: formatPercent(share * 100, locale) })}
                        </span>
                      )}
                      {years !== null && <span className="build__years">{years}</span>}
                    </span>
                  </span>
                  {row.missing.length > 0 && (
                    <span className="build__missing">
                      {t('build.missing', {
                        works: formatList(
                          row.missing.map((need) => t(`work.${need}`)),
                          locale,
                        ),
                      })}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}
