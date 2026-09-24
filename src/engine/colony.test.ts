import { describe, expect, it } from 'vitest'
import {
  SPACE_ERA,
  colonyCost,
  foundColony,
  heir,
  inherit,
  selfSufficient,
  tickColonies,
  type Colony,
  type ColonisingWorld,
} from './colony.ts'
import {
  COLONY_CAPACITY,
  COLONY_FLOOR,
  COLONY_GROWTH,
  COLONY_HOLD,
  COLONY_INTAKE,
  COLONY_MIGRATION,
  COLONY_SEED_POP,
  COLONY_SELF,
  COLONY_START_POP,
  COLONY_SUPPORT_RATE,
  COLONY_UPKEEP,
  GENESIS_FOOD_RESERVE,
  INHERIT_ECONOMY,
  INHERIT_ENERGY,
  INHERIT_ENVIRONMENT,
  INHERIT_SHOCK,
} from './params.ts'
import type { Body, BodyKind } from './system.ts'
import { makeState } from './testing.ts'

function body(index: number, kind: BodyKind, habitability: number, home = false): Body {
  return { index, kind, distance: 1 + index, habitability, home }
}

// FEAT: o corpo 3 é o melhor destino livre, o 2 vem depois e o 1 nunca serve
const BODIES: readonly Body[] = [
  body(0, 'rocky', 0.95, true),
  body(1, 'gas', 0, false),
  body(2, 'rocky', 0.5),
  body(3, 'ice', 0.7),
  body(4, 'rocky', 0.2),
]
// FEAT: o corpo 1 quase não dá sustento nenhum, mas ainda comporta gente
const BARREN: readonly Body[] = [body(0, 'rocky', 0.95, true), body(1, 'ice', 0.05)]

function world(overrides: Partial<ColonisingWorld> = {}): ColonisingWorld {
  return { eras: SPACE_ERA, energy: 14, population: 1e6, colonies: [], home: null, ...overrides }
}

function colony(overrides: Partial<Colony> = {}): Colony {
  return { body: 3, founded: 0, population: 1000, support: 0, record: 0, ...overrides }
}

describe('foundColony', () => {
  it('founds nothing before the space era', () => {
    expect(foundColony(world({ eras: 0 }), BODIES, 2400, 7)).toBeNull()
    expect(foundColony(world({ eras: 1 | 2 | 4 }), BODIES, 2400, 7)).toBeNull()
  })

  it('founds nothing without energy to spare', () => {
    expect(foundColony(world({ energy: 9 }), BODIES, 2400, 7)).toBeNull()
    expect(foundColony(world({ energy: 9.9 }), BODIES, 2400, 7)).toBeNull()
    expect(foundColony(world({ energy: 10 }), BODIES, 2400, 7)).not.toBeNull()
  })

  it('counts the colonies it already keeps before spending on another', () => {
    const kept = [colony({ body: 3, support: 0 })]
    // FEAT: a energia livre é 1, e o que já existe cobra meia unidade dela
    expect(foundColony(world({ energy: 10, colonies: kept }), BODIES, 2400, 7)).toBeNull()
    expect(foundColony(world({ energy: 11, colonies: kept }), BODIES, 2400, 7)?.body).toBe(2)
  })

  it('does not count a colony that pays its own way', () => {
    const kept = (support: number) => [colony({ body: 2, support })]
    expect(foundColony(world({ energy: 10, colonies: kept(0) }), BODIES, 2400, 7)).toBeNull()
    expect(foundColony(world({ energy: 10, colonies: kept(1) }), BODIES, 2400, 7)?.body).toBe(3)
  })

  it('founds nothing on a body the surplus could never support', () => {
    // FEAT: com excedente 1 partido em dois, o corpo 2 promete menos do que o ponto de apoio
    expect(
      foundColony(world({ energy: 10, colonies: [colony({ body: 3 })] }), BODIES, 2400, 7),
    ).toBe(null)
    expect(
      foundColony(world({ energy: 14, colonies: [colony({ body: 3 })] }), BODIES, 2400, 7)?.body,
    ).toBe(2)
  })

  it('founds nothing on a body that could not hold the first crew', () => {
    const roomless: readonly Body[] = [
      body(0, 'rocky', 0.95, true),
      body(1, 'rocky', COLONY_START_POP / COLONY_CAPACITY / 2),
    ]
    expect(foundColony(world({ energy: 1000 }), roomless, 2400, 7)).toBeNull()
  })

  it('picks the free colonisable body with the highest habitability', () => {
    expect(foundColony(world(), BODIES, 2400, 7)?.body).toBe(3)
    expect(foundColony(world({ colonies: [colony({ body: 3 })] }), BODIES, 2400, 7)?.body).toBe(2)
    expect(
      foundColony(
        world({ energy: 16, colonies: [colony({ body: 3 }), colony({ body: 2 })] }),
        BODIES,
        2400,
        7,
      )?.body,
    ).toBe(4)
  })

  it('never picks the body the history lives on today', () => {
    // FEAT: depois de uma herança o lar não é mais o corpo natal, e o novo lar não é destino
    expect(foundColony(world({ home: 3 }), BODIES, 2400, 7)?.body).toBe(2)
    expect(
      foundColony(world({ home: 2, colonies: [colony({ body: 3 })] }), BODIES, 2400, 7)?.body,
    ).toBe(4)
  })

  it('never picks a gas giant, the home world or a taken body', () => {
    const full = [colony({ body: 2 }), colony({ body: 3 }), colony({ body: 4 })]
    expect(foundColony(world({ energy: 1000, colonies: full }), BODIES, 2400, 7)).toBeNull()
  })

  it('founds one at a time, with the year and the first crew', () => {
    const first = foundColony(world({ energy: 1000 }), BODIES, 2400, 7)
    expect(first).toEqual({
      body: 3,
      founded: 2400,
      population: COLONY_START_POP,
      support: 0,
      record: 7,
    })
    const second = foundColony(
      world({ energy: 1000, colonies: [first as Colony] }),
      BODIES,
      2401,
      8,
    )
    expect(second).toEqual({
      body: 2,
      founded: 2401,
      population: COLONY_START_POP,
      support: 0,
      record: 8,
    })
  })
})

