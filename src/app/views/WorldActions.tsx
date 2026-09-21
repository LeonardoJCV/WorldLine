import { useState } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import type { MessageKey } from '../i18n/en.ts'
import { useSimulation } from '../sim/runtime.ts'
import { currentLink } from '../world/current.ts'
import { serializeWorld } from '../world/file.ts'
import { saveWorld } from '../world/library.ts'
import { linkHash } from '../world/link.ts'

export function WorldActions() {
  const t = useT()
  const [status, setStatus] = useState<MessageKey | null>(null)
  const seed = useSimulation((s) => s.seed)
  const now = useSimulation((s) => s.now)
  const worlds = useSimulation((s) => s.worlds)
  const link = currentLink({ seed, now, worlds })
  if (link === null) return null

  const name = t('world.name', { seed: link.seed, year: formatYear(link.tick) })

  const save = () => {
    saveWorld({ id: crypto.randomUUID(), name, link, savedAt: Date.now() }).then(
      () => setStatus('world.saved'),
      () => setStatus('library.unavailable'),
    )
  }

  const copy = () => {
    const url = `${window.location.origin}${window.location.pathname}${linkHash(link)}`
    navigator.clipboard.writeText(url).then(
      () => setStatus('world.copied'),
      () => setStatus('world.copyFailed'),
    )
  }

  const exportFile = () => {
    const blob = new Blob([serializeWorld({ name, link })], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `worldline-${link.seed}-${formatYear(link.tick)}.json`
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
