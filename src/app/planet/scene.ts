import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { PlanetDetail } from '../graphics/settings.ts'
import { createPlanetBody } from './body.ts'
import {
  CAMERA_DISTANCE,
  CAMERA_FOV,
  PLANET_LIGHT,
  type PlanetPalette,
  type PlanetState,
} from './uniforms.ts'

export interface PlanetScene {
  update(state: PlanetState): void
  resize(size: number, dpr: number): void
  dispose(): void
}

export function createPlanetScene(
  canvas: HTMLCanvasElement,
  palette: PlanetPalette,
  detail: PlanetDetail,
  maxDpr: number,
  reducedMotion: boolean,
): PlanetScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 20)
  camera.position.set(0, 0, CAMERA_DISTANCE)
  const body = createPlanetBody(palette, detail)
  scene.add(body.group)
  const light = new Vector3(...PLANET_LIGHT).normalize()

  const render = () => renderer.render(scene, camera)
  body.tick(0, 0, light)

  if (!reducedMotion) {
    let last = performance.now()
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      body.tick(dt, now / 1000, light)
      render()
    })
  }

  return {
    update(state) {
      body.update(state)
      if (reducedMotion) render()
    },
    resize(size, dpr) {
      renderer.setPixelRatio(Math.min(dpr, maxDpr))
      renderer.setSize(size, size, false)
      if (reducedMotion) render()
    },
    dispose() {
      renderer.setAnimationLoop(null)
      body.dispose()
      renderer.dispose()
    },
  }
}
