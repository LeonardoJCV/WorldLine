import { useEffect, useState } from 'react'
import { formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { parseWorldFile } from '../world/file.ts'
import { listWorlds, removeWorld, type SavedWorld } from '../world/library.ts'
import type { WorldLink } from '../world/link.ts'

interface LibraryPanelProps {
  readonly onOpen: (link: WorldLink) => void
}

export function LibraryPanel({ onOpen }: LibraryPanelProps) {
  const t = useT()
  const locale = useLocale()
  const [worlds, setWorlds] = useState<readonly SavedWorld[]>([])
  const [problem, setProblem] = useState<'library.invalid' | 'library.unavailable' | null>(null)

  useEffect(() => {
    let active = true
    listWorlds().then(
      (list) => {
        if (active) setWorlds(list)
      },
      () => {
        if (active) setProblem('library.unavailable')
      },
    )
    return () => {
      active = false
    }
  }, [])

  const remove = (id: string) => {
    removeWorld(id).then(
      () => setWorlds((list) => list.filter((world) => world.id !== id)),
      () => setProblem('library.unavailable'),
    )
  }

  const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  return (
    <section className="library" aria-labelledby="library-title">
      <h2 className="panel__title" id="library-title">
        {t('library.title')}
      </h2>
      {worlds.length === 0 ? (
        <p className="panel__empty">{t('library.empty')}</p>
      ) : (
        <ul className="library__list">
          {worlds.map((world) => (
            <li key={world.id} className="library__item">
              <span className="library__name">{world.name}</span>
              <span className="library__meta">
                {t('library.meta', {
                  year: formatYear(world.link.tick),
                  date: dates.format(world.savedAt),
                })}
              </span>
              <button type="button" onClick={() => onOpen(world.link)}>
                {t('library.open')}
              </button>
              <button type="button" onClick={() => remove(world.id)}>
                {t('library.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="library__import">
        {t('library.import')}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            file.text().then(
              (text) => {
                const parsed = parseWorldFile(text)
                if (parsed) onOpen(parsed.link)
                else setProblem('library.invalid')
              },
              () => setProblem('library.invalid'),
            )
          }}
        />
      </label>
      {problem !== null && (
        <p className="panel__empty" role="alert">
          {t(problem)}
        </p>
      )}
    </section>
  )
}
