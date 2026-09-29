import { useEffect, useState } from 'react'

export interface Size {
  readonly width: number
  readonly height: number
}

// FIX: mede o nó que a referência de retorno entrega, e não um guardado uma vez: assim um remonte volta a ser medido
export function useElementSize(element: HTMLElement | null): Size | null {
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      setSize((previous) =>
        previous && previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return size
}

export interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function same(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom
}

// FEAT: o retângulo de um nó nas coordenadas de outro, remedido sempre que um dos dois muda de tamanho
export function useRelativeRect(
  element: HTMLElement | null,
  origin: HTMLElement | null,
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!element || !origin) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      const base = origin.getBoundingClientRect()
      const next: Rect = {
        left: box.left - base.left,
        right: box.right - base.left,
        top: box.top - base.top,
        bottom: box.bottom - base.top,
      }
      setRect((previous) => (previous && same(previous, next) ? previous : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(origin)
    return () => observer.disconnect()
  }, [element, origin])

  // FIX: sem os dois nós não há retângulo a devolver, e o medido antes já não vale
  return element && origin ? rect : null
}
