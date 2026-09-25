import { selfSufficient, type Colony } from '../../engine/colony.ts'
import type { EventRecord } from '../../engine/events.ts'
import { system } from '../../engine/system.ts'
import { cityName } from '../surface/names.ts'

export interface ColonyView {
  readonly count: number
  readonly leader: {
    readonly body: string
    readonly self: boolean
  } | null
}

// FEAT: salt fora da faixa que cityNames() percorre em colisão, para o nome de um corpo não mudar
// quando uma cidade nova entra na disputa; o alfabeto é o mesmo, então a coincidência ainda cabe
const BODY_SALT = 4096

function bodyNames(seed: number, count: number): readonly string[] {
  const used = new Set<string>()
  const names: string[] = []
  for (let index = 0; index < count; index++) {
    let salt = BODY_SALT
    let name = cityName(seed, index, salt)
    while (used.has(name)) name = cityName(seed, index, ++salt)
    used.add(name)
    names.push(name)
  }
  return names
}

export function bodyName(seed: number, body: number): string {
  const names = bodyNames(seed, system(seed).length)
  return names[body] ?? cityName(seed, body, BODY_SALT)
}

// FEAT: o corpo natal é o que o próprio sistema marca como lar, não uma posição adivinhada aqui
export function homeBody(seed: number): number {
  return system(seed).find((body) => body.home)?.index ?? 0
}

// FEAT: resolve o lar de Snapshot.home — null cai no corpo natal, um índice devolve ele mesmo
export function currentHome(seed: number, home: number | null): number {
  return home ?? homeBody(seed)
}

export interface InheritanceView {
  readonly year: number
  readonly body: string
  readonly home: string
  readonly people: number
}

export function lastInheritance(events: readonly EventRecord[]): EventRecord | null {
  let last: EventRecord | null = null
  for (const record of events) {
    if (record.event !== 'inheritance') continue
    if (last === null || record.start > last.start) last = record
  }
  return last
}

// FEAT: o herdeiro se acha pelo ponteiro que o motor gravou — a herança aponta para a fundação e a
// colônia carrega o índice desse mesmo registro; a tela não repete a regra que escolheu o herdeiro
export function inheritanceHeir(
  record: EventRecord,
  events: readonly EventRecord[],
  seen: readonly Colony[],
): Colony | null {
  for (const cause of record.causes) {
    if (cause.kind !== 'event') continue
    if (events[cause.record]?.event !== 'colony_founded') continue
    const colony = seen.find((candidate) => candidate.record === cause.record)
    if (colony) return colony
  }
  return null
}

export function inheritanceView(
  record: EventRecord,
  heir: Colony,
  seed: number,
  home: number,
): InheritanceView {
  return {
    year: record.start,
    body: bodyName(seed, heir.body),
    home: bodyName(seed, home),
    people: heir.population,
  }
}

// FEAT: a distância até a autossuficiência usa o próprio campo que a mede — support — sem repetir
// o limiar que só a regra do motor conhece
function closer(a: Colony, b: Colony): boolean {
  if (a.support !== b.support) return a.support > b.support
  if (a.population !== b.population) return a.population > b.population
  return a.body < b.body
}

function leaderOf(colonies: readonly Colony[]): Colony | null {
  let best: Colony | null = null
  for (const colony of colonies) {
    if (best === null || closer(colony, best)) best = colony
  }
  return best
}

export function colonyView(colonies: readonly Colony[], seed: number): ColonyView | null {
  if (colonies.length === 0) return null
  const leader = leaderOf(colonies)
  if (leader === null) return null
  return {
    count: colonies.length,
    leader: {
      body: bodyName(seed, leader.body),
      self: selfSufficient(leader),
    },
  }
}
