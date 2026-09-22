import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Frustum,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector3,
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
import { displaySet, keyOf, rootKeys, selectChunks, type Vec3 } from './cube.ts'
import { focalPixels, lodOf } from './lod.ts'
import { shadeByDaySide, skyFragment, skyVertex } from './shading.ts'
import { createTerrain, surfaceRadius } from './terrain.ts'
import type { TerrainClient } from './terrainClient.ts'

const FOV = 45
const MAX_IN_FLIGHT = 4
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
  const camera = new PerspectiveCamera(FOV, 1, 0.0005, 60)
  const stars = starField(options.seed)
  scene.add(stars)

  const sun = new DirectionalLight(0xffffff, 2.6)
  scene.add(sun, sun.target)
  scene.add(new HemisphereLight(0x7f9cff, 0x1a1030, 0.07))

  // FIX: normais por face já vêm do bloco; um só material mantém uma chamada de desenho por bloco
  const terrainMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.95,
  })
  const sunDir = { value: new Vector3(1, 0, 0) }
  shadeByDaySide(terrainMaterial, sunDir)
  const terrainGroup = new Group()
  scene.add(terrainGroup)

  const oceanGeometry = new SphereGeometry(1, 192, 128)
  const oceanMaterial = new MeshPhongMaterial({
    color: 0x1d5f8f,
    // FIX: especular escuro e bem concentrado evita o disco branco estourado no oceano
    specular: 0x10161c,
    shininess: 420,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const ocean = new Mesh(oceanGeometry, oceanMaterial)
  ocean.renderOrder = 1
  scene.add(ocean)

  // FIX: núcleo opaco abaixo dos skirts impede que frestas entre blocos mostrem o céu do outro lado
  const coreGeometry = new SphereGeometry(0.96, 64, 48)
  const coreMaterial = new MeshBasicMaterial({ color: VOID })
  scene.add(new Mesh(coreGeometry, coreMaterial))

  const atmosphereGeometry = new SphereGeometry(1.06, 64, 48)
  const atmosphereMaterial = new ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: { uColor: { value: new Vector3(...options.palette.atmosphere) }, uSun: sunDir },
    transparent: true,
    side: BackSide,
    depthWrite: false,
  })
  scene.add(new Mesh(atmosphereGeometry, atmosphereMaterial))

  const sampler = createTerrain(options.seed, options.palette)
  const lod = lodOf(options.tier)
  const roots = rootKeys().map(keyOf)
  const meshes = new Map<string, Cached>()
  const pending = new Set<string>()
  const displayed = new Set<string>()
  const frustum = new Frustum()
  const bounds = new Sphere()
  const projection = new Matrix4()
  let wanted: string[] = [...roots]
  let priority = new Map<string, number>()
  let dirty = true
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

  function refresh(): void {
    dirty = false
    const now = performance.now()
    const shown = new Set(displaySet(wanted, new Set(meshes.keys())))
    for (const key of displayed) {
      if (shown.has(key)) continue
      const cached = meshes.get(key)
      if (cached) terrainGroup.remove(cached.mesh)
      displayed.delete(key)
    }
    for (const key of shown) {
      const cached = meshes.get(key)
      if (!cached) continue
      cached.used = now
      if (displayed.has(key)) continue
      terrainGroup.add(cached.mesh)
      displayed.add(key)
    }
    canvas.dataset.chunks = String(displayed.size)
    if (meshes.size <= lod.cached) return
    const keep = new Set([...shown, ...wanted, ...roots])
    const stale = [...meshes.entries()]
      .filter(([key]) => !keep.has(key))
      .sort((a, b) => a[1].used - b[1].used)
    for (const [key, cached] of stale.slice(0, meshes.size - Math.floor(lod.cached * 0.8))) {
      cached.mesh.geometry.dispose()
      meshes.delete(key)
    }
  }

  function request(): void {
    const free = MAX_IN_FLIGHT - pending.size
    if (free <= 0) return
    const missing = [...new Set([...roots, ...wanted])].filter(
      (key) => !meshes.has(key) && !pending.has(key),
    )
    const rank = (key: string) => priority.get(key) ?? -1
    missing.sort((a, b) => rank(a) - rank(b))
    for (const key of missing.slice(0, free)) {
      pending.add(key)
      options.terrain.chunk(options.seed, key, lod.resolution).then(
        (chunk) => {
          pending.delete(key)
          if (disposed) return
          const geometry = new BufferGeometry()
          geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3))
          geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3))
          geometry.setAttribute('color', new BufferAttribute(chunk.colors, 3))
          geometry.computeBoundingSphere()
          meshes.set(key, { mesh: new Mesh(geometry, terrainMaterial), used: performance.now() })
          dirty = true
          request()
        },
        () => {
          pending.delete(key)
        },
      )
    }
  }

  const inView = (center: Vec3, radius: number) => {
    bounds.center.set(center[0], center[1], center[2])
    bounds.radius = radius
    return frustum.intersectsSphere(bounds)
  }

  let lastSelect = -Infinity
  function select(now: number): void {
    if (now - lastSelect < SELECT_MS) return
    lastSelect = now
    camera.updateMatrixWorld()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    const p = camera.position
    const chosen = selectChunks({
      camera: [p.x, p.y, p.z],
      maxLevel: lod.maxDepth,
      focal: focalPixels(height, FOV),
      error: lod.error,
      budget: lod.budget,
      inView,
    })
    wanted = chosen.map((item) => keyOf(item.key))
    priority = new Map(chosen.map((item) => [keyOf(item.key), item.distance]))
    dirty = true
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
    if (r < floor + lod.minAltitude * 0.5) camera.position.setLength(floor + lod.minAltitude * 0.5)
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
    sunDir.value.copy(sun.position).normalize()
  }

  let last = performance.now()
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    moveSun(dt)
    place(dt)
    select(now)
    if (dirty) refresh()
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
      goal = Math.min(ALTITUDE.max, Math.max(lod.minAltitude, goal * factor))
    },
    setLevel(next) {
      goal = next === 'region' ? lod.regionAltitude : LEVEL_ALTITUDE[next]
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
      coreGeometry.dispose()
      coreMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      stars.geometry.dispose()
      ;(stars.material as PointsMaterial).dispose()
      if (release) renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
