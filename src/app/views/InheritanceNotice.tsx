import { useEffect, useRef, useState } from 'react'
import type { Colony } from '../../engine/colony.ts'
import { formatCompact, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import {
  homeBody,
  inheritanceHeir,
  inheritanceView,
  lastInheritance,
  type InheritanceView,
} from './colonies.ts'

// FEAT: o anúncio dura tempo de leitura, como o alívio do paradoxo, e quase o dobro dele: são duas
// frases, e o ano em que uma história trocou de mundo merece ser lido duas vezes antes de sair
const MOMENT_MS = 15000

interface Seen {
  readonly key: string
  // FEAT: a última leva de colônias vista, porque no ano da mudança a frota do mundo natal já foi
  readonly colonies: readonly Colony[]
  readonly year: number | null
  readonly home: number
}

export function InheritanceNotice() {
  const t = useT()
  const locale = useLocale()
  const focus = useSimulation((s) => s.focus)
  const seed = useSimulation((s) => s.seed ?? 0)
  const generation = useSimulation(
    (s) => s.worlds.find((world) => world.info.id === s.focus)?.info.generation ?? 0,
  )
  const events = useSimulation((s) => s.events)
  const colonies = useSimulation((s) => s.colonies)
  const [moment, setMoment] = useState<InheritanceView | null>(null)
  const key = `${seed}:${focus}:${generation}`
  const seen = useRef<Seen>({ key, colonies, year: null, home: homeBody(seed) })

  useEffect(() => {
    const before = seen.current
    const record = lastInheritance(events)
    const year = record?.start ?? null
    const kept = colonies.length > 0 ? colonies : before.colonies
    // FEAT: uma história que já chega mudada de mundo não se anuncia; ninguém a viu partir
    if (before.key !== key) {
      seen.current = { key, colonies, year, home: homeBody(seed) }
      setMoment(null)
      return
    }
    if (record === null || year === before.year) {
      seen.current = { ...before, colonies: kept }
      return
    }
    const heir = inheritanceHeir(record, events, before.colonies)
    seen.current = {
      key,
      colonies: kept,
      year,
      home: heir === null ? before.home : heir.body,
    }
    // FIX: sem a colônia herdeira na memória não há de onde nem para onde; melhor calar que meia frase
    setMoment(heir === null ? null : inheritanceView(record, heir, seed, before.home))
  }, [key, seed, events, colonies])

  useEffect(() => {
    if (moment === null) return
    const timer = setTimeout(() => setMoment(null), MOMENT_MS)
    return () => clearTimeout(timer)
  }, [moment])

  if (moment === null) return null

  return (
    <section className="inheritance">
      <p className="inheritance__when">
        <span className="inheritance__mark" aria-hidden="true">
          ✦
        </span>
        <span>{t('inheritance.year', { year: formatYear(moment.year) })}</span>
      </p>
      <p className="inheritance__moved">
        {t('inheritance.moved', {
          body: moment.body,
          people: formatCompact(moment.people, locale),
          home: moment.home,
        })}
      </p>
      <p className="inheritance__kept">{t('inheritance.kept')}</p>
    </section>
  )
}
