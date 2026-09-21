import { openDB, type IDBPDatabase } from 'idb'
import { isValidMultiverse, type MultiverseLink } from './link.ts'

export interface SavedWorld {
  readonly id: string
  readonly name: string
  readonly link: MultiverseLink
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
  return isValidMultiverse(link)
    ? { id: world.id, name: world.name, savedAt: world.savedAt, link }
    : null
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
