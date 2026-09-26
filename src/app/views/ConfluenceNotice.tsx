import { useEffect, useRef, useState } from 'react'
import { formatCompact, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { confluenceView, lastConfluence, type ConfluenceView } from './merge.ts'

// FEAT: o mesmo tempo de leitura da herança, a outra vez em que uma história deixa de ser o que era
const MOMENT_MS = 15000

interface Seen {
  readonly key: string
  readonly year: number | null
}

export function ConfluenceNotice() {
  const t = useT()
  const locale = useLocale()
  const focus = useSimulation((s) => s.focus)
  const seed = useSimulation((s) => s.seed ?? 0)
  const generation = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.info.generation ?? 0,
  )
  const events = useSimulation((s) => s.events)
  const present = useSimulation((s) => s.present)
  const [moment, setMoment] = useState<ConfluenceView | null>(null)
  const key = `${seed}:${focus}:${generation}`
  const seen = useRef<Seen>({ key, year: null })

  useEffect(() => {
    const before = seen.current
    const record = lastConfluence(events)
    const year = record?.start ?? null
    seen.current = { key, year }
    // FEAT: uma história que já chega unida não se anuncia; ninguém viu as duas virarem uma
    if (before.key !== key) {
      setMoment(null)
      return
    }
    if (record === null || year === before.year) return
    setMoment(confluenceView(record, focus, present?.values.population ?? 0))
  }, [key, focus, events, present])

  useEffect(() => {
    if (moment === null) return
    const timer = setTimeout(() => setMoment(null), MOMENT_MS)
    return () => clearTimeout(timer)
  }, [moment])

  if (moment === null) return null

  return (
    <section className="confluence">
      <p className="confluence__when">
        <span className="confluence__mark" aria-hidden="true">
          ✧
        </span>
        <span>{t('confluence.year', { year: formatYear(moment.year) })}</span>
      </p>
      <p className="confluence__joined">
        {t('confluence.joined', {
          other: moment.other,
          survivor: moment.survivor,
          people: formatCompact(moment.people, locale),
        })}
      </p>
      <p className="confluence__kept">{t('confluence.kept')}</p>
    </section>
  )
}
