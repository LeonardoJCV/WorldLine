import { CROSSING_KINDS } from './crossing.ts'
import { DEBT_KINDS, PARADOX_KINDS } from './debt.ts'
import { ECHO_TARGETS } from './echo.ts'
import { NEVER, SECTORS, VARIABLES, type WorldState } from './state.ts'

const STATUS_CODES = { running: 0, extinct: 1, collapsed: 2 } as const
// FIX: os eventos antigos sempre entram, mesmo em NEVER; os novos só depois de terem disparado uma vez
const LEGACY_EVENT_COUNT = 11

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
  for (let i = 0; i < s.lastEnded.length; i++) {
    const value = s.lastEnded[i]
    if (value === undefined) continue
    if (i < LEGACY_EVENT_COUNT) h = feed(h, value)
    else if (value !== NEVER) {
      h = feed(h, i)
      h = feed(h, value)
    }
  }
  h = feed(h, s.lastDecision ? s.lastDecision.tick : -1)
  for (const sector of s.lastDecision?.sectors ?? []) h = feed(h, SECTORS.indexOf(sector))
  h = feed(h, STATUS_CODES[s.status])
  // FEAT: campos de travessia só entram quando existem, para não mover os fingerprints antigos
  if (s.echoes.length > 0) {
    h = feed(h, s.echoes.length)
    for (const echo of s.echoes) {
      h = feed(h, ECHO_TARGETS.indexOf(echo.target))
      h = feed(h, echo.remaining)
    }
  }
  if (s.lastCrossing) {
    h = feed(h, s.lastCrossing.tick)
    h = feed(h, CROSSING_KINDS.indexOf(s.lastCrossing.kind))
  }
  // FEAT: origem e alocação da dívida são texto e escolha de quitação, não física; ficam fora do hash
  if (s.debts.length > 0) {
    h = feed(h, s.debts.length)
    for (const debt of s.debts) {
      h = feed(h, DEBT_KINDS.indexOf(debt.kind))
      h = feed(h, debt.owed)
      h = feed(h, debt.since)
    }
  }
  // FEAT: o contador de tensão só existe junto com a dívida, então segue a mesma regra condicional
  if (s.strain > 0) h = feed(h, s.strain)
  if (s.paradox) {
    h = feed(h, PARADOX_KINDS.indexOf(s.paradox.kind))
    h = feed(h, s.paradox.since)
    h = feed(h, s.paradox.deadline)
  }
  return h.toString(16).padStart(8, '0')
}
