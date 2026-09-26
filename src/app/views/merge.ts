import type { Cause, EventRecord } from '../../engine/events.ts'
import type { Merge } from '../../engine/merge.ts'
import { VARIABLES, type Variable } from '../../engine/state.ts'
import type {
  SeamFood,
  SeamPreview,
  Snapshot,
  WorldlineId,
  WorldlineInfo,
} from '../../worker/protocol.ts'
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
  readonly food: SeamFood
  readonly debtIn: number
  readonly debtSettled: number
}

// FEAT: a prévia vale para o ano em que a costura acontece, e o presente do hospedeiro é esse ano
export function previewForYear(preview: SeamPreview | null, now: number): SeamPreview | null {
  if (preview === null || preview.seamed.tick !== now) return null
  return preview
}

// FIX: população nem sempre soma — quando os lares divergem, mergeStates mantém só a história mais
// pesada, então o rótulo lê o que a costura FEZ desta vez (os três números), não uma lista fixa
const SUM_TOLERANCE = 1e-6

function kindOf(now: number, next: number, incoming: number): 'sum' | 'blend' {
  const scale = Math.max(1, Math.abs(now), Math.abs(incoming))
  return Math.abs(next - (now + incoming)) <= SUM_TOLERANCE * scale ? 'sum' : 'blend'
}

// FEAT: a tela nunca calcula a costura; ela lê as linhas dos dois snapshots e repassa, sem tocar,
// cada número que só o motor sabe fazer — abalo, comida e dívida chegam prontos do hospedeiro
export function seamView(now: Snapshot, incoming: Snapshot, preview: SeamPreview): SeamView {
  const rows = VARIABLES.map((variable) => {
    const before = now.values[variable]
    const next = preview.seamed.values[variable]
    const arriving = incoming.values[variable]
    return { variable, now: before, next, kind: kindOf(before, next, arriving) }
  })

  const { shock, food, debtIn, debtSettled } = preview
  return { rows, shock, food, debtIn, debtSettled }
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

type MergeCause = Extract<Cause, { readonly kind: 'merge' }>

// FEAT: a costura entra dentro do ano, e o registro que o motor grava nesse ano é o único sinal de
// que ela deixou de estar pendente — nada antes dele significa duas histórias já unidas
export function lastConfluence(events: readonly EventRecord[]): EventRecord | null {
  let last: EventRecord | null = null
  for (const record of events) {
    if (record.event !== 'merge') continue
    if (last === null || record.start > last.start) last = record
  }
  return last
}

export interface ConfluenceView {
  readonly year: number
  readonly other: string
  readonly survivor: WorldlineId
  readonly people: number
}

// FEAT: o nome da outra história sai da causa que o motor gravou junto com o registro, não de um
// palpite da tela sobre quem estava costurável naquele ano
export function confluenceView(
  record: EventRecord,
  survivor: WorldlineId,
  people: number,
): ConfluenceView | null {
  const cause = record.causes.find((entry): entry is MergeCause => entry.kind === 'merge')
  if (cause === undefined) return null
  return { year: record.start, other: cause.other, survivor, people }
}

export interface SeamedWorld {
  readonly info: WorldlineInfo
  readonly merges: readonly Merge[]
}

export interface SeamedRemoval {
  readonly gone: string
  readonly keeper: WorldlineId
}

// FEAT: a mesma recusa do hospedeiro, para a tira dizê-la nas duas línguas em vez de deixar o erro
// cru aparecer: uma costura nomeia as duas histórias, e remover a nomeada a deixaria órfã
export function seamedRemoval(
  worlds: readonly SeamedWorld[],
  id: WorldlineId,
): SeamedRemoval | null {
  const doomed = new Set<string>([id])
  for (const world of worlds) {
    const { parent } = world.info
    if (parent !== null && doomed.has(parent)) doomed.add(world.info.id)
  }
  for (const world of worlds) {
    if (doomed.has(world.info.id)) continue
    const seam = world.merges.find((merge) => doomed.has(merge.other))
    if (seam) return { gone: seam.other, keeper: world.info.id }
  }
  return null
}