describe('tickColonies', () => {
  it('leaves an empty sky alone', () => {
    expect(tickColonies([], world(), BODIES)).toEqual({ colonies: [], migrated: 0 })
  })

  it('grows support out of the world surplus and the body', () => {
    // FEAT: excedente 4, uma colônia, sustento possível 1: o passo é uma fração do caminho
    const { colonies } = tickColonies([colony()], world({ energy: 13 }), BODIES)
    expect(colonies[0]?.support).toBeCloseTo(COLONY_SUPPORT_RATE, 12)
  })

  it('grows support faster on a better body', () => {
    const poor = tickColonies([colony({ body: 4 })], world({ energy: 10 }), BODIES)
    const rich = tickColonies([colony({ body: 3 })], world({ energy: 10 }), BODIES)
    expect(rich.colonies[0]?.support).toBeGreaterThan(poor.colonies[0]?.support ?? 1)
  })

  it('grows support faster with more energy to spare', () => {
    const lean = tickColonies([colony()], world({ energy: 9.5 }), BODIES)
    const fat = tickColonies([colony()], world({ energy: 13 }), BODIES)
    expect(fat.colonies[0]?.support).toBeGreaterThan(lean.colonies[0]?.support ?? 1)
  })

  it('splits the surplus between the colonies it already has', () => {
    const alone = tickColonies([colony()], world({ energy: 11 }), BODIES)
    const shared = tickColonies([colony(), colony({ body: 2 })], world({ energy: 11 }), BODIES)
    expect(shared.colonies[0]?.support).toBeLessThan(alone.colonies[0]?.support ?? 0)
  })

  it('lets support decay when the home world shrinks', () => {
    const grown = colony({ body: 4, support: 0.6, population: 5e4 })
    const { colonies } = tickColonies([grown], world({ energy: 9 }), BODIES)
    expect(colonies[0]?.support).toBeLessThan(0.6)
  })

  it('keeps support inside [0,1] however the world swings', () => {
    let colonies: readonly Colony[] = [colony({ body: 3, population: 1e6 })]
    for (let year = 0; year < 400; year++) {
      const energy = year % 2 === 0 ? 1e6 : 0
      colonies = tickColonies(colonies, world({ energy, population: 1e9 }), BODIES).colonies
      for (const c of colonies) {
        expect(c.support).toBeGreaterThanOrEqual(0)
        expect(c.support).toBeLessThanOrEqual(1)
        expect(c.population).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('grows the population while support holds', () => {
    const held = colony({ body: 3, support: 1, population: 1000 })
    const { colonies } = tickColonies([held], world({ energy: 13 }), BODIES)
    // FEAT: 1000 × (1 + 0,05 × 0,6) de crescimento, mais 100 que chegaram
    expect(colonies[0]?.support).toBe(1)
    expect(colonies[0]?.population).toBeCloseTo(1030 + 100, 9)
  })

  it('shrinks the population when support fails', () => {
    const { colonies } = tickColonies([colony({ body: 1 })], world({ energy: 9 }), BARREN)
    const support = colonies[0]?.support ?? 1
    expect(support).toBeLessThan(0.01)
    expect(colonies[0]?.population).toBeCloseTo(
      1000 * (1 + COLONY_GROWTH * (support - COLONY_HOLD)),
      9,
    )
  })

  it('shrinks a colony that outgrew the body that holds it, and sends it no one', () => {
    const holds = COLONY_CAPACITY * 0.05
    const packed = colony({ body: 1, support: 1, population: 4 * holds })
    const { colonies, migrated } = tickColonies([packed], world({ energy: 1e4 }), BARREN)
    // FEAT: a lotação manda no ano, e o pior que ela faz é o ritmo inteiro
    expect(colonies[0]?.population).toBeCloseTo(4 * holds * (1 - COLONY_GROWTH), 9)
    expect(migrated).toBe(0)
  })

  it('never settles more people than the body holds, however big the home world is', () => {
    const holds = COLONY_CAPACITY * 0.05
    let colonies: readonly Colony[] = [colony({ body: 1, support: 1, population: 1000 })]
    for (let year = 0; year < 2000; year++) {
      colonies = tickColonies(colonies, world({ energy: 1e4, population: 5e7 }), BARREN).colonies
      expect(colonies[0]?.population).toBeLessThanOrEqual(holds)
    }
    // FEAT: e ela encosta no teto do corpo, não em qualquer número que o mundo natal decida
    expect(colonies[0]?.population).toBeGreaterThan(holds * 0.99)
  })

  it('loses a colony that falls below the floor, and never gets it back', () => {
    const dying = colony({ body: 1, population: 255 })
    const first = tickColonies([dying], world({ energy: 9 }), BARREN)
    expect(255 * (1 - COLONY_GROWTH * COLONY_HOLD)).toBeLessThan(COLONY_FLOOR)
    expect(first.colonies).toEqual([])
    // FEAT: a frota que sai do ano é a que o ano cobra, então a que morreu não cobra mais nada
    expect(colonyCost(first.colonies)).toBe(0)
    const second = tickColonies(first.colonies, world({ energy: 1e6 }), BARREN)
    expect(second.colonies).toEqual([])
  })

  it('charges energy while support is short and stops at one', () => {
    expect(colonyCost([colony({ support: 0 })])).toBeCloseTo(COLONY_UPKEEP, 12)
    expect(colonyCost([colony({ support: 0.5 })])).toBeCloseTo(COLONY_UPKEEP / 2, 12)
    expect(colonyCost([colony({ support: 1 })])).toBe(0)
    expect(colonyCost([colony({ support: 0 }), colony({ body: 2, support: 1 })])).toBeCloseTo(
      COLONY_UPKEEP,
      12,
    )
  })

  it('moves people out of the home world and loses none of them', () => {
    const steady: readonly Colony[] = [
      colony({ body: 1, support: 1, population: 1000 }),
      colony({ body: 1, support: 1, population: 2000 }),
    ]
    const total = (cs: readonly Colony[]) => cs.reduce((sum, c) => sum + c.population, 0)
    // FEAT: o mesmo ano com o mundo natal vazio: a diferença entre os dois é quem partiu
    const fed = tickColonies(steady, world({ energy: 30 }), BARREN)
    const alone = tickColonies(steady, world({ energy: 30, population: 0 }), BARREN)
    expect(fed.migrated).toBeCloseTo(COLONY_INTAKE * 3000, 9)
    expect(alone.migrated).toBe(0)
    expect(total(fed.colonies) - total(alone.colonies)).toBeCloseTo(fed.migrated, 9)
  })

  it('sends no one to a colony that is not growing', () => {
    const failing = [colony({ body: 1, support: COLONY_HOLD, population: 1000 })]
    const { colonies, migrated } = tickColonies(failing, world({ energy: 9 }), BARREN)
    expect(colonies[0]?.support).toBeLessThan(COLONY_HOLD)
    expect(migrated).toBe(0)
  })

  it('never sends more people than the home world has', () => {
    const big = [colony({ body: 3, support: 1, population: 1e6 })]
    const { migrated } = tickColonies(big, world({ energy: 14, population: 40 }), BODIES)
    expect(migrated).toBeLessThanOrEqual(40)
    expect(migrated).toBeCloseTo(COLONY_MIGRATION * 40, 12)
  })

  it('sends no one to a colony that is not there to receive them', () => {
    const dying = colony({ body: 1, population: 250, support: 0.05 })
    const { colonies, migrated } = tickColonies([dying], world({ energy: 9 }), BARREN)
    expect(colonies).toEqual([])
    expect(migrated).toBe(0)
  })

  it('caps what a young colony can take in', () => {
    const young = colony({ body: 3, support: 1, population: 1000 })
    const { migrated } = tickColonies([young], world({ energy: 14 }), BODIES)
    expect(migrated).toBeCloseTo(COLONY_INTAKE * 1000, 9)
    expect(migrated).toBeLessThan(COLONY_MIGRATION * 1e6)
  })
})

describe('selfSufficient', () => {
  it('needs both the support and the people', () => {
    expect(
      selfSufficient({
        body: 2,
        founded: 0,
        population: COLONY_SEED_POP,
        support: COLONY_SELF,
        record: 0,
      }),
    ).toBe(true)
    expect(
      selfSufficient({
        body: 2,
        founded: 0,
        population: COLONY_SEED_POP,
        support: COLONY_SELF - 0.01,
        record: 0,
      }),
    ).toBe(false)
    expect(
      selfSufficient({
        body: 2,
        founded: 0,
        population: COLONY_SEED_POP - 1,
        support: 1,
        record: 0,
      }),
    ).toBe(false)
    expect(selfSufficient(colony())).toBe(false)
  })
})

describe('heir', () => {
  const ready = (b: number, population: number): Colony => ({
    body: b,
    founded: 2400,
    population,
    support: COLONY_SELF,
    record: b,
  })

  it('has nothing to give without colonies', () => {
    expect(heir([])).toBeNull()
  })

  it('has nothing to give when no colony stands on its own', () => {
    expect(
      heir([colony({ population: 1e9 }), colony({ body: 2, support: 1, population: 10 })]),
    ).toBeNull()
  })

  it('gives the most populous colony that stands on its own', () => {
    const chosen = heir([
      ready(2, COLONY_SEED_POP * 2),
      colony({ body: 4, population: 1e9 }),
      ready(3, COLONY_SEED_POP * 5),
    ])
    expect(chosen?.body).toBe(3)
  })
})

describe('inherit', () => {
  const dead = makeState({
    technology: 87.5,
    environment: 92,
    stability: 70,
    population: 4e6,
    food: 9e5,
    energy: 13,
    economy: 9,
    eras: SPACE_ERA,
    colonies: [colony({ body: 3, population: 2e5, support: 1, record: 4 })],
    echoes: [{ target: 'technology', remaining: 3 }],
    debts: [{ kind: 'knowledge', owed: 30, since: 1950, origin: 'B' }],
    paradox: { kind: 'debt', since: 2030, deadline: 2230 },
    strain: 200,
    status: 'extinct',
  })
  const moved = inherit(
    dead,
    colony({ body: 3, population: 2e5, support: 1, record: 4 }),
    BODIES[3],
  )

  it('takes the people of the colony and the sky of its body', () => {
    expect(moved.population).toBe(2e5)
    expect(moved.environment).toBeCloseTo(INHERIT_ENVIRONMENT * 0.7, 9)
  })

  it('keeps the knowledge, because it does not die with a planet', () => {
    expect(moved.technology).toBe(dead.technology)
    expect(moved.eras).toBe(dead.eras)
    expect(moved.allocation).toEqual(dead.allocation)
  })

  it('restarts the stores small', () => {
    expect(moved.food).toBeCloseTo(2e5 * GENESIS_FOOD_RESERVE, 9)
    expect(moved.energy).toBe(INHERIT_ENERGY)
    expect(moved.economy).toBe(INHERIT_ECONOMY)
    expect(moved.recentEconomy).toEqual(dead.recentEconomy.map(() => INHERIT_ECONOMY))
  })

  it('shakes the stability without ever driving it out of range', () => {
    expect(moved.stability).toBeCloseTo(dead.stability - INHERIT_SHOCK, 9)
    expect(inherit({ ...dead, stability: 5 }, colony(), BODIES[3]).stability).toBe(0)
  })

  it('makes the heir body the new home and leaves the rest of the fleet behind', () => {
    expect(moved.home).toBe(3)
    expect(moved.colonies).toEqual([])
  })

  it('leaves the ledger and the contradiction with the world that died', () => {
    expect(moved.status).toBe('running')
    expect(moved.paradox).toBeNull()
    expect(moved.strain).toBe(0)
    expect(moved.debts).toEqual([])
    expect(moved.echoes).toEqual([])
  })

  it('never inherits a negative crowd, whatever it is handed', () => {
    expect(inherit(dead, colony({ population: -5 }), undefined).population).toBe(0)
    expect(inherit(dead, colony({ population: -5 }), undefined).environment).toBe(0)
  })
})
