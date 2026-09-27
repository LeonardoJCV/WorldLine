import { describe, expect, it } from 'vitest'
import { ROCKET } from '../engine/colony.ts'
import {
  GOLDEN_CASES,
  GOLDEN_SCRIPTS,
  INHERITANCE_CASE,
  MERGE_CASE,
  WORKS_CASE,
  goldenWorld,
  mergeSeam,
} from '../engine/golden.ts'
import { hashState } from '../engine/hash.ts'
import { CAUSAL_WINDOW, CHECKPOINT_INTERVAL } from '../engine/params.ts'
import { WORKS } from '../engine/work.ts'
import { Worldline } from '../engine/worldline.ts'
import {
  COLLAPSE_CASE,
  COLLAPSE_CROSSINGS,
  COLLAPSE_DECISIONS,
  runCollapseCheck,
  runGoldenChecks,
  runInheritanceCheck,
  runMergeCheck,
  runWorksCheck,
} from './check.ts'

describe('runGoldenChecks', () => {
  it('reproduces every reference fingerprint', () => {
    const results = runGoldenChecks()
    expect(results).toHaveLength(GOLDEN_CASES.length)
    expect(results.filter((result) => !result.ok)).toEqual([])
  })
})

describe('runCollapseCheck', () => {
  it('reaches a collapse and reproduces its fingerprint', () => {
    const result = runCollapseCheck()
    expect(result.status).toBe('collapsed')
    expect(result.reached).toBe(result.year)
    expect(result.ok).toBe(true)
  })

  it('names the crossing that opened the debt, decades after the window would have closed', () => {
    const world = new Worldline(COLLAPSE_CASE.seed, COLLAPSE_DECISIONS, null, COLLAPSE_CROSSINGS)
    world.advance(COLLAPSE_CASE.year)
    const gift = COLLAPSE_CROSSINGS[0]
    const paradox = world.records.find((record) => record.event === 'paradox')
    expect(paradox).toBeDefined()
    expect((paradox?.start ?? 0) - (gift?.tick ?? 0)).toBeGreaterThan(CAUSAL_WINDOW)
    expect(paradox?.causes).toContainEqual({
      kind: 'crossing',
      tick: gift?.tick,
      crossing: gift?.kind,
    })
  })
})

describe('runInheritanceCheck', () => {
  it('reaches the inheritance and reproduces its fingerprint', () => {
    const result = runInheritanceCheck()
    expect(result.status).toBe('running')
    expect(result.moved).toBe(INHERITANCE_CASE.ended)
    expect(result.settled).toBe(INHERITANCE_CASE.founded)
    expect(result.home).not.toBeNull()
    expect(result.computed).toBe(INHERITANCE_CASE.hash)
    expect(result.ok).toBe(true)
  })

  it('proves the history changed home instead of ending', () => {
    // FEAT: o ano da queda vem antes do primeiro ano na casa nova, e a fundação vem antes dos dois
    expect(INHERITANCE_CASE.founded).toBeLessThan(INHERITANCE_CASE.ended)
    expect(INHERITANCE_CASE.ended).toBeLessThan(INHERITANCE_CASE.year)
  })
})

describe('runMergeCheck', () => {
  it('seams two histories into one and reproduces the fingerprint of the one that received', () => {
    const result = runMergeCheck()
    expect(result.status).toBe('running')
    expect(result.away).toBe('merged')
    expect(result.seam).toBe(MERGE_CASE.tick)
    expect(result.lived).toBe(0)
    expect(result.settled).toBe(true)
    expect(result.computed).toBe(MERGE_CASE.hash)
    expect(result.ok).toBe(true)
  })

  it('keeps the years of the case consistent, the seam before the year that is pinned', () => {
    expect(MERGE_CASE.tick).toBeLessThan(MERGE_CASE.year)
    expect(MERGE_CASE.script).not.toBe(MERGE_CASE.other)
  })

  it('keeps every published fingerprint distinct, all eighteen of them', () => {
    // FEAT: dois casos com o mesmo hash seriam duas provas valendo uma; o Set pega a colisão
    const published = [
      ...GOLDEN_CASES.map((golden) => golden.hash),
      COLLAPSE_CASE.hash,
      INHERITANCE_CASE.hash,
      MERGE_CASE.hash,
      WORKS_CASE.hash,
    ]
    expect(published).toHaveLength(18)
    expect(new Set(published).size).toBe(18)
  })
})

