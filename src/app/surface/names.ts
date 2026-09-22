import { uniform } from '../../engine/rng.ts'

const CHANNEL = 8192 + 96
const ONSETS = [
  'b',
  'br',
  'c',
  'd',
  'dr',
  'f',
  'g',
  'gr',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  'sh',
  't',
  'tr',
  'v',
  'z',
] as const
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou'] as const
const ENDINGS = [
  'ra',
  'na',
  'lia',
  'mar',
  'ton',
  'dor',
  'vel',
  'sen',
  'ria',
  'mund',
  'line',
  'bor',
  'des',
  'nis',
] as const

function pick<T>(list: readonly T[], value: number): T {
  const item = list[Math.min(list.length - 1, Math.floor(value * list.length))]
  if (item === undefined) throw new Error('empty list')
  return item
}

export function cityName(seed: number, site: number, salt = 0): string {
  const draw = (k: number) => uniform(seed, site * 16 + salt * 1024 + k, CHANNEL)
  const syllables = draw(0) < 0.55 ? 1 : 2
  let name = ''
  for (let s = 0; s < syllables; s++) {
    name += pick(ONSETS, draw(1 + s * 2)) + pick(VOWELS, draw(2 + s * 2))
  }
  name += pick(ENDINGS, draw(9))
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function cityNames(seed: number, count: number): string[] {
  const names: string[] = []
  const used = new Set<string>()
  for (let site = 0; site < count; site++) {
    let salt = 0
    let name = cityName(seed, site, salt)
    while (used.has(name)) name = cityName(seed, site, ++salt)
    used.add(name)
    names.push(name)
  }
  return names
}
