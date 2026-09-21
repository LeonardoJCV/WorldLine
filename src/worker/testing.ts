import type { Clock } from './host.ts'

interface Timer {
  readonly id: number
  readonly at: number
  readonly callback: () => void
}

export class FakeClock implements Clock {
  time = 0
  #timers: Timer[] = []
  #next = 1

  now(): number {
    return this.time
  }

  setTimeout(callback: () => void, ms: number): number {
    const id = this.#next++
    this.#timers.push({ id, at: this.time + ms, callback })
    return id
  }

  clearTimeout(handle: number): void {
    this.#timers = this.#timers.filter((timer) => timer.id !== handle)
  }

  advance(ms: number): void {
    const end = this.time + ms
    for (;;) {
      const due = this.#timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.#timers = this.#timers.filter((timer) => timer !== due)
      this.time = due.at
      due.callback()
    }
    this.time = end
  }
}
