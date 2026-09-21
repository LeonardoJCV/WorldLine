import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three'
import type { PlanetDetail } from '../graphics/settings.ts'
import { mixRgb } from '../theme/color.ts'
import {
  atmosphereFragment,
  atmosphereVertex,
  cloudFragment,
  cloudVertex,
  discFragment,
  discVertex,
  planetFragment,
  planetVertex,
  ringFragment,
  ringVertex,
} from './shaders.ts'
import { MAX_SATELLITES, type PlanetPalette, type PlanetState } from './uniforms.ts'

export interface PlanetBody {
  readonly group: Group
  update(state: PlanetState): void
  tick(dt: number, time: number, light: Vector3): void
  dispose(): void
}

const LEVEL: Readonly<Record<PlanetDetail, number>> = { disc: -1, base: 0, clouds: 1, max: 2 }
const SEGMENTS: Readonly<Record<PlanetDetail, readonly [number, number]>> = {
  disc: [24, 16],
  base: [96, 72],
  clouds: [128, 96],
  max: [192, 144],
}

export function createPlanetBody(palette: PlanetPalette, detail: PlanetDetail): PlanetBody {
  const level = LEVEL[detail]
  const group = new Group()
  const system = new Group()
  system.rotation.z = palette.tilt
  group.add(system)
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const defines = { DETAIL: Math.max(level, 0) }

  const light = { value: new Vector3() }
  const time = { value: 0 }
  const center = { value: new Vector3() }
  const scale = { value: 1 }
  const ringNormal = { value: new Vector3(0, 1, 0) }
  const uniforms = {
    uVegetation: { value: 0.8 },
    uLights: { value: 0 },
    uFamine: { value: 0 },
    uBlight: { value: 0 },
    uUnrest: { value: 0 },
    uExtinct: { value: 0 },
    uHaze: { value: 0 },
    uRing: { value: 0 },
    uClouds: { value: 0.5 },
  }
  const [widthSegments, heightSegments] = SEGMENTS[detail]
  const sphere = new SphereGeometry(1, widthSegments, heightSegments)
  geometries.push(sphere)

  if (level < 0) {
    const color = { value: new Vector3(...palette.vegetation) }
    const material = new ShaderMaterial({
      vertexShader: discVertex,
      fragmentShader: discFragment,
      uniforms: { uColor: color, uLight: light },
    })
    materials.push(material)
    const planet = new Mesh(sphere, material)
    system.add(planet)
    return {
      group,
      update(state) {
        const land = mixRgb(palette.arid, palette.vegetation, state.vegetation)
        const gray = land[0] * 0.3 + land[1] * 0.59 + land[2] * 0.11
        const shown = mixRgb(land, [gray * 0.6, gray * 0.6, gray * 0.6], state.extinct)
        color.value.set(shown[0], shown[1], shown[2])
      },
      tick(dt, _time, sun) {
        light.value.copy(sun)
        planet.rotation.y += dt * 0.05
      },
      dispose() {
        for (const geometry of geometries) geometry.dispose()
        for (const material of materials) material.dispose()
      },
    }
  }

  const planetMaterial = new ShaderMaterial({
    vertexShader: planetVertex,
    fragmentShader: planetFragment,
    defines,
    uniforms: {
      uOffset: { value: new Vector3(...palette.offset) },
      uSea: { value: palette.seaLevel },
      uOceanDeep: { value: new Vector3(...palette.oceanDeep) },
      uOceanShallow: { value: new Vector3(...palette.oceanShallow) },
      uVegetationColor: { value: new Vector3(...palette.vegetation) },
      uArid: { value: new Vector3(...palette.arid) },
      uSnow: { value: new Vector3(...palette.snow) },
      uLight: light,
      uTime: time,
      uCenter: center,
      uScale: scale,
      uRingNormal: ringNormal,
      ...uniforms,
    },
  })
  materials.push(planetMaterial)
  const planet = new Mesh(sphere, planetMaterial)
  system.add(planet)

  let clouds: Mesh | null = null
  if (level >= 1) {
    const cloudGeometry = new SphereGeometry(1.015, widthSegments, heightSegments)
    geometries.push(cloudGeometry)
    const cloudMaterial = new ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uOffset: {
          value: new Vector3(
            palette.offset[0] + 17,
            palette.offset[1] + 17,
            palette.offset[2] + 17,
          ),
        },
        uLight: light,
        uTime: time,
        uClouds: uniforms.uClouds,
        uHaze: uniforms.uHaze,
        uSmog: { value: new Vector3(...palette.smog) },
      },
      transparent: true,
      depthWrite: false,
    })
    materials.push(cloudMaterial)
    clouds = new Mesh(cloudGeometry, cloudMaterial)
    system.add(clouds)
  }

  const atmosphereGeometry = new SphereGeometry(1.1, 64, 48)
  geometries.push(atmosphereGeometry)
  const atmosphereMaterial = new ShaderMaterial({
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    defines,
    uniforms: {
      uClear: { value: new Vector3(...palette.atmosphere) },
      uSmog: { value: new Vector3(...palette.smog) },
      uHaze: uniforms.uHaze,
      uLight: light,
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
  })
  materials.push(atmosphereMaterial)
  system.add(new Mesh(atmosphereGeometry, atmosphereMaterial))

  const ringGeometry = new RingGeometry(1.25, 1.55, 160, 1)
  geometries.push(ringGeometry)
  const ringMaterial = new ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    defines,
    uniforms: { uRing: uniforms.uRing, uLight: light, uCenter: center, uScale: scale },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  materials.push(ringMaterial)
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
  geometries.push(satelliteGeometry)
  const satelliteMaterial = new PointsMaterial({
    color: 0xe6e4f5,
    size: 0.035,
    transparent: true,
    opacity: 0.9,
  })
  materials.push(satelliteMaterial)
  const satellites = new Points(satelliteGeometry, satelliteMaterial)
  system.add(satellites)

  const probe = new Vector3()
  return {
    group,
    update(state) {
      uniforms.uVegetation.value = state.vegetation
      uniforms.uLights.value = state.lights
      uniforms.uFamine.value = state.famine
      uniforms.uBlight.value = state.blight
      uniforms.uUnrest.value = state.unrest
      uniforms.uExtinct.value = state.extinct
      uniforms.uHaze.value = state.haze
      uniforms.uRing.value = state.ring
      uniforms.uClouds.value = state.clouds
      satelliteGeometry.setDrawRange(0, Math.min(state.satellites, MAX_SATELLITES))
    },
    tick(dt, now, sun) {
      light.value.copy(sun)
      time.value = now
      planet.rotation.y += dt * 0.05
      if (clouds) clouds.rotation.y += dt * 0.065
      satellites.rotation.y += dt * 0.12
      group.updateMatrixWorld()
      group.getWorldPosition(center.value)
      scale.value = group.getWorldScale(probe).x
      ringNormal.value.set(0, 0, 1).transformDirection(ring.matrixWorld)
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}
