import type { Colony } from '../../engine/colony.ts'
import { system, type Body, type BodyKind } from '../../engine/system.ts'
import { bodyName, currentHome } from '../views/colonies.ts'
import { uniform } from '../../engine/rng.ts'

export interface PlacedBody {
  readonly index: number
  readonly kind: BodyKind
  // FEAT: distance é a órbita do motor; drawn é o raio em que a lente desenha esta mesma órbita
  readonly distance: number
  readonly drawn: number
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

export const STAR_RADIUS = 0.62

const RADIUS_BY_KIND: Readonly<Record<BodyKind, number>> = {
  rocky: 0.36,
  ice: 0.46,
  gas: 0.6,
}

export const CLEARANCE = 0.12

// FIX: estrela e disco não cabem na órbita mínima do motor; o desenho afasta o sistema inteiro
function liftOf(bodies: readonly Body[]): number {
  let lift = 0
  for (const body of bodies) {
    const needed = STAR_RADIUS + CLEARANCE + RADIUS_BY_KIND[body.kind] - body.distance
    if (needed > lift) lift = needed
  }
  return lift
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

  const generated = system(seed)
  const lift = liftOf(generated)
  const bodies = generated.map((body) => {
    const isLiving = body.index === living
    const isDead = body.home && !isLiving
    return {
      index: body.index,
      kind: body.kind,
      distance: body.distance,
      drawn: body.distance + lift,
      angle: angleOf(seed, body),
      radius: RADIUS_BY_KIND[body.kind],
      name: bodyName(seed, body.index),
      natal: body.home,
      living: isLiving,
      dead: isDead,
      colony: colonyByBody.get(body.index) ?? null,
    }
  })

  const far = Math.max(...bodies.map((body) => body.drawn))
  const outerRadius = Math.max(...bodies.map((body) => body.radius))
  const span = far + outerRadius

  return { bodies, home: living, span }
}

// FEAT: a chave de i18n que descreve o corpo — a distinção sem cor mora nas palavras, não no brilho
export function bodyLabelKey(
  body: PlacedBody,
): 'system.home' | 'system.dead' | 'system.colony' | 'system.natal' | 'system.empty' {
  if (body.living) return body.natal ? 'system.natal' : 'system.home'
  if (body.dead) return 'system.dead'
  return body.colony ? 'system.colony' : 'system.empty'
}
