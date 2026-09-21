import { mixRgb, rgba } from '../theme/color.ts'
import type { PlanetPalette, PlanetState } from './uniforms.ts'

export function drawFallbackPlanet(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: PlanetPalette,
  state: PlanetState,
): void {
  const c = size / 2
  const r = size * 0.4
  ctx.clearRect(0, 0, size, size)

  const halo = ctx.createRadialGradient(c, c, r * 0.92, c, c, r * 1.22)
  halo.addColorStop(0, rgba(mixRgb(palette.atmosphere, palette.smog, state.haze), 0.4))
  halo.addColorStop(1, rgba(palette.atmosphere, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(c, c, r * 1.22, 0, Math.PI * 2)
  ctx.fill()

  const land = mixRgb(palette.arid, palette.vegetation, state.vegetation * (1 - state.blight * 0.5))
  const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.3, r * 0.1, c, c, r)
  body.addColorStop(0, rgba(mixRgb(land, palette.oceanShallow, 0.35), 1))
  body.addColorStop(0.7, rgba(mixRgb(palette.oceanDeep, land, 0.4), 1))
  body.addColorStop(1, rgba(palette.oceanDeep, 1))
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.fill()

  const night = ctx.createLinearGradient(c - r, 0, c + r, 0)
  night.addColorStop(0.45, 'rgba(5, 6, 15, 0)')
  night.addColorStop(1, 'rgba(5, 6, 15, 0.85)')
  ctx.fillStyle = night
  ctx.fill()

  if (state.ring > 0) {
    ctx.strokeStyle = 'rgba(201, 174, 255, 0.35)'
    ctx.lineWidth = r * 0.08
    ctx.beginPath()
    ctx.ellipse(c, c, r * 1.55, r * 0.32, -palette.tilt, 0, Math.PI * 2)
    ctx.stroke()
  }
}
