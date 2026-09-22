import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three'
import { TIERS, type Tier } from '../graphics/settings.ts'
import type { PlanetPalette } from '../planet/uniforms.ts'
import { starField } from '../scene3d/stars.ts'
import {
  ALTITUDE,
  LEVEL_ALTITUDE,
  dirOf,
  levelOf,
  panBy,
  surfacePose,
  type Level,
} from './camera.ts'
import { chunkCenter, displaySet, keyOf, parseKey, rootKeys, selectChunks } from './cube.ts'
import { createTerrain, surfaceRadius } from './terrain.ts'
import type { TerrainClient } from './terrainClient.ts'

export const MAX_DEPTH: Readonly<Record<Tier, number>> = { low: 5, high: 7, ultra: 9 }
export const RESOLUTION: Readonly<Record<Tier, number>> = { low: 16, high: 24, ultra: 32 }
const MAX_IN_FLIGHT = 4
const MAX_CACHED = 420
const SELECT_MS = 120
const DAY_SPEED = 0.012
const VOID = 0x0a0b1e

export interface SurfaceSceneOptions {
  readonly seed: number
  readonly palette: PlanetPalette
  readonly tier: Tier
  readonly still: boolean
  readonly terrain: TerrainClient
  readonly onLevel: (level: Level) => void
}

export interface SurfaceScene {
  resize(width: number, height: number, dpr: number): void
  zoom(factor: number): void
  setLevel(level: Level): void
  pan(dx: number, dy: number): void
  setHour(hour: number | null): void
  readonly hour: number
  dispose(release?: boolean): void
}

interface Cached {
  readonly mesh: Mesh
  used: number
}

