import { useEffect } from 'react'
import { useStage } from '../graphics/store.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { useLens } from '../surface/lens.ts'
import { currentLink } from './current.ts'
import { linkHash } from './link.ts'

export function useLinkSync(): void {
  const seed = useSimulation((s) => s.seed)
  const now = useSimulation((s) => s.now)
  const playing = useSimulation((s) => s.playing)
  const worlds = useSimulation((s) => s.worlds)
  const lens = useLens()
  const stage = useStage()

  useEffect(() => {
    const state = simulation.getState()
    const link = currentLink(state)
    if (link === null || state.playing) return
    const hash = `${linkHash(link)}${lens === 'planet' && stage === '3d' ? '/planet' : ''}`
    if (window.location.hash !== hash || window.location.search !== '') {
      history.replaceState(null, '', `${window.location.pathname}${hash}`)
    }
  }, [seed, now, playing, worlds, lens, stage])
}
