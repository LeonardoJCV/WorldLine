import { useEffect } from 'react'
import { MODEL_VERSION } from '../../engine/params.ts'
import { useSimulation } from '../sim/runtime.ts'
import { linkHash } from './link.ts'

export function useLinkSync(): void {
  const seed = useSimulation((s) => s.seed)
  const tick = useSimulation((s) => s.present?.tick ?? null)
  const playing = useSimulation((s) => s.playing)
  const decisions = useSimulation((s) => s.decisions)

  useEffect(() => {
    if (seed === null || tick === null || playing) return
    const hash = linkHash({ version: MODEL_VERSION, seed, tick, decisions })
    if (window.location.hash !== hash || window.location.search !== '') {
      history.replaceState(null, '', `${window.location.pathname}${hash}`)
    }
  }, [seed, tick, playing, decisions])
}
