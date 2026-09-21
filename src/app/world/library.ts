import { openDB, type IDBPDatabase } from 'idb'
import { isValidLink, type WorldLink } from './link.ts'

export interface SavedWorld {
  readonly id: string
  readonly name: string
  readonly link: WorldLink
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

function isSavedWorld(value: unknown): value is SavedWorld {
  if (typeof value !== 'object' || value === null) return false
  const world = value as Partial<SavedWorld>
  return (
    typeof world.id === 'string' &&
    typeof world.name === 'string' &&
    typeof world.savedAt === 'number' &&
    typeof world.link === 'object' &&
    world.link !== null &&
    isValidLink(world.link)
  )
}

export async function listWorlds(): Promise<SavedWorld[]> {
  const all: unknown[] = await (await connect()).getAll(STORE)
  return all.filter(isSavedWorld).sort((a, b) => b.savedAt - a.savedAt)
}

export async function saveWorld(world: SavedWorld): Promise<void> {
  await (await connect()).put(STORE, world)
}

export async function removeWorld(id: string): Promise<void> {
  await (await connect()).delete(STORE, id)
}
