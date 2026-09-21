import { MAX_SEED } from '../../engine/params.ts'

export function seedFromText(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed)
    return Number.isSafeInteger(value) && value <= MAX_SEED ? value : null
  }
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(trimmed.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 0x01000193)
  }
  return hash >>> 0
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}
