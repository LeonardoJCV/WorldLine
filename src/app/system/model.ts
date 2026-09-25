import type { Colony } from '../../engine/colony.ts'
import { system, type Body, type BodyKind } from '../../engine/system.ts'
import { bodyName, currentHome } from '../views/colonies.ts'
import { uniform } from '../../engine/rng.ts'

export interface PlacedBody {
  readonly index: number
  readonly kind: BodyKind
  // FEAT: do motor, em unidades de órbita relativas à estrela
  readonly distance: number
  readonly angle: number
  readonly radius: number
  readonly name: string
  // FEAT: onde a civilização nasceu (Body.home), que é coisa diferente de onde ela mora hoje
  readonly natal: boolean
  readonly living: boolean
  readonly dead: boolean
  readonly colony: Colony | null
}

export interface SystemPlacement {
  readonly bodies: readonly PlacedBody[]
  readonly home: number
  readonly span: number
}

// FEAT: reserva de canal visual desta cena; 0..3 são da colocação (aqui), 4..15 são da paleta (Tarefa 5)
export const SYSTEM_CHANNEL = 8192
export const STRIDE = 16

// FEAT: raio de desenho por tipo, não do motor — um gasoso é maior que um rochoso
const RADIUS_BY_KIND: Readonly<Record<BodyKind, number>> = {
  rocky: 0.4,
  ice: 0.5,
  gas: 0.9,
}

function angleOf(seed: number, body: Body): number {
  return uniform(seed, 0, SYSTEM_CHANNEL + body.index * STRIDE) * Math.PI * 2
}

export function systemPlacement(
  seed: number,
  home: number | null,
  colonies: readonly Colony[],
): SystemPlacement {
  const living = currentHome(seed, home)
  const colonyByBody = new Map(colonies.map((colony) => [colony.body, colony] as const))

  const bodies = system(seed).map((body) => {
    const isLiving = body.index === living
    // FEAT: natal e não vivo hoje — corpo do meio numa cadeia não é conhecível, só natal e atual
    const isDead = body.home && !isLiving
    return {
      index: body.index,
      kind: body.kind,
      distance: body.distance,
      angle: angleOf(seed, body),
      radius: RADIUS_BY_KIND[body.kind],
      name: bodyName(seed, body.index),
      natal: body.home,
      living: isLiving,
      dead: isDead,
      colony: colonyByBody.get(body.index) ?? null,
    }
  })

  // FEAT: span é o raio que a câmera precisa enquadrar — órbita mais distante mais o próprio disco
  const far = Math.max(...bodies.map((body) => body.distance))
  const outerRadius = Math.max(...bodies.map((body) => body.radius))
  const span = far + outerRadius

  return { bodies, home: living, span }
}
