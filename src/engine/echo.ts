import type { WorldState } from './state.ts'

export const ECHO_TARGETS = ['technology', 'food', 'energy'] as const
export type EchoTarget = (typeof ECHO_TARGETS)[number]

export interface Echo {
  readonly target: EchoTarget
  readonly remaining: number
}

export const ASSIMILATION = 0.2
export const KEEP = 0.9
export const ECHO_EPSILON = 1e-6

export function addEcho(
  echoes: readonly Echo[],
  target: EchoTarget,
  amount: number,
): readonly Echo[] {
  if (!Number.isFinite(amount) || amount <= 0) return echoes
  const found = echoes.find((echo) => echo.target === target)
  if (!found) return [...echoes, { target, remaining: amount }]
  return echoes.map((echo) =>
    echo.target === target ? { target, remaining: echo.remaining + amount } : echo,
  )
}

export interface Assimilated {
  readonly echoes: readonly Echo[]
  readonly technology: number
  readonly food: number
  readonly energy: number
}

export function assimilate(
  state: Readonly<Pick<WorldState, 'echoes' | 'technology' | 'food' | 'energy'>>,
): Assimilated {
  if (state.echoes.length === 0) {
    return {
      echoes: state.echoes,
      technology: state.technology,
      food: state.food,
      energy: state.energy,
    }
  }
  let technology = state.technology
  let food = state.food
  let energy = state.energy
  const echoes: Echo[] = []
  for (const echo of state.echoes) {
    const given = echo.remaining * ASSIMILATION
    if (echo.target === 'technology') technology += given
    else if (echo.target === 'food') food += given
    else energy += given
    const remaining = (echo.remaining - given) * KEEP
    if (remaining > ECHO_EPSILON) echoes.push({ target: echo.target, remaining })
  }
  return { echoes, technology, food, energy }
}
