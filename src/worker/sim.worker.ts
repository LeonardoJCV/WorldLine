import { SimulationHost, type Clock } from './host.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

interface WorkerScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
}

const scope = self as unknown as WorkerScope

const clock: Clock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

const host = new SimulationHost(
  (message, transfer = []) => scope.postMessage(message, transfer),
  clock,
)

scope.onmessage = (event) => host.handle(event.data)
