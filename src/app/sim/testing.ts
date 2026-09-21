import { SimulationHost } from '../../worker/host.ts'
import type { FromWorker } from '../../worker/protocol.ts'
import { FakeClock } from '../../worker/testing.ts'
import type { Port } from './client.ts'

export function connectInProcess(): { readonly port: Port; readonly clock: FakeClock } {
  const clock = new FakeClock()
  let handler: ((message: FromWorker) => void) | null = null
  const host = new SimulationHost((message) => queueMicrotask(() => handler?.(message)), clock)
  const port: Port = {
    send: (message) => queueMicrotask(() => host.handle(message)),
    listen: (next) => {
      handler = next
    },
  }
  return { port, clock }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
