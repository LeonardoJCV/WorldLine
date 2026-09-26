import { useEffect, useRef, useState } from 'react'
import type { ParadoxKind } from '../../engine/debt.ts'
import type { Snapshot, WorldlineId } from '../../worker/protocol.ts'
import { formatCompact, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { lastInheritance } from './colonies.ts'
import { endingYear, paradoxView, repayHint } from './debt.ts'
import { lastConfluence } from './merge.ts'

// FEAT: o alívio dura tempo de leitura, não anos simulados — a ×256 alguns anos passariam num piscar
const RELIEF_MS = 8000

type Spoken = {
  readonly id: WorldlineId
  readonly kind: ParadoxKind | null
  readonly status: Snapshot['status'] | null
  readonly inherited: number | null
  // FEAT: o ano da última confluência desta história, que anula dívida sem ninguém ter quitado nada
  readonly confluence: number | null
}

export function ParadoxNotice() {
  const t = useT()
  const locale = useLocale()
  const focus = useSimulation((s) => s.focus)
  const paradox = useSimulation((s) => s.paradox)
  const debts = useSimulation((s) => s.debts)
  const present = useSimulation((s) => s.present)
  const events = useSimulation((s) => s.events)
  const status = present?.status ?? null
  const view = paradoxView(paradox, debts, present?.tick ?? 0)
  const kind = view?.kind ?? null
  const hint = repayHint(debts.map((debt) => debt.kind))
  const [announced, setAnnounced] = useState<'relief' | 'collapse' | null>(null)
  const inherited = lastInheritance(events)?.start ?? null
  const confluence = lastConfluence(events)?.start ?? null
  // FEAT: anuncia-se a espécie do paradoxo e o estado deste mundo, não o objeto, que nasce a cada quadro
  const spoken = useRef<Spoken>({ id: focus, kind: null, status, inherited, confluence })

  useEffect(() => {
    const before = spoken.current
    spoken.current = { id: focus, kind, status, inherited, confluence }
    // FEAT: só o colapso visto acontecer se anuncia; um mundo que já chega colapsado do endereço, não
    if (before.id !== focus) setAnnounced(null)
    else if (before.status === 'running' && status === 'collapsed') setAnnounced('collapse')
    // FIX: a herança zera o paradoxo sem quitar nada; quem fala desse ano é o anúncio da herança
    else if (before.inherited !== inherited) setAnnounced(null)
    // FIX: medido — a confluência anula a dívida com quem desaguou, e alívio ali seria falso
    else if (before.confluence !== confluence) setAnnounced(null)
    else if (before.kind !== null && kind === null) setAnnounced('relief')
  }, [focus, kind, status, inherited, confluence])

  useEffect(() => {
    if (announced === null) return
    const timer = setTimeout(() => setAnnounced(null), RELIEF_MS)
    return () => clearTimeout(timer)
  }, [announced])

  const collapsed = endingYear(events, 'collapse')
  if (announced === 'collapse' && collapsed !== null) {
    return (
      <p className="paradox" data-state="collapse">
        <span className="paradox__mark" aria-hidden="true">
          ▲
        </span>
        <span className="paradox__what">
          {t('paradox.collapsed', { year: formatYear(collapsed) })}
        </span>
      </p>
    )
  }

  if (status !== 'running') return null

  if (view === null) {
    if (announced !== 'relief') return null
    return (
      <p className="paradox" data-state="relief">
        <span className="paradox__mark" aria-hidden="true">
          ✓
        </span>
        <span className="paradox__what">{t('paradox.resolved')}</span>
      </p>
    )
  }

  // FIX: o prazo muda todo ano, e só ele; fora da fala da região viva, para o aviso não ficar tagarela
  const deadline = t(
    view.yearsLeft === 0
      ? 'paradox.thisYear'
      : view.yearsLeft === 1
        ? 'paradox.lastYear'
        : 'paradox.deadline',
    {
      years: view.yearsLeft,
      value: formatCompact(view.owed, locale),
    },
  )

  return (
    <section className="paradox" data-state="warning" data-kind={view.kind}>
      <p className="paradox__headline">
        <span className="paradox__mark" aria-hidden="true">
          ▲
        </span>
        <span className="paradox__what">{t(`paradox.${view.kind}`)}</span>
      </p>
      <p className="paradox__deadline" aria-live="off">
        {deadline}
      </p>
      {hint !== null && <p className="paradox__repay">{t(`debt.hint.${hint}`)}</p>}
    </section>
  )
}
