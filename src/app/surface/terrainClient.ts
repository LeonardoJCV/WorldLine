import type { ChunkMesh } from './chunk.ts'
import { createTerrainHandler, type TerrainReply, type TerrainRequest } from './terrainWorker.ts'

export interface TerrainMap {
  readonly width: number
  readonly height: number
  readonly data: Float32Array
}

export interface TerrainPort {
  send(request: TerrainRequest): void
  listen(handler: (reply: TerrainReply) => void): void
}

export function workerTerrainPort(worker: Worker): TerrainPort {
  return {
    send: (request) => worker.postMessage(request),
    listen: (handler) => {
      worker.onmessage = (event: MessageEvent<TerrainReply>) => handler(event.data)
    },
  }
}

export function inProcessTerrainPort(): TerrainPort {
  const handle = createTerrainHandler()
  let listener: ((reply: TerrainReply) => void) | null = null
  return {
    send: (request) => queueMicrotask(() => listener?.(handle(request).reply)),
    listen: (handler) => {
      listener = handler
    },
  }
}

interface Pending {
  resolve(reply: TerrainReply): void
  reject(error: Error): void
}

export class TerrainClient {
  readonly #port: TerrainPort
  readonly #pending = new Map<number, Pending>()
  #next = 1

  constructor(port: TerrainPort) {
    this.#port = port
    port.listen((reply) => {
      const pending = this.#pending.get(reply.id)
      if (!pending) return
      this.#pending.delete(reply.id)
      if (reply.type === 'error') pending.reject(new Error(reply.message))
      else pending.resolve(reply)
    })
  }

  #request(build: (id: number) => TerrainRequest): Promise<TerrainReply> {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#port.send(build(id))
    })
  }

  async chunk(seed: number, key: string, resolution: number): Promise<ChunkMesh> {
    const reply = await this.#request((id) => ({ type: 'chunk', id, seed, key, resolution }))
    if (reply.type !== 'chunk') throw new Error(`unexpected ${reply.type} reply`)
    return {
      key: reply.key,
      positions: reply.positions,
      normals: reply.normals,
      colors: reply.colors,
    }
  }

  async map(seed: number, width: number, height: number): Promise<TerrainMap> {
    const reply = await this.#request((id) => ({ type: 'map', id, seed, width, height }))
    if (reply.type !== 'map') throw new Error(`unexpected ${reply.type} reply`)
    return { width: reply.width, height: reply.height, data: reply.data }
  }
}
