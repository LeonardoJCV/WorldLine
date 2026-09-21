import { useState } from 'react'
import { MODEL_VERSION } from '../../engine/params.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { MessageKey } from '../i18n/en.ts'
import { useSimulation } from '../sim/runtime.ts'
import { serializeWorld } from '../world/file.ts'
import { saveWorld } from '../world/library.ts'
import type { WorldLink } from '../world/link.ts'

export function WorldActions() {
  const t = useT()
  const [status, setStatus] = useState<MessageKey | null>(null)
  const seed = useSimulation((s) => s.seed)
  const tick = useSimulation((s) => s.present?.tick ?? 0)
  const decisions = useSimulation((s) => s.decisions)
  if (seed === null) return null

  const link: WorldLink = { version: MODEL_VERSION, seed, tick, decisions }
  const name = t('world.name', { seed, year: formatYear(tick) })

  const save = () => {
    saveWorld({ id: crypto.randomUUID(), name, link, savedAt: Date.now() }).then(
      () => setStatus('world.saved'),
      () => setStatus('library.unavailable'),
    )
  }

  const copy = () => {
    navigator.clipboard.writeText(window.location.href).then(
      () => setStatus('world.copied'),
      () => setStatus('world.copyFailed'),
    )
  }

  const exportFile = () => {
    const blob = new Blob([serializeWorld({ name, link })], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `worldline-${seed}-${formatYear(tick)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setStatus('world.exported')
  }

  return (
    <div className="world-actions">
      <button type="button" onClick={save}>
        {t('world.save')}
      </button>
      <button type="button" onClick={copy}>
        {t('world.copy')}
      </button>
      <button type="button" onClick={exportFile}>
        {t('world.export')}
      </button>
      <p className="world-actions__status" role="status">
        {status === null ? '' : t(status)}
      </p>
    </div>
  )
}
