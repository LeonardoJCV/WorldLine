import type { Decision } from './state.ts'

export type GoldenScript = 'steady' | 'shifting'

export const GOLDEN_SCRIPTS: Readonly<Record<GoldenScript, readonly Decision[]>> = {
  steady: [],
  shifting: [
    { tick: 100, allocation: { agriculture: 25, industry: 55, research: 20, conservation: 0 } },
    { tick: 600, allocation: { agriculture: 50, industry: 10, research: 20, conservation: 20 } },
    { tick: 1500, allocation: { agriculture: 30, industry: 20, research: 40, conservation: 10 } },
  ],
}

export interface GoldenCase {
  readonly seed: number
  readonly script: GoldenScript
  readonly year: number
  readonly hash: string
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { seed: 1, script: 'steady', year: 1000, hash: '177ac51d' },
  { seed: 1, script: 'steady', year: 5000, hash: '537a5d92' },
  { seed: 1, script: 'shifting', year: 1000, hash: 'aeb1cbca' },
  { seed: 1, script: 'shifting', year: 5000, hash: 'ddcfedc9' },
  { seed: 482913, script: 'steady', year: 1000, hash: '470d2965' },
  { seed: 482913, script: 'steady', year: 5000, hash: 'a42a4111' },
  { seed: 482913, script: 'shifting', year: 1000, hash: '4f80c4a1' },
  { seed: 482913, script: 'shifting', year: 5000, hash: '1c51ab0d' },
  { seed: 0xffffffff, script: 'steady', year: 1000, hash: '648dbea4' },
  { seed: 0xffffffff, script: 'steady', year: 5000, hash: '68b49e5f' },
  { seed: 0xffffffff, script: 'shifting', year: 1000, hash: 'ae5e39c0' },
  { seed: 0xffffffff, script: 'shifting', year: 5000, hash: '795871e1' },
]
