import { useEffect, type RefObject } from 'react'

// FEAT: um menu solto fecha no clique de fora e no Escape, devolvendo o foco a quem o abriu
export function useDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  root: RefObject<HTMLElement | null>,
  toggle: RefObject<HTMLButtonElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (root.current?.contains(document.activeElement)) toggle.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen, root, toggle])
}
