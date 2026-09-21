import { useMemo, useRef, useState } from 'react'
import { genesis } from '../../engine/genesis.ts'
import { MODEL_VERSION } from '../../engine/params.ts'
import { toSnapshot } from '../../worker/protocol.ts'
import { formatCompact, formatDecimal } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { Planet } from '../planet/Planet.tsx'
import { useElementSize } from '../views/useElementSize.ts'
import type { WorldLink } from '../world/link.ts'
import { randomSeed, seedFromText } from '../world/seed.ts'
import { LibraryPanel } from './LibraryPanel.tsx'
import './genesis.css'

interface GenesisProps {
  readonly onStart: (link: WorldLink) => void
}

export function Genesis({ onStart }: GenesisProps) {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = useState(() => String(randomSeed()))
  const seed = seedFromText(text)
  const preview = useMemo(() => (seed === null ? null : genesis(seed)), [seed])
  const snapshot = useMemo(() => (preview ? toSnapshot(preview.state) : null), [preview])
  const planetRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(planetRef)
  const planetSize = size ? Math.round(Math.min(size.width, size.height) * 0.92) : 0

  return (
    <div className="genesis">
      <section className="genesis__intro">
        <p className="wordmark">{t('app.name')}</p>
        <h1 className="genesis__tagline">{t('app.tagline')}</h1>
        <p className="genesis__lead">{t('genesis.lead')}</p>
        <form
          className="genesis__form"
          onSubmit={(event) => {
            event.preventDefault()
            if (seed !== null) onStart({ version: MODEL_VERSION, seed, tick: 0, decisions: [] })
          }}
        >
          <label className="genesis__field">
            <span>{t('genesis.seedLabel')}</span>
            <input
              value={text}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={seed === null}
              aria-describedby="seed-hint"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p id="seed-hint" className="genesis__hint">
            {seed === null ? t('genesis.invalid') : t('genesis.hint', { seed })}
          </p>
          <div className="genesis__actions">
            <button type="button" onClick={() => setText(String(randomSeed()))}>
              {t('genesis.random')}
            </button>
            <button type="submit" className="genesis__start" disabled={seed === null}>
              {t('genesis.start')}
            </button>
          </div>
        </form>
        {preview && (
          <section className="genesis__traits" aria-labelledby="traits-title">
            <h2 className="panel__title" id="traits-title">
              {t('genesis.traits')}
            </h2>
            <dl>
              <div>
                <dt>{t('variable.population')}</dt>
                <dd>{formatCompact(preview.state.population, locale)}</dd>
              </div>
              <div>
                <dt>{t('variable.technology')}</dt>
                <dd>{formatDecimal(preview.state.technology, locale, 0)}</dd>
              </div>
              <div>
                <dt>{t('variable.environment')}</dt>
                <dd>{formatDecimal(preview.state.environment, locale, 0)}</dd>
              </div>
              <div>
                <dt>{t('genesis.fertility')}</dt>
                <dd>×{formatDecimal(preview.world.fertility, locale, 2)}</dd>
              </div>
            </dl>
          </section>
        )}
        <LibraryPanel onOpen={onStart} />
      </section>
      <div className="genesis__planet" ref={planetRef}>
        {seed !== null && snapshot && planetSize > 0 && (
          <Planet size={planetSize} seed={seed} snapshot={snapshot} />
        )}
      </div>
    </div>
  )
}
