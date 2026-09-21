import { SimulationHost } from '../../worker/host.ts'
import type { FromWorker } from '../../worker/protocol.ts'
import { FakeClock } from '../../worker/testing.ts'
import type { Port } from './client.ts'

export function connectInProcess(): {
  readonly port: Port
  readonly clock: FakeClock
  readonly fail: (message: string) => void
} {
  const clock = new FakeClock()
  let handler: ((message: FromWorker) => void) | null = null
  let onFailure: ((message: string) => void) | null = null
  const host = new SimulationHost((message) => queueMicrotask(() => handler?.(message)), clock)
  const port: Port = {
    send: (message) => queueMicrotask(() => host.handle(message)),
    listen: (next, failure) => {
      handler = next
      onFailure = failure
    },
  }
  return { port, clock, fail: (message) => onFailure?.(message) }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
