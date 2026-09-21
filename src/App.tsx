import { useEffect } from 'react'
import { useLocale } from './app/i18n/index.ts'
import { simulation } from './app/sim/runtime.ts'
import { Observatory } from './app/views/Observatory.tsx'
import { MAX_SEED } from './engine/params.ts'

function initialSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed')
  const parsed = param === null ? Number.NaN : Number(param)
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SEED) return parsed
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

export function App() {
  const locale = useLocale()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    simulation.getState().create(initialSeed())
  }, [])

  return <Observatory />
}