describe('runWorksCheck', () => {
  it('reaches the year with works standing and one under way, and reproduces its fingerprint', () => {
    const result = runWorksCheck()
    expect(result.status).toBe('running')
    expect(result.finished).toBe(WORKS_CASE.done)
    expect(result.site).toBe(WORKS_CASE.under)
    expect(result.computed).toBe(WORKS_CASE.hash)
    expect(result.ok).toBe(true)
  })

  // FEAT: o caso existe para fixar os dois blocos condicionais que os dezessete deixam vazios, e
  // para fixá-los num mundo comum: nada chegou de fora, ninguém costurou, nenhuma colônia
  it('pins the two blocks the other seventeen leave empty, in a history with nothing else in it', () => {
    const plan = GOLDEN_SCRIPTS[WORKS_CASE.script]
    const world = goldenWorld(WORKS_CASE.seed, plan)
    world.advance(WORKS_CASE.year)
    const present = world.present
    expect(present.works.length).toBeGreaterThan(0)
    expect(present.building).not.toBeNull()
    expect(present.colonies).toEqual([])
    expect(present.home).toBeNull()
    expect(present.lastMerge).toBeNull()
    expect(present.debts).toEqual([])
    expect(present.paradox).toBeNull()
    expect(present.echoes).toEqual([])
    expect(present.lastCrossing).toBeNull()
    expect(world.hashAt(WORKS_CASE.year)).toBe(WORKS_CASE.hash)
    // FEAT: sem os dois blocos o mesmo estado dá outro hash, e é isso que prova que o valor
    // publicado carrega as obras em vez de apenas coexistir com elas
    expect(hashState({ ...present, works: [], building: null })).not.toBe(WORKS_CASE.hash)
  })

  // FEAT: as dezoito verificações param no ano fixado, e ali `stateAt` devolve o presente sem
  // reviver nada; aqui o ano fixado é revivido do checkpoint, com duas comissões na mesma janela
  it('reproduces the pinned year by reliving it from the checkpoint, not by standing on it', () => {
    const plan = GOLDEN_SCRIPTS[WORKS_CASE.script]
    const world = goldenWorld(WORKS_CASE.seed, plan)
    world.advance(WORKS_CASE.year + CHECKPOINT_INTERVAL)
    expect(world.present.tick).toBeGreaterThan(WORKS_CASE.year)
    // FEAT: uma comissão por janela nunca separa o cursor do replay do cursor do ano corrido, então
    // a guarda vale só enquanto o roteiro tiver duas dentro da janela do ano fixado
    const base = WORKS_CASE.year - (WORKS_CASE.year % CHECKPOINT_INTERVAL)
    const window = plan.commissions.filter(
      (ordered) => ordered.tick >= base && ordered.tick <= WORKS_CASE.year,
    )
    expect(window.length).toBeGreaterThan(1)
    expect(world.hashAt(WORKS_CASE.year)).toBe(WORKS_CASE.hash)
  })

  it('stands every work the script ordered except the one it left on the site', () => {
    const plan = GOLDEN_SCRIPTS[WORKS_CASE.script]
    const world = goldenWorld(WORKS_CASE.seed, plan)
    world.advance(WORKS_CASE.year)
    const standing = new Set(world.present.works.map((done) => WORKS[done.def]?.id))
    const ordered = plan.commissions
    expect(ordered.at(-1)?.work).toBe(WORKS_CASE.under)
    expect(ordered.slice(0, -1).filter((commission) => !standing.has(commission.work))).toEqual([])
    expect(standing.has(WORKS_CASE.under)).toBe(false)
    expect(WORKS[world.present.building?.def ?? -1]?.id).toBe(WORKS_CASE.under)
  })
})

