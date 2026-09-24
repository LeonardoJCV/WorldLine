import { useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n/index.ts'
import { useDismiss } from './useDismiss.ts'

export function SetupMenu({ children }: { readonly children: ReactNode }) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useDismiss(open, setOpen, root, toggle)
  const name = t('topbar.setup')

  return (
    <div className="setup" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="setup__toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={name}
        title={name}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {/* FEAT: fechado, o que é montagem sai do DOM: não recebe foco nem é lido */}
      {open && (
        <div className="setup__menu" id={id}>
          {children}
        </div>
      )}
    </div>
  )
}
