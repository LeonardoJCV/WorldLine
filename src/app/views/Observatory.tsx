import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Current } from '../current/Current.tsx'
import { stageLayout } from '../current/geometry.ts'
import { Minimap } from '../current/Minimap.tsx'
import type { Strand } from '../current/normalize.ts'
import { ZoomControls } from '../current/ZoomControls.tsx'
import { TIERS } from '../graphics/settings.ts'
import { useStage, useTier } from '../graphics/store.ts'
import { formatYear } from '../i18n/format.ts'
import { useT } from '../i18n/index.ts'
import { Planet } from '../planet/Planet.tsx'
import { Current3D } from '../scene3d/Current3D.tsx'
import { simulation, useSimulation } from '../sim/runtime.ts'
import { lensStore, useLens, type Lens } from '../surface/lens.ts'
import { PlanetView } from '../surface/PlanetView.tsx'
import { isCompatibleVersion, type MultiverseLink } from '../world/link.ts'
import { useLinkSync } from '../world/useLinkSync.ts'
import { AllocationPanel } from './AllocationPanel.tsx'
import { BottomSheet, usePhone } from './BottomSheet.tsx'
import { CausalPanel } from './CausalPanel.tsx'
import { CrossPanel } from './CrossPanel.tsx'
import { EventsPanel } from './EventsPanel.tsx'
import { sheetReserve } from './hud.ts'
import { useSheet } from './hudStore.ts'
import { InheritanceNotice } from './InheritanceNotice.tsx'
import { PanelCard } from './PanelCard.tsx'
import { ParadoxNotice } from './ParadoxNotice.tsx'
import { StatePanel } from './StatePanel.tsx'
import { TopBar } from './TopBar.tsx'
import { useElementSize } from './useElementSize.ts'
import { WorldActions } from './WorldActions.tsx'
import { WorldsStrip } from './WorldsStrip.tsx'
import './observatory.css'

const NOTICE_GAP = 8
const MIN_STAGE = 120
// FEAT: a faixa que o zoom (e, acima de 720px, o minimapa) ocupa no chão, a mesma que o CSS desenha
const ZOOM_BAND = 44
const MAP_BAND = 92
const NARROW = 720

