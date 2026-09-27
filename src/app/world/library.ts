import { openDB, type IDBPDatabase } from 'idb'
import { isCompatibleVersion, isValidMultiverse, type MultiverseLink } from './link.ts'

export interface SavedWorld {
  readonly id: string
  readonly name: string
  // FEAT: null quando o registro é de um modelo anterior; a linha fica na lista só para ser apagada
  readonly link: MultiverseLink | null
  readonly savedAt: number
}

const STORE = 'worlds'
let database: Promise<IDBPDatabase> | null = null

function connect(): Promise<IDBPDatabase> {
  database ??= openDB('worldline', 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    },
  })
  return database
}

export function toSavedWorld(value: unknown): SavedWorld | null {
  if (typeof value !== 'object' || value === null) return null
  const world = value as Partial<SavedWorld> & { link?: unknown }
  if (typeof world.id !== 'string' || typeof world.name !== 'string') return null
  if (typeof world.savedAt !== 'number' || typeof world.link !== 'object' || world.link === null) {
    return null
  }
  const raw = world.link as Partial<MultiverseLink>
  const link = { ...raw, branches: raw.branches ?? [] } as MultiverseLink
  const named = { id: world.id, name: world.name, savedAt: world.savedAt }
  // FIX: um registro de modelo anterior era descartado aqui e ficava no banco sem quem o apagasse
  if (!isCompatibleVersion(link.version)) return { ...named, link: null }
  return isValidMultiverse(link) ? { ...named, link } : null
}

export async function listWorlds(): Promise<SavedWorld[]> {
  const all: unknown[] = await (await connect()).getAll(STORE)
  return all
    .map(toSavedWorld)
    .filter((world): world is SavedWorld => world !== null)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export async function saveWorld(world: SavedWorld): Promise<void> {
  await (await connect()).put(STORE, world)
}

export async function removeWorld(id: string): Promise<void> {
  await (await connect()).delete(STORE, id)
}
