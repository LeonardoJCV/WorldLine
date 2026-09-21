import { MODEL_VERSION } from '../../engine/params.ts'
import { decodeLink, type WorldLink } from './link.ts'
import { seedFromText } from './seed.ts'

export type Route =
  { readonly screen: 'genesis' } | { readonly screen: 'observatory'; readonly link: WorldLink }

export function parseRoute(hash: string, search: string): Route {
  const match = /^#\/w\/([A-Za-z0-9_-]+)$/.exec(hash)
  const fromHash = match ? decodeLink(match[1] ?? '') : null
  if (fromHash) return { screen: 'observatory', link: fromHash }
  const text = new URLSearchParams(search).get('seed')
  const seed = text === null ? null : seedFromText(text)
  if (seed !== null) {
    return { screen: 'observatory', link: { version: MODEL_VERSION, seed, tick: 0, decisions: [] } }
  }
  return { screen: 'genesis' }
}
