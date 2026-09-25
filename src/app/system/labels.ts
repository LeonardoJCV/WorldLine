export interface LabelBox {
  readonly index: number
  // FEAT: x é o centro pedido pela projeção e y o topo pedido; a moldura pode recusar os dois
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly visible: boolean
}

export interface LabelFrame {
  readonly width: number
  readonly height: number
  readonly gutter: number
  readonly floor: number
}

export interface LabelSpot {
  readonly index: number
  readonly left: number
  readonly top: number
  readonly visible: boolean
}

interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const ROW_GAP = 2
const ROWS = 8

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

// FEAT: desce uma fileira, sobe uma fileira, e assim por diante — a primeira livre fica com o rótulo
function freeTop(
  rect: Rect,
  wanted: number,
  limit: readonly [number, number],
  taken: readonly Rect[],
): number {
  const step = rect.height + ROW_GAP
  for (let away = 0; away <= ROWS; away++) {
    for (const sign of away === 0 ? [0] : [1, -1]) {
      const top = Math.min(Math.max(wanted + sign * away * step, limit[0]), limit[1])
      if (!taken.some((other) => overlaps({ ...rect, top }, other))) return top
    }
  }
  return wanted
}

// FEAT: nenhum rótulo sai da moldura, entra na faixa do minimapa nem cobre outro rótulo
export function layoutLabels(boxes: readonly LabelBox[], frame: LabelFrame): readonly LabelSpot[] {
  const order = [...boxes].sort((a, b) => a.y - b.y || a.index - b.index)
  const taken: Rect[] = []
  const spots: LabelSpot[] = []

  for (const box of order) {
    if (!box.visible) {
      spots.push({ index: box.index, left: box.x, top: box.y, visible: false })
      continue
    }
    const maxLeft = Math.max(frame.gutter, frame.width - frame.gutter - box.width)
    const left = Math.min(Math.max(box.x - box.width / 2, frame.gutter), maxLeft)
    const maxTop = Math.max(frame.gutter, frame.height - frame.floor - box.height)
    const wanted = Math.min(Math.max(box.y, frame.gutter), maxTop)
    const rect: Rect = { left, top: wanted, width: box.width, height: box.height }
    const top = freeTop(rect, wanted, [frame.gutter, maxTop], taken)
    taken.push({ ...rect, top })
    spots.push({ index: box.index, left, top, visible: true })
  }

  return spots
}
