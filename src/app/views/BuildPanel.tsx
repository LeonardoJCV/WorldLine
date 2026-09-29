import { useState } from 'react'
import type { WorkId } from '../../engine/work.ts'
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
import { simulation, useSimulation } from '../sim/runtime.ts'
import {
  buildGroups,
  effectsOf,
  replaceWarning,
  siteProgress,
  yearsLost,
  type WorkRow,
} from './build.ts'

export function BuildPanel() {
  const t = useT()
  const locale = useLocale()
  const present = useSimulation((s) => s.present)
  // FEAT: só pede confirmação quando trocar custaria algo; um canteiro vazio não tem o que perder
  const [confirming, setConfirming] = useState<WorkId | null>(null)

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
  // FEAT: quem está no canteiro e o quanto se perderia — as duas coisas que o aviso de troca precisa,
  // lidas uma vez só e não a cada linha
  const site = groups.flatMap((group) => group.rows).find((row) => row.state === 'building') ?? null
  const lost = yearsLost(present)

  function when(row: WorkRow) {
    if (row.state === 'done') return null
    if (row.years === null) return '—'
    return t(row.years === 1 ? 'build.year' : 'build.years', {
      years: formatCompact(row.years, locale),
    })
  }

  function commit(work: WorkId) {
    simulation.getState().commission(work)
    setConfirming(null)
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
              const warning =
                row.state === 'open' && site !== null && lost !== null
                  ? replaceWarning(row.id, site.id, lost)
                  : null
              return (
                <li key={row.id} className="build__work" data-state={row.state}>
                  <span className="build__name">{t(`work.${row.id}`)}</span>
                  {/* FEAT: numa era fechada o cabeçalho já disse que nada ali alcança, e repetir
                      "fora de alcance" em cada uma das linhas dela não acrescenta nada */}
                  {!(row.state === 'locked' && !group.open) && (
                    <span className="build__state">{t(`build.state.${row.state}`)}</span>
                  )}
                  {/* FEAT: o que muda e quanto demora fluem na mesma linha que quebra, porque em
                      português os dois juntos não cabem na largura de um telefone */}
                  <span className="build__meta">
                    <span className="build__effect">
                      {changes.length === 0
                        ? // FEAT: o foguete é a única obra sem efeito por desenho, e o que ele abre
                          // é `canColonise`, não um coeficiente
                          t(row.id === 'rocket' ? 'build.rocket' : 'build.noEffect')
                        : changes.map((change) => (
                            <span key={change.key} className="build__change">
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
                  {/* FEAT: o que falta só é acionável numa era já aberta; numa fechada a obra
                      espera a era, e listar pré-requisitos ali seria dizer o degrau errado */}
                  {group.open && row.missing.length > 0 && (
                    <span className="build__missing">
                      {t('build.missing', {
                        works: formatList(
                          row.missing.map((need) => t(`work.${need}`)),
                          locale,
                        ),
                      })}
                    </span>
                  )}
                  {row.state === 'open' &&
                    (confirming === row.id ? (
                      // FIX: só chega aqui quando `warning` não é nulo — a troca é o único caminho
                      // que pede confirmação, e ela sempre tem o que dizer
                      <span className="build__action build__confirm" role="alert">
                        {warning &&
                          t(warning.key, {
                            next: t(`work.${warning.next}`),
                            current: t(`work.${warning.current}`),
                            years: formatCompact(warning.years, locale),
                          })}
                        <button type="button" onClick={() => commit(row.id)}>
                          {t('build.commission')}
                        </button>
                        <button type="button" onClick={() => setConfirming(null)}>
                          {t('build.cancel')}
                        </button>
                      </span>
                    ) : (
                      <span className="build__action">
                        <button
                          type="button"
                          className="build__commission"
                          aria-label={t('build.commissionWork', { work: t(`work.${row.id}`) })}
                          onClick={() => (warning ? setConfirming(row.id) : commit(row.id))}
                        >
                          {t('build.commission')}
                        </button>
                      </span>
                    ))}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}
