import { useEffect, useState } from 'react'
import { Genesis } from './app/genesis/Genesis.tsx'
import { useLocale } from './app/i18n/index.ts'
import { simulation } from './app/sim/runtime.ts'
import { Observatory } from './app/views/Observatory.tsx'
import { linkHash, type MultiverseLink } from './app/world/link.ts'
import { parseRoute, type Route } from './app/world/route.ts'

function currentRoute(): Route {
  return parseRoute(window.location.hash, window.location.search)
}

export function App() {
  const locale = useLocale()
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (route.screen === 'genesis') simulation.getState().pause()
  }, [route])

  const start = (link: MultiverseLink) => {
    history.pushState(null, '', `${window.location.pathname}${linkHash(link)}`)
    setRoute({ screen: 'observatory', link, lens: 'current' })
  }

  const leave = () => {
    simulation.getState().pause()
    history.pushState(null, '', window.location.pathname)
    setRoute({ screen: 'genesis' })
  }

  return route.screen === 'genesis' ? (
    <Genesis onStart={start} />
  ) : (
    <Observatory link={route.link} lens={route.lens} onLeave={leave} />
  )
}
