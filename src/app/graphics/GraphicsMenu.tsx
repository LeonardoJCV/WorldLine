import { useId, useRef, useState } from 'react'
import { useT } from '../i18n/index.ts'
import { useDismiss } from '../views/useDismiss.ts'
import { tierOf, GRAPHICS } from './settings.ts'
import { graphicsStore, useGraphics } from './store.ts'

export function GraphicsMenu() {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const setting = useGraphics((s) => s.setting)
  const measured = useGraphics((s) => s.measured)
  const autoTier = tierOf('auto', measured)

  useDismiss(open, setOpen, root, toggle)

  return (
    <div className="graphics" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="graphics__toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('graphics.label')}
        title={t('graphics.label')}
        onClick={() => setOpen(!open)}
      >
        ⚙
      </button>
      {open && (
        <fieldset className="graphics__menu" id={id}>
          <legend>{t('graphics.label')}</legend>
          {GRAPHICS.map((option) => (
            <label key={option} className="graphics__option">
              <input
                type="radio"
                name={`${id}-graphics`}
                checked={setting === option}
                onChange={() => graphicsStore.getState().setSetting(option)}
              />
              <span>
                {option === 'auto'
                  ? t('graphics.autoWith', { tier: t(`graphics.${autoTier}`) })
                  : t(`graphics.${option}`)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
