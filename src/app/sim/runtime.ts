import { useStore } from 'zustand'
import { SimulationClient, workerPort } from './client.ts'
import { createSimulationStore, type SimulationState } from './store.ts'

const worker = new Worker(new URL('../../worker/sim.worker.ts', import.meta.url), {
  type: 'module',
})

export const client = new SimulationClient(workerPort(worker))
export const simulation = createSimulationStore(client)

export function useSimulation<T>(selector: (state: SimulationState) => T): T {
  return useStore(simulation, selector)
}
