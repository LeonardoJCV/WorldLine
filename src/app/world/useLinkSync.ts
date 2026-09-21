import { useEffect } from 'react'
import { MODEL_VERSION } from '../../engine/params.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { linkHash } from './link.ts'

export function useLinkSync(): void {
  const seed = useSimulation((s) => s.seed)
  const tick = useSimulation((s) => s.present?.tick ?? null)
  const playing = useSimulation((s) => s.playing)
  const decisions = useSimulation((s) => s.decisions)

  useEffect(() => {
    const state = simulation.getState()
    if (state.seed === null || state.present === null || state.playing) return
    const hash = linkHash({
      version: MODEL_VERSION,
      seed: state.seed,
      tick: state.present.tick,
      decisions: state.decisions,
    })
    if (window.location.hash !== hash || window.location.search !== '') {
      history.replaceState(null, '', `${window.location.pathname}${hash}`)
    }
  }, [seed, tick, playing, decisions])
}
