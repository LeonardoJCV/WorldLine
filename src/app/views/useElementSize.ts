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