describe('the works the reference histories build, and the ones they never do', () => {
  // FEAT: dezesseis dos dezoito não comissionam nada, então têm de sair com a obra vazia — os
  // catorze, o colapso e as DUAS histórias da confluência; as que constroem são a herança, porque sem
  // o foguete pronto ela não colonizaria, e o décimo-oitavo caso, que existe só para isso
  const idle = (world: Worldline) => {
    expect(world.present.works).toEqual([])
    expect(world.present.building).toBeNull()
  }

  it('leaves the sixteen grounded fingerprints alone, with no work done and none under way', () => {
    for (const { seed, script, year, hash } of GOLDEN_CASES) {
      const plan = GOLDEN_SCRIPTS[script]
      expect(plan.commissions, script).toEqual([])
      const world = goldenWorld(seed, plan)
      world.advance(year)
      idle(world)
      expect(world.hashAt(year)).toBe(hash)
    }

    const collapsing = new Worldline(
      COLLAPSE_CASE.seed,
      COLLAPSE_DECISIONS,
      null,
      COLLAPSE_CROSSINGS,
    )
    collapsing.advance(COLLAPSE_CASE.year)
    idle(collapsing)
    expect(collapsing.hashAt(COLLAPSE_CASE.year)).toBe(COLLAPSE_CASE.hash)

    const host = GOLDEN_SCRIPTS[MERGE_CASE.script]
    const guest = GOLDEN_SCRIPTS[MERGE_CASE.other]
    const receives = goldenWorld(MERGE_CASE.seed, host)
    const departs = goldenWorld(MERGE_CASE.seed, guest)
    receives.advance(MERGE_CASE.tick)
    departs.advance(MERGE_CASE.tick)
    receives.merge(mergeSeam(departs.present).receives)
    receives.advance(MERGE_CASE.year - MERGE_CASE.tick)
    idle(receives)
    idle(departs)
    expect(receives.hashAt(MERGE_CASE.year)).toBe(MERGE_CASE.hash)
  })

  // FEAT: o portão é a obra, não a era: a herança comissiona a subida inteira, e o foguete fecha
  // antes da fundação da colônia que acabou salvando a história
  it('builds the whole climb on the history that outlived its world, rocket before colony', () => {
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const heir = goldenWorld(INHERITANCE_CASE.seed, plan)
    heir.advance(INHERITANCE_CASE.year)
    expect(heir.present.works).toHaveLength(WORKS.length)
    // FEAT: uma comissão num ano de canteiro ocupado substitui a obra em curso e joga fora o
    // progresso dela, então a guarda é que toda obra encomendada esteja de pé, não quantas estão
    const standing = new Set(heir.present.works.map((done) => WORKS[done.def]?.id))
    expect(plan.commissions.filter((ordered) => !standing.has(ordered.work))).toEqual([])
    const rocket = heir.present.works.find((work) => work.def === ROCKET)
    expect(rocket?.done).toBeLessThan(INHERITANCE_CASE.founded)
    expect(heir.hashAt(INHERITANCE_CASE.year)).toBe(INHERITANCE_CASE.hash)
  })

  // FEAT: o recibo carrega as obras da que deságua, e é por isso que a costura pode uni-las; com os
  // roteiros de referência ela carrega uma lista vazia, e é por isso que o hash da confluência parou
  it('stamps the works of the departing history on the receipt, empty or not', () => {
    const guest = GOLDEN_SCRIPTS[MERGE_CASE.other]
    const departs = goldenWorld(MERGE_CASE.seed, guest)
    departs.advance(MERGE_CASE.tick)
    expect(mergeSeam(departs.present).receives.works).toEqual([])

    const built = [{ def: 0, done: 300, record: 2 }]
    expect(mergeSeam({ ...departs.present, works: built }).receives.works).toEqual(built)
  })
})
