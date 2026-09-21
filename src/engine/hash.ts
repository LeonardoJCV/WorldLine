import { SECTORS, VARIABLES, type WorldState } from './state.ts'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const view = new DataView(new ArrayBuffer(8))

function feed(hash: number, value: number): number {
  view.setFloat64(0, value, false)
  for (let i = 0; i < 8; i++) hash = Math.imul(hash ^ view.getUint8(i), FNV_PRIME)
  return hash >>> 0
}

export function hashState(s: WorldState): string {
  let h = feed(FNV_OFFSET, s.tick)
  for (const variable of VARIABLES) h = feed(h, s[variable])
  for (const sector of SECTORS) h = feed(h, s.allocation[sector])
  for (const value of s.recentEconomy) h = feed(h, value)
  h = feed(h, s.eras)
  for (const entry of s.active) {
    h = feed(h, entry.def)
    h = feed(h, entry.record)
    h = feed(h, entry.start)
  }
  for (const value of s.lastEnded) h = feed(h, value)
  h = feed(h, s.lastDecision ? s.lastDecision.tick : -1)
  for (const sector of s.lastDecision?.sectors ?? []) h = feed(h, SECTORS.indexOf(sector))
  h = feed(h, s.status === 'running' ? 0 : 1)
  return h.toString(16).padStart(8, '0')
}
