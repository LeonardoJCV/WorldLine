import { useEffect, useRef, useState } from 'react'
import type { ParadoxKind } from '../../engine/debt.ts'
import type { WorldlineId } from '../../worker/protocol.ts'
import { formatCompact } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { paradoxView, repayHint } from './debt.ts'

// FEAT: o alívio dura tempo de leitura, não anos simulados — a ×256 alguns anos passariam num piscar
const RELIEF_MS = 8000

export function ParadoxNotice() {
  const t = useT()
  const locale = useLocale()
  const focus = useSimulation((s) => s.focus)
  const paradox = useSimulation((s) => s.paradox)
  const debts = useSimulation((s) => s.debts)
  const present = useSimulation((s) => s.present)
  const running = present !== null && present.status === 'running'
  const view = paradoxView(paradox, debts, present?.tick ?? 0)
  const kind = view?.kind ?? null
  const hint = repayHint(debts.map((debt) => debt.kind))
  const [relieved, setRelieved] = useState(false)
  // FEAT: o que se anuncia é a espécie do paradoxo neste mundo, não o objeto, que nasce a cada quadro
  const spoken = useRef<{ id: WorldlineId; kind: ParadoxKind | null }>({ id: focus, kind: null })

  useEffect(() => {
    const before = spoken.current
    spoken.current = { id: focus, kind }
    if (before.id !== focus) setRelieved(false)
    else if (before.kind !== null && kind === null) setRelieved(true)
  }, [focus, kind])

  useEffect(() => {
    if (!relieved) return
    const timer = setTimeout(() => setRelieved(false), RELIEF_MS)
    return () => clearTimeout(timer)
  }, [relieved])

  if (!running) return null

  if (view === null) {
    if (!relieved) return null
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
  const deadline = t(view.yearsLeft === 1 ? 'paradox.lastYear' : 'paradox.deadline', {
    years: view.yearsLeft,
    value: formatCompact(view.owed, locale),
  })

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
