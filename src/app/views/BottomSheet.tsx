import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { formatVariable, formatYear } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { useSimulation } from '../sim/runtime.ts'
import { dragSheet, nextSheet, snapSheet } from './hud.ts'
import { hudStore, useSheet } from './hudStore.ts'

const PHONE = '(max-width: 900px)'
const TAP = 6

function matchesPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE).matches
}

export function usePhone(): boolean {
  const [phone, setPhone] = useState(matchesPhone)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PHONE)
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return phone
}

export function BottomSheet({
  available,
  notices,
  children,
}: {
  readonly available: number
  readonly notices: ReactNode
  readonly children: ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  const state = useSheet()
  const snapshot = useSimulation((s) => s.inspected ?? s.present)
  const sheetRef = useRef<HTMLDivElement>(null)
  const grab = useRef<{ readonly y: number; readonly height: number } | null>(null)
  const dragged = useRef(false)
  const [live, setLive] = useState<number | null>(null)

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    const node = sheetRef.current
    if (!node || (event.pointerType === 'mouse' && event.button !== 0)) return
    grab.current = { y: event.clientY, height: node.getBoundingClientRect().height }
    dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const from = grab.current
    if (!from) return
    const height = dragSheet(from.height + (from.y - event.clientY), available)
    if (Math.abs(height - from.height) > TAP) dragged.current = true
    setLive(height)
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!grab.current) return
    grab.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const height = live
    setLive(null)
    // FEAT: solto o arrasto, a folha assenta na altura mais próxima
    if (dragged.current && height !== null && available > 0) {
      hudStore.getState().setSheet(snapSheet(height / available))
    }
  }

  function cycle() {
    if (dragged.current) {
      dragged.current = false
      return
    }
    hudStore.getState().setSheet(nextSheet(state))
  }

  const name = t(`hud.sheet.${state}`)

  return (
    <footer className="hud hud--sheet">
      {notices}
      <div
        className="sheet"
        ref={sheetRef}
        data-state={state}
        data-dragging={live === null ? undefined : 'true'}
        style={live === null ? undefined : ({ height: `${live}px` } as CSSProperties)}
      >
        <div className="sheet__grip">
          <button
            type="button"
            className="sheet__handle"
            aria-expanded={state !== 'hidden'}
            aria-label={t('hud.sheet.toggle', { state: name })}
            onClick={cycle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <span className="sheet__bar" aria-hidden="true" />
            <span className="sheet__state">{name}</span>
          </button>
          {/* FEAT: escondida a folha, o essencial fica: o ano observado e duas medidas do mundo */}
          {state === 'hidden' && (
            <p className="sheet__essentials">
              <span className="sheet__year">
                <span className="sheet__label">{t('year.label')}</span>{' '}
                {formatYear(snapshot?.tick ?? 0)}
              </span>
              <span className="sheet__measure">
                <span className="sheet__label">{t('variable.population')}</span>{' '}
                {snapshot ? formatVariable('population', snapshot.values, locale) : '–'}
              </span>
              <span className="sheet__measure">
                <span className="sheet__label">{t('variable.stability')}</span>{' '}
                {snapshot ? formatVariable('stability', snapshot.values, locale) : '–'}
              </span>
            </p>
          )}
        </div>
        {/* FEAT: escondida, a folha devolve os cartões ao DOM só quando sobe */}
        {state !== 'hidden' && <div className="sheet__panels">{children}</div>}
      </div>
    </footer>
  )
}
