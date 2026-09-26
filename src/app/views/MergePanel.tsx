import { useEffect, useState } from 'react'
import type { WorldlineId } from '../../worker/protocol.ts'
import { formatCompact, formatDecimal, formatMetric } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { bodyName, currentHome } from './colonies.ts'
import { worldEnded } from './cross.ts'
import { homeChange, mergeBlock, mergePartners, seamView } from './merge.ts'

interface Done {
  readonly survivor: WorldlineId
  readonly other: WorldlineId
}

const CONFIRMATION = 6000

export function MergePanel() {
  const t = useT()
  const locale = useLocale()
  const worlds = useSimulation((s) => s.worlds)
  const focus = useSimulation((s) => s.focus)
  const now = useSimulation((s) => s.now)
  const playing = useSimulation((s) => s.playing)
  const present = useSimulation((s) => s.present)
  const chosen = useSimulation((s) => s.mergeOther)
  const preview = useSimulation((s) => s.mergePreview)
  const seed = useSimulation((s) => s.seed ?? 0)
  const [done, setDone] = useState<Done | null>(null)
  const [pending, setPending] = useState(false)
  const { setMergeOther, previewMerge, merge } = simulation.getState()
  const survivor = worlds.find((candidate) => candidate.info.id === focus) ?? null
  const partners = mergePartners(worlds, focus)
  // FIX: só uma parceira elegível conta como escolhida; a que morreu depois de escolhida não vale
  const partner = partners.find((candidate) => candidate.info.id === chosen) ?? null
  const other = partner?.info.id ?? null
  const incoming = partner?.present ?? null

  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), CONFIRMATION)
    return () => clearTimeout(timer)
  }, [done])

  // FIX: a prévia só vale para o ano em que a costura acontece, que é o presente do hospedeiro
  const seamed = preview !== null && preview.seamed.tick === now ? preview : null
  const seam =
    present !== null && incoming !== null && seamed !== null && other !== null
      ? {
          view: seamView(present, seamed.seamed, incoming, seamed.shock, [focus, other]),
          incoming,
          homes: homeChange(
            currentHome(seed, present.home),
            currentHome(seed, incoming.home),
            currentHome(seed, seamed.seamed.home),
          ),
        }
      : null
  const blocked = mergeBlock({
    worlds: worlds.length,
    partners: partners.length,
    survivor: focus,
    survivorEnded: survivor === null || worldEnded(survivor.present),
    survivorSeam: survivor?.merges.at(-1)?.tick ?? null,
    other,
    otherTick: incoming?.tick ?? null,
    otherSeam: partner?.merges.at(-1)?.tick ?? null,
    now,
    playing,
    ready: seam !== null,
  })
  // FIX: pedir a prévia do que o hospedeiro recusaria só renderia um erro; pede-se só o que costuraria
  const askable = blocked === null || blocked.key === 'merge.loading'

  // FEAT: com os anos correndo a costura muda a cada um, então a prévia se pede com o tempo parado
  useEffect(() => {
    if (other === null || !askable) return
    previewMerge(other)
  }, [other, focus, now, askable, previewMerge])

  const sew = () => {
    if (other === null) return
    setPending(true)
    merge(other).then(
      () => {
        setPending(false)
        setDone({ survivor: focus, other })
      },
      () => setPending(false),
    )
  }

  return (
    <section className="panel merge" aria-labelledby="merge-title">
      <h2 className="panel__title" id="merge-title">
        {other === null ? t('merge.pick') : t('merge.title', { survivor: focus, other })}
      </h2>
      {partners.length > 0 && (
        <div className="merge__row">
          <span className="merge__label" id="merge-pick-label">
            {t('merge.pick')}
          </span>
          <div className="merge__group" role="group" aria-labelledby="merge-pick-label">
            {partners.map((candidate) => (
              <button
                key={candidate.info.id}
                type="button"
                aria-pressed={candidate.info.id === other}
                onClick={() => setMergeOther(candidate.info.id)}
              >
                {t('merge.from', { id: candidate.info.id })}
              </button>
            ))}
          </div>
        </div>
      )}
      {seam !== null && other !== null && (
        <div className="merge__seam">
          <p className="merge__pair">{t('merge.title', { survivor: focus, other })}</p>
          <ul className="merge__rows">
            {seam.view.rows.map((row) => (
              <li key={row.variable} data-variable={row.variable}>
                <span className="merge__name">{t(`variable.${row.variable}`)}</span>
                <span className="merge__flow">
                  {t(row.kind === 'sum' ? 'merge.sum' : 'merge.blend', {
                    now: formatMetric(row.variable, row.now, locale),
                    incoming: formatMetric(
                      row.variable,
                      seam.incoming.values[row.variable],
                      locale,
                    ),
                    next: formatMetric(row.variable, row.next, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="merge__shock">
            {t('merge.shock', { shock: formatDecimal(seam.view.shock, locale, 1) })}
          </p>
          {seam.view.debtIn > 0 && (
            <p className="merge__note">
              {t('merge.debtIn', { value: formatCompact(seam.view.debtIn, locale) })}
            </p>
          )}
          {seam.view.debtSettled > 0 && (
            <p className="merge__note">
              {t('merge.debtSettled', { value: formatCompact(seam.view.debtSettled, locale) })}
            </p>
          )}
          {seam.homes !== null && (
            <p className="merge__note">
              {t('merge.homes', {
                body: bodyName(seed, seam.homes.body),
                left: bodyName(seed, seam.homes.left),
              })}
            </p>
          )}
        </div>
      )}
      {other !== null && (
        <p className="merge__ends" id="merge-ends">
          {t('merge.ends', { survivor: focus })}
        </p>
      )}
      <div className="merge__footer">
        <p className="panel__empty" id="merge-reason">
          {blocked === null ? '' : t(blocked.key, blocked.params)}
        </p>
        <div className="merge__actions">
          <button
            type="button"
            className="merge__confirm"
            aria-describedby={other === null ? 'merge-reason' : 'merge-ends merge-reason'}
            disabled={blocked !== null || pending}
            onClick={sew}
          >
            {t('merge.confirm')}
          </button>
        </div>
      </div>
      <p className="merge__status" role="status">
        {done === null ? '' : t('merge.done', { survivor: done.survivor, other: done.other })}
      </p>
    </section>
  )
}
