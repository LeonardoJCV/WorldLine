import { useState } from 'react'
import { causalDistance } from '../../engine/distance.ts'
import type { WorldlineId } from '../../worker/protocol.ts'
import { formatCompact, formatDecimal, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import type { WorldView } from '../sim/store.ts'
import { crossOrigins } from './cross.ts'
import { collapseYear, debtView } from './debt.ts'

function distanceToOrigin(world: WorldView, worlds: readonly WorldView[]): number | null {
  const origin = worlds.find((candidate) => candidate.info.id === world.info.parent)
  if (!origin || origin.present.tick !== world.present.tick) return null
  return causalDistance(world.present.values, origin.present.values)
}

export function WorldsStrip() {
  const t = useT()
  const locale = useLocale()
  const worlds = useSimulation((s) => s.worlds)
  const focus = useSimulation((s) => s.focus)
  const mode = useSimulation((s) => s.mode)
  const crossOrigin = useSimulation((s) => s.crossOrigin)
  const [confirming, setConfirming] = useState<WorldlineId | null>(null)
  if (worlds.length < 2) return null
  const { setFocus, remove, setCrossOrigin } = simulation.getState()
  // FEAT: no modo Cruzar, a tira oferece as mesmas origens que o painel considera utilizáveis
  const usable = mode === 'cross' ? crossOrigins(worlds, focus) : []

  return (
    <section className="worlds" aria-labelledby="worlds-title">
      <h2 className="panel__title" id="worlds-title">
        {t('worlds.title')}
      </h2>
      <ul className="worlds__list">
        {worlds.map((world) => {
          const { id, parent, fork } = world.info
          const extinct = world.present.status === 'extinct'
          const collapsed = world.present.status === 'collapsed'
          const distance = distanceToOrigin(world, worlds)
          const isOrigin = id === crossOrigin
          const canPickOrigin = usable.some((candidate) => candidate.info.id === id)
          // FEAT: o total já vem pronto do motor; a tira só decide se mostra o selo, não quanto se deve
          const debt = debtView(world.debts, world.previousDebts)
          // FIX: colapso é o prazo do paradoxo vencido — depois dele não há mais contagem em curso
          const inParadox = world.present.status === 'running' && world.paradox !== null
          return (
            <li key={id} className="worlds__item">
              <button
                type="button"
                className="worlds__chip"
                aria-pressed={id === focus}
                // FIX: o total mora no nome do próprio botão, senão quem anda de Tab nunca o ouve
                aria-label={
                  debt
                    ? t('worlds.focusDebt', { id, value: formatCompact(debt.total, locale) })
                    : t('worlds.focus', { id })
                }
                data-origin={isOrigin ? 'true' : undefined}
                onClick={() => setFocus(id)}
              >
                <span className="worlds__id">{id}</span>
                <span className="worlds__meta">
                  <span>
                    {parent === null
                      ? t('worlds.root')
                      : t('worlds.branch', { parent, year: formatYear(fork) })}
                  </span>
                  {extinct ? (
                    <span>{t('worlds.extinct', { year: formatYear(world.present.tick) })}</span>
                  ) : collapsed ? (
                    <span>
                      <span aria-hidden="true">▲ </span>
                      {t('worlds.collapsed', {
                        year: formatYear(collapseYear(world.events) ?? world.present.tick),
                      })}
                    </span>
                  ) : (
                    distance !== null && (
                      <span>
                        {t('worlds.distance', { value: formatDecimal(distance, locale, 2) })}
                      </span>
                    )
                  )}
                </span>
                {debt && (
                  <span
                    className="worlds__debt"
                    aria-hidden="true"
                    title={t('worlds.debt', { value: formatCompact(debt.total, locale) })}
                  >
                    ◇
                  </span>
                )}
              </button>
              {inParadox && (
                <span className="worlds__paradoxMark">
                  <span aria-hidden="true">▲</span> {t('worlds.paradox')}
                </span>
              )}
              {canPickOrigin && (
                <button
                  type="button"
                  className="worlds__origin"
                  aria-pressed={isOrigin}
                  aria-label={t('worlds.origin', { id })}
                  onClick={() => setCrossOrigin(id)}
                >
                  {t('cross.origin', { id })}
                </button>
              )}
              {parent !== null &&
                (confirming === id ? (
                  <span className="worlds__confirm" role="alert">
                    {t('worlds.confirm', { id })}
                    <button
                      type="button"
                      onClick={() => {
                        remove(id)
                        setConfirming(null)
                      }}
                    >
                      {t('worlds.confirmYes')}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      {t('worlds.cancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="worlds__remove"
                    aria-label={t('worlds.remove', { id })}
                    onClick={() => setConfirming(id)}
                  >
                    ×
                  </button>
                ))}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
