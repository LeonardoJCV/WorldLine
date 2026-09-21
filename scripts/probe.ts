import { Worldline } from '../src/engine/worldline.ts'
import type { Allocation } from '../src/engine/state.ts'

const STRATEGIES: Record<string, Allocation> = {
  balanced: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
  industrial: { agriculture: 25, industry: 60, research: 15, conservation: 0 },
  starved: { agriculture: 5, industry: 50, research: 40, conservation: 5 },
  green: { agriculture: 40, industry: 15, research: 20, conservation: 25 },
  research: { agriculture: 35, industry: 20, research: 40, conservation: 5 },
}
const YEARS = [200, 600, 1500, 5000]
const seed = Number(process.argv[2] ?? 482913)
const fixed = (value: number, digits = 1) => value.toFixed(digits).padStart(7)

for (const [name, allocation] of Object.entries(STRATEGIES)) {
  const w = new Worldline(seed, [{ tick: 0, allocation }])
  w.advance(Math.max(...YEARS))
  console.log(`\n${name}  (seed ${seed}, ended at ${w.present.tick}, ${w.present.status})`)
  for (const year of YEARS.filter((y) => y <= w.present.tick)) {
    const s = w.stateAt(year)
    console.log(
      `  y${String(year).padEnd(5)} P ${fixed(s.population / 1e6, 2)}M  T ${fixed(s.technology)}` +
        `  E ${fixed(s.energy, 2)}  Y ${fixed(s.economy, 2)}  N ${fixed(s.environment)}  S ${fixed(s.stability)}`,
    )
  }
  const counts = new Map<string, number>()
  for (const record of w.records) counts.set(record.event, (counts.get(record.event) ?? 0) + 1)
  const firsts = w.records
    .filter((r, i) => w.records.findIndex((o) => o.event === r.event) === i)
    .map((r) => `${r.event}@${r.start}×${counts.get(r.event)}`)
  console.log(`  events: ${firsts.join('  ')}`)
}