export function createSurfaceScene(
  canvas: HTMLCanvasElement,
  options: SurfaceSceneOptions,
): SurfaceScene {
  const spec = TIERS[options.tier]
  const renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
  renderer.setClearColor(VOID, 1)
  const scene = new Scene()
  scene.background = new Color(VOID)
  const camera = new PerspectiveCamera(45, 1, 0.0005, 60)
  const stars = starField(options.seed)
  scene.add(stars)

  const sun = new DirectionalLight(0xffffff, 2.6)
  scene.add(sun, sun.target)
  scene.add(new HemisphereLight(0x7f9cff, 0x1a1030, 0.07))

  const terrainMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
  })
  const terrainGroup = new Group()
  scene.add(terrainGroup)

  const oceanGeometry = new SphereGeometry(1, 192, 128)
  const oceanMaterial = new MeshPhongMaterial({
    color: 0x1d5f8f,
    specular: 0xcfe8ff,
    shininess: 90,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const ocean = new Mesh(oceanGeometry, oceanMaterial)
  ocean.renderOrder = 1
  scene.add(ocean)

  const atmosphereGeometry = new SphereGeometry(1.06, 64, 48)
  const atmosphereMaterial = new MeshBasicMaterial({
    color: new Color(...options.palette.atmosphere),
    transparent: true,
    opacity: 0.08,
    side: BackSide,
    depthWrite: false,
  })
  scene.add(new Mesh(atmosphereGeometry, atmosphereMaterial))

  const sampler = createTerrain(options.seed, options.palette)
  const maxDepth = MAX_DEPTH[options.tier]
  const resolution = RESOLUTION[options.tier]
  const roots = rootKeys().map(keyOf)
  const meshes = new Map<string, Cached>()
  const pending = new Set<string>()
  let wanted: string[] = [...roots]
  let disposed = false

  let lat = 0.35
  let lon = 0
  let altitude: number = LEVEL_ALTITUDE.orbit
  let goal: number = altitude
  let level: Level = levelOf(altitude)
  let hour: number | null = null
  let clock = 0.58
  let height = 1
  options.onLevel(level)

  const groundAt = (x: number, y: number, z: number) =>
    Math.max(surfaceRadius(sampler.sample(x, y, z).height), 1)

  const priority = (text: string) => {
    const key = parseKey(text)
    if (key.level === 0) return -1
    const c = chunkCenter(key)
    const p = camera.position
    return Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2])
  }

  function refresh(): void {
    const now = performance.now()
    const shown = displaySet(wanted, new Set(meshes.keys()))
    terrainGroup.clear()
    for (const key of shown) {
      const cached = meshes.get(key)
      if (!cached) continue
      cached.used = now
      terrainGroup.add(cached.mesh)
    }
    if (meshes.size <= MAX_CACHED) return
    const keep = new Set([...shown, ...wanted, ...roots])
    const stale = [...meshes.entries()]
      .filter(([key]) => !keep.has(key))
      .sort((a, b) => a[1].used - b[1].used)
    for (const [key, cached] of stale.slice(0, meshes.size - Math.floor(MAX_CACHED * 0.8))) {
      cached.mesh.geometry.dispose()
      meshes.delete(key)
    }
  }

  function request(): void {
    const free = MAX_IN_FLIGHT - pending.size
    if (free <= 0) return
    const missing = [...roots, ...wanted].filter((key) => !meshes.has(key) && !pending.has(key))
    const unique = [...new Set(missing)].sort((a, b) => priority(a) - priority(b))
    for (const key of unique.slice(0, free)) {
      pending.add(key)
      options.terrain.chunk(options.seed, key, resolution).then(
        (chunk) => {
          pending.delete(key)
          if (disposed) return
          const geometry = new BufferGeometry()
          geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3))
          geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3))
          geometry.setAttribute('color', new BufferAttribute(chunk.colors, 3))
          geometry.computeBoundingSphere()
          meshes.set(key, { mesh: new Mesh(geometry, terrainMaterial), used: performance.now() })
          refresh()
          request()
        },
        () => {
          pending.delete(key)
        },
      )
    }
  }

  let lastSelect = -Infinity
  function select(now: number): void {
    if (now - lastSelect < SELECT_MS) return
    lastSelect = now
    const p = camera.position
    wanted = selectChunks({ camera: [p.x, p.y, p.z], maxLevel: maxDepth, split: 2 }).map(keyOf)
    refresh()
    request()
  }

  function place(dt: number): void {
    altitude = Math.exp(
      Math.log(altitude) + (Math.log(goal) - Math.log(altitude)) * Math.min(1, dt * 3),
    )
    const n = dirOf(lat, lon)
    const pose = surfacePose(lat, lon, altitude, groundAt(n[0], n[1], n[2]))
    camera.position.set(...pose.position)
    camera.up.set(...pose.up)
    camera.lookAt(...pose.target)
    const r = camera.position.length()
    const floor = groundAt(camera.position.x / r, camera.position.y / r, camera.position.z / r)
    if (r < floor + ALTITUDE.min * 0.5) camera.position.setLength(floor + ALTITUDE.min * 0.5)
    const next = levelOf(altitude)
    if (next !== level) {
      level = next
      options.onLevel(level)
    }
  }

  function moveSun(dt: number): void {
    if (hour === null && !options.still) clock = (clock + dt * DAY_SPEED) % 1
    const angle = (hour ?? clock) * Math.PI * 2
    sun.position.set(Math.cos(angle) * 5, 1.75, Math.sin(angle) * 5)
  }

  let last = performance.now()
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    moveSun(dt)
    place(dt)
    select(now)
    renderer.render(scene, camera)
  })

  return {
    resize(nextWidth, nextHeight, dpr) {
      const width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      renderer.setPixelRatio(Math.min(dpr, spec.dpr))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    zoom(factor) {
      goal = Math.min(ALTITUDE.max, Math.max(ALTITUDE.min, goal * factor))
    },
    setLevel(next) {
      goal = LEVEL_ALTITUDE[next]
    },
    pan(dx, dy) {
      ;[lat, lon] = panBy(lat, lon, altitude, dx, dy, height)
    },
    setHour(next) {
      hour = next
    },
    get hour() {
      return hour ?? clock
    },
    dispose(release = false) {
      disposed = true
      renderer.setAnimationLoop(null)
      for (const cached of meshes.values()) cached.mesh.geometry.dispose()
      meshes.clear()
      terrainMaterial.dispose()
      oceanGeometry.dispose()
      oceanMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      stars.geometry.dispose()
      ;(stars.material as PointsMaterial).dispose()
      if (release) renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
