import { totalOwed } from '../../engine/debt.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type { Snapshot, WorldlineId } from '../../worker/protocol.ts'
import type { MessageKey } from '../i18n/en.ts'
import { formatYear } from '../i18n/format.ts'
import type { Params } from '../i18n/index.ts'
import { crossOrigins, type OriginCandidate } from './cross.ts'

export interface SeamRow {
  readonly variable: Variable
  readonly now: number
  readonly next: number
  readonly kind: 'sum' | 'blend'
}

export interface SeamView {
  readonly rows: readonly SeamRow[]
  readonly shock: number
  readonly debtIn: number
  readonly debtSettled: number
}

// FIX: população nem sempre soma — quando os lares divergem, mergeStates mantém só a história mais
// pesada, então o rótulo lê o que a costura FEZ desta vez (os três números), não uma lista fixa
const SUM_TOLERANCE = 1e-6

function kindOf(now: number, next: number, incoming: number): 'sum' | 'blend' {
  const scale = Math.max(1, Math.abs(now), Math.abs(incoming))
  return Math.abs(next - (now + incoming)) <= SUM_TOLERANCE * scale ? 'sum' : 'blend'
}

// FEAT: a tela nunca calcula a costura; ela só compara os snapshots e o abalo que o hospedeiro já rendeu
export function seamView(
  now: Snapshot,
  seamed: Snapshot,
  incoming: Snapshot,
  shock: number,
  between: readonly [string, string],
): SeamView {
  const rows = VARIABLES.map((variable) => {
    const before = now.values[variable]
    const next = seamed.values[variable]
    const arriving = incoming.values[variable]
    return { variable, now: before, next, kind: kindOf(before, next, arriving) }
  })

  // FIX: o que vem junto é só o que sobrevive à costura — a dívida da outra com quem se costura
  // se anula, e anunciá-la como "vem com ela" seria dizer um número que não chega a chegar
  const debtIn = totalOwed(incoming.debts.filter((debt) => !between.includes(debt.origin)))
  const debtSettled = totalOwed(now.debts) + totalOwed(incoming.debts) - totalOwed(seamed.debts)

  return { rows, shock, debtIn, debtSettled }
}

// FEAT: a costura pede da outra história o mesmo que a travessia pede da origem: viva, e não esta
export function mergePartners<T extends OriginCandidate>(
  worlds: readonly T[],
  survivor: WorldlineId,
): readonly T[] {
  return crossOrigins(worlds, survivor)
}

export interface MergeBlockInput {
  readonly worlds: number
  readonly partners: number
  readonly survivor: WorldlineId
  readonly survivorEnded: boolean
  // FEAT: o ano da última costura de cada lado, que é o que o hospedeiro confere para recusar a segunda
  readonly survivorSeam: number | null
  readonly other: WorldlineId | null
  readonly otherTick: number | null
  readonly otherSeam: number | null
  readonly now: number
  readonly playing: boolean
  // FEAT: a prévia deste par e deste ano já chegou do hospedeiro
  readonly ready: boolean
}

export interface MergeBlock {
  readonly key: MessageKey
  readonly params: Params
}

// FEAT: a ordem das recusas é o contrato do painel, cada uma pega a mais grave primeiro, e cada
// uma delas é uma que o hospedeiro recusaria — nenhuma costura sai daqui para virar erro lá
export function mergeBlock(input: MergeBlockInput): MergeBlock | null {
  const {
    worlds,
    partners,
    survivor,
    survivorEnded,
    survivorSeam,
    other,
    otherTick,
    otherSeam,
    now,
    playing,
    ready,
  } = input
  const year = formatYear(now)
  if (worlds < 2) return { key: 'merge.alone', params: {} }
  if (survivorEnded) return { key: 'merge.ended', params: {} }
  if (partners < 1) return { key: 'merge.none', params: {} }
  if (survivorSeam === now) return { key: 'merge.once', params: { id: survivor, year } }
  if (other === null) return { key: 'merge.pick', params: {} }
  // FEAT: precaução com a mesma palavra do hospedeiro, que recusa costurar dois anos diferentes
  if (otherTick !== now) return { key: 'merge.notNow', params: { other } }
  if (otherSeam === now) return { key: 'merge.once', params: { id: other, year } }
  if (playing) return { key: 'merge.playing', params: {} }
  if (!ready) return { key: 'merge.loading', params: {} }
  return null
}

export interface HomeChange {
  readonly body: number
  readonly left: number
}

// FEAT: quem fica com o lar sai do snapshot costurado, não da regra que o escolheu
export function homeChange(now: number, incoming: number, seamed: number): HomeChange | null {
  if (now === incoming) return null
  return { body: seamed, left: seamed === now ? incoming : now }
}
