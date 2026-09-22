import { MODEL_VERSION } from '../../engine/params.ts'
import type { Lens } from '../surface/lens.ts'
import { decodeLink, decodeMultiverse, toMultiverse, type MultiverseLink } from './link.ts'
import { seedFromText } from './seed.ts'

export type Route =
  | { readonly screen: 'genesis' }
  | { readonly screen: 'observatory'; readonly link: MultiverseLink; readonly lens: Lens }

export function parseRoute(hash: string, search: string): Route {
  const tree = /^#\/m\/([A-Za-z0-9_-]+)(\/planet)?$/.exec(hash)
  const fromTree = tree ? decodeMultiverse(tree[1] ?? '') : null
  if (fromTree)
    return { screen: 'observatory', link: fromTree, lens: tree?.[2] ? 'planet' : 'current' }
  const single = /^#\/w\/([A-Za-z0-9_-]+)(\/planet)?$/.exec(hash)
  const fromSingle = single ? decodeLink(single[1] ?? '') : null
  if (fromSingle) {
    return {
      screen: 'observatory',
      link: toMultiverse(fromSingle),
      lens: single?.[2] ? 'planet' : 'current',
    }
  }
  const text = new URLSearchParams(search).get('seed')
  const seed = text === null ? null : seedFromText(text)
  if (seed !== null) {
    return {
      screen: 'observatory',
      link: { version: MODEL_VERSION, seed, tick: 0, decisions: [], branches: [] },
      lens: 'current',
    }
  }
  return { screen: 'genesis' }
}
