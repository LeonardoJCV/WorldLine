import { SECTORS, type Allocation, type Sector } from '../../engine/state.ts'

export function rebalance(allocation: Allocation, sector: Sector, value: number): Allocation {
  const target = Math.min(100, Math.max(0, Math.round(value)))
  const others = SECTORS.filter((s) => s !== sector)
  const remaining = 100 - target
  const pool = others.reduce((sum, s) => sum + allocation[s], 0)
  const shares = others.map((s) =>
    pool === 0 ? remaining / others.length : (allocation[s] / pool) * remaining,
  )
  const whole = shares.map((share) => Math.floor(share))
  let leftover = remaining - whole.reduce((sum, part) => sum + part, 0)
  const order = shares
    .map((share, i) => ({ i, fraction: share - (whole[i] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i)
  for (const { i } of order) {
    if (leftover <= 0) break
    whole[i] = (whole[i] ?? 0) + 1
    leftover--
  }
  const next: Record<Sector, number> = { ...allocation, [sector]: target }
  others.forEach((s, i) => {
    next[s] = whole[i] ?? 0
  })
  return next
}

export function sameAllocation(a: Allocation, b: Allocation): boolean {
  return SECTORS.every((sector) => a[sector] === b[sector])
}