export function Observatory({
  link,
  lens,
  onLeave,
}: {
  readonly link: MultiverseLink
  readonly lens: Lens
  readonly onLeave: () => void
}) {
  useEffect(() => {
    simulation.getState().open(link)
  }, [link])
  useEffect(() => {
    lensStore.getState().setLens(lens)
  }, [lens])
  useLinkSync()
  const t = useT()
  const tier = useTier()
  const stage = useStage()
  const currentLens = useLens()
  const planetOpen = stage === '3d' && currentLens === 'planet'
  const exitPlanet = useCallback(() => lensStore.getState().setLens('current'), [])
  const [board, setBoard] = useState<HTMLElement | null>(null)
  const size = useElementSize(board)
  const [focus, setFocus] = useState<Strand | null>(null)
  const ended = useSimulation((s) => s.ended)
  const error = useSimulation((s) => s.error)
  const mode = useSimulation((s) => s.mode)
  const seed = useSimulation((s) => s.seed ?? 0)
  const worldFocus = useSimulation((s) => s.focus)
  const cursor = useSimulation((s) => s.cursor)
  const inspectedTick = useSimulation((s) => s.inspected?.tick ?? null)
  const observed = useSimulation((s) => s.inspected ?? s.present)
  const linkVersion = useSimulation((s) => s.linkVersion)
  const manyWorlds = useSimulation((s) => s.worlds.length > 1)
  const remount = `${seed}:${worldFocus}:${cursor === null ? 'now' : (inspectedTick ?? 'pending')}`
  const phone = usePhone()
  const sheet = useSheet()
  const [noticeBand, setNoticeBand] = useState<HTMLDivElement | null>(null)
  const noticesSize = useElementSize(noticeBand)
  const [stripBand, setStripBand] = useState<HTMLDivElement | null>(null)
  const stripSize = useElementSize(stripBand)
  const canKeep = useSimulation((s) => s.seed !== null && s.worlds.length > 0)
  // FEAT: o chão é do aviso primeiro, do zoom e do minimapa depois, e só então dos cartões
  const reserve = phone && size && !planetOpen ? sheetReserve(sheet, size.height) : 0
  const band = phone && noticesSize && noticesSize.height > 0 ? noticesSize.height + NOTICE_GAP : 0
  const floor = reserve + band
  const controlBand =
    phone && size && !planetOpen ? (size.width > NARROW ? MAP_BAND : ZOOM_BAND) : 0
  // FEAT: o palco inteiro desenha acima do chão, em 2D e em 3D
  const drawn = size ? Math.max(MIN_STAGE, size.height - floor - controlBand) : 0
  const layout = useMemo(() => (size ? stageLayout(size.width, drawn) : null), [size, drawn])
  const fullFrame = useMemo(() => {
    if (!size) return null
    const gutter = Math.max(16, Math.round(size.width * 0.03))
    return {
      left: gutter,
      right: size.width - gutter,
      centerY: drawn / 2,
      height: drawn,
    }
  }, [size, drawn])

  const notices = (
    <div className="notices" role="status" ref={setNoticeBand}>
      {/* FEAT: a mudança de mundo é o que há de maior para anunciar; fala antes do paradoxo */}
      <InheritanceNotice />
      <ParadoxNotice />
      {linkVersion !== null && !isCompatibleVersion(linkVersion) && (
        <p>{t('link.version', { version: linkVersion })}</p>
      )}
      {ended !== null && <p>{t(`ended.${ended}`)}</p>}
      {error !== null && <p>{t('error.simulation', { message: error })}</p>}
    </div>
  )
  const cards = (
    <>
      {/* FEAT: à esquerda mora o que se observa e o que se decide */}
      <div className="hud__left">
        <PanelCard id="state" title={t('state.title', { year: formatYear(observed?.tick ?? 0) })}>
          <StatePanel focus={focus} onFocus={setFocus} />
        </PanelCard>
        {mode === 'intervene' && (
          <PanelCard id="allocation" title={t('allocation.title')}>
            <AllocationPanel key={remount} />
          </PanelCard>
        )}
        {mode === 'cross' && (
          <PanelCard id="cross" title={t('cross.title', { id: worldFocus })}>
            <CrossPanel key={remount} />
          </PanelCard>
        )}
      </div>
      {/* FEAT: à direita o que aconteceu e, logo abaixo, por que aconteceu */}
      <div className="hud__right">
        <PanelCard id="events" title={t('events.title')}>
          <EventsPanel />
        </PanelCard>
        <PanelCard id="causal" title={t('causal.title')}>
          <CausalPanel />
        </PanelCard>
      </div>
      <div className="hud__strip" ref={setStripBand}>
        {/* FEAT: na folha o aviso mora acima da alça, onde nenhuma altura o esconde */}
        {!phone && notices}
        {manyWorlds && (
          <PanelCard id="worlds" title={t('worlds.title')}>
            <WorldsStrip />
          </PanelCard>
        )}
        {/* FIX: sem mundo para guardar o painel não desenha nada; o cartão também não aparece */}
        {canKeep && (
          <PanelCard id="actions" title={t('hud.actions')}>
            <WorldActions />
          </PanelCard>
        )}
      </div>
    </>
  )

  const stageNode = (
    <main
      className="stage"
      ref={setBoard}
      data-view={stage}
      data-lens={planetOpen ? 'planet' : 'current'}
    >
      {size && stage === '3d' && fullFrame && (
        <>
          <Current3D width={size.width} height={drawn} paused={planetOpen} />
          {planetOpen && <PlanetView width={size.width} height={drawn} onExit={exitPlanet} />}
        </>
      )}
      {size && layout && stage === '2d' && (
        <>
          <div
            className="planet-slot"
            style={{
              left: layout.planet.cx - layout.planet.size / 2,
              top: layout.planet.cy - layout.planet.size / 2,
            }}
          >
            <Planet
              size={layout.planet.size}
              seed={seed}
              snapshot={observed}
              detail={TIERS[tier].focus}
            />
          </div>
          <Current width={size.width} height={size.height} frame={layout.frame} focus={focus} />
        </>
      )}
    </main>
  )
  // FEAT: o chão lê-se depois dos cartões e sai do DOM com a folha aberta, que o cobre inteiro
  const controls =
    phone && sheet === 'open' ? null : (
      <div className="stage__floor">
        {!planetOpen && size !== null && <ZoomControls />}
        {size && stage === '3d' && fullFrame && <Minimap frame={fullFrame} />}
        {size && layout && stage === '2d' && <Minimap frame={layout.frame} />}
      </div>
    )
  const dashboard = phone ? (
    <BottomSheet available={size?.height ?? 0} notices={notices}>
      {cards}
    </BottomSheet>
  ) : (
    <footer className="hud">{cards}</footer>
  )

  return (
    <div
      className="observatory"
      style={
        {
          '--reserve': `${reserve}px`,
          '--floor': `${floor}px`,
          '--strip': `${Math.round(stripSize?.height ?? 0)}px`,
        } as CSSProperties
      }
    >
      <TopBar onLeave={onLeave} />
      {stageNode}
      {dashboard}
      {controls}
    </div>
  )
}
