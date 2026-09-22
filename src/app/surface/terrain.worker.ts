import { createTerrainHandler, type TerrainReply, type TerrainRequest } from './terrainWorker.ts'

interface WorkerScope {
  postMessage(message: TerrainReply, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<TerrainRequest>) => void) | null
}

const scope = self as unknown as WorkerScope
const handle = createTerrainHandler()

scope.onmessage = (event) => {
  const { reply, transfer } = handle(event.data)
  scope.postMessage(reply, transfer)
}
