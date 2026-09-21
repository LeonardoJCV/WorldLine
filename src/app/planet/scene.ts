import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import {
  atmosphereFragment,
  atmosphereVertex,
  planetFragment,
  planetVertex,
  ringFragment,
  ringVertex,
} from './shaders.ts'
import {
  CAMERA_DISTANCE,
  CAMERA_FOV,
  MAX_SATELLITES,
  type PlanetPalette,
  type PlanetState,
} from './uniforms.ts'

export interface PlanetScene {
  update(state: PlanetState): void
  resize(size: number, dpr: number): void
  dispose(): void
}

const LIGHT = new Vector3(-0.65, 0.35, 0.68).normalize()

export function createPlanetScene(
  canvas: HTMLCanvasElement,
  palette: PlanetPalette,
  reducedMotion: boolean,
): PlanetScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 20)
  camera.position.set(0, 0, CAMERA_DISTANCE)
  const system = new Group()
  system.rotation.z = palette.tilt
  scene.add(system)

  const uVegetation = { value: 0.8 }
  const uLights = { value: 0 }
  const uFamine = { value: 0 }
  const uBlight = { value: 0 }
  const uUnrest = { value: 0 }
  const uExtinct = { value: 0 }
  const uTime = { value: 0 }
  const uHaze = { value: 0 }
  const uRing = { value: 0 }

  const sphere = new SphereGeometry(1, 128, 96)
  const planetMaterial = new ShaderMaterial({
    vertexShader: planetVertex,
    fragmentShader: planetFragment,
    uniforms: {
      uOffset: { value: new Vector3(...palette.offset) },
      uSea: { value: palette.seaLevel },
      uOceanDeep: { value: new Vector3(...palette.oceanDeep) },
      uOceanShallow: { value: new Vector3(...palette.oceanShallow) },
      uVegetationColor: { value: new Vector3(...palette.vegetation) },
      uArid: { value: new Vector3(...palette.arid) },
      uSnow: { value: new Vector3(...palette.snow) },
      uLight: { value: LIGHT },
      uVegetation,
      uLights,
      uFamine,
      uBlight,
      uUnrest,
      uExtinct,
      uTime,
    },
  })
  const planet = new Mesh(sphere, planetMaterial)
  system.add(planet)

  const atmosphereGeometry = new SphereGeometry(1.1, 64, 48)
  const atmosphereMaterial = new ShaderMaterial({
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    uniforms: {
      uClear: { value: new Vector3(...palette.atmosphere) },
      uSmog: { value: new Vector3(...palette.smog) },
      uHaze,
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
  })
  system.add(new Mesh(atmosphereGeometry, atmosphereMaterial))

  const ringGeometry = new RingGeometry(1.25, 1.55, 160, 1)
  const ringMaterial = new ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    uniforms: { uRing },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const ring = new Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = Math.PI * 0.5 - 0.38
  system.add(ring)

  const positions = new Float32Array(MAX_SATELLITES * 3)
  for (let i = 0; i < MAX_SATELLITES; i++) {
    const angle = (i / MAX_SATELLITES) * Math.PI * 2 + i * 0.37
    const radius = 1.2 + (i % 4) * 0.07
    positions.set(
      [Math.cos(angle) * radius, Math.sin(i * 1.7) * 0.35, Math.sin(angle) * radius],
      i * 3,
    )
  }
  const satelliteGeometry = new BufferGeometry()
  satelliteGeometry.setAttribute('position', new BufferAttribute(positions, 3))
  satelliteGeometry.setDrawRange(0, 0)
  const satelliteMaterial = new PointsMaterial({
    color: 0xe6e4f5,
    size: 0.035,
    transparent: true,
    opacity: 0.9,
  })
  const satellites = new Points(satelliteGeometry, satelliteMaterial)
  system.add(satellites)

  const render = () => renderer.render(scene, camera)

  if (!reducedMotion) {
    let last = performance.now()
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      planet.rotation.y += dt * 0.05
      satellites.rotation.y += dt * 0.12
      uTime.value = now / 1000
      render()
    })
  }

  return {
    update(state) {
      uVegetation.value = state.vegetation
      uLights.value = state.lights
      uFamine.value = state.famine
      uBlight.value = state.blight
      uUnrest.value = state.unrest
      uExtinct.value = state.extinct
      uHaze.value = state.haze
      uRing.value = state.ring
      satelliteGeometry.setDrawRange(0, Math.min(state.satellites, MAX_SATELLITES))
      if (reducedMotion) render()
    },
    resize(size, dpr) {
      renderer.setPixelRatio(Math.min(dpr, 1.5))
      renderer.setSize(size, size, false)
      if (reducedMotion) render()
    },
    dispose() {
      renderer.setAnimationLoop(null)
      for (const geometry of [sphere, atmosphereGeometry, ringGeometry, satelliteGeometry]) {
        geometry.dispose()
      }
      for (const material of [
        planetMaterial,
        atmosphereMaterial,
        ringMaterial,
        satelliteMaterial,
      ]) {
        material.dispose()
      }
      renderer.dispose()
    },
  }
}
