import { useState } from 'react'
import { causalDistance } from '../../engine/distance.ts'
import type { WorldlineId } from '../../worker/protocol.ts'
import { formatDecimal, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import type { WorldView } from '../sim/store.ts'

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
  const [confirming, setConfirming] = useState<WorldlineId | null>(null)
  if (worlds.length < 2) return null
  const { setFocus, remove } = simulation.getState()

  return (
    <section className="worlds" aria-labelledby="worlds-title">
      <h2 className="panel__title" id="worlds-title">
        {t('worlds.title')}
      </h2>
      <ul className="worlds__list">
        {worlds.map((world) => {
          const { id, parent, fork } = world.info
          const extinct = world.present.status === 'extinct'
          const distance = distanceToOrigin(world, worlds)
          return (
            <li key={id} className="worlds__item">
              <button
                type="button"
                className="worlds__chip"
                aria-pressed={id === focus}
                aria-label={t('worlds.focus', { id })}
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
                  ) : (
                    distance !== null && (
                      <span>
                        {t('worlds.distance', { value: formatDecimal(distance, locale, 2) })}
                      </span>
                    )
                  )}
                </span>
              </button>
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
