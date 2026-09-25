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
  zoomGoal,
  type Level,
} from './camera.ts'
import { packLife, type SurfaceModel } from './civilization.ts'
import { displaySet, keyOf, rootKeys, selectChunks, type Vec3 } from './cube.ts'
import { createLife } from './life.ts'
import { wantedTiles } from './lifeTiles.ts'
import { createNight } from './night.ts'
import { focalPixels, lodOf } from './lod.ts'
import type { ObjectSet } from './objects.ts'
import { roadKey, buildRoads, type Road } from './roads.ts'
import { shadeByDaySide, skyFragment, skyVertex } from './shading.ts'
import type { Site } from './sites.ts'
import { createTerrain, surfaceRadius } from './terrain.ts'
import type { TerrainClient } from './terrainClient.ts'

const FOV = 45
const MAX_IN_FLIGHT = 4
const LIFE_IN_FLIGHT = 2
const SELECT_MS = 120
const REBUILD_MS = 250
const REBUILD_WAIT_MS = 750
const REBUILD_BATCH = 16
const DAY_SPEED = 0.012
const VOID = 0x0a0b1e
const GROW_FROM = 0.03
const GROW_TO = 0.35
const GROW_MAX = 3

// FEAT: objetos crescem de longe para que florestas e cidades se leiam no continente
function growAt(altitude: number): number {
  const t = Math.min(1, Math.max(0, (altitude - GROW_FROM) / (GROW_TO - GROW_FROM)))
  return 1 + (GROW_MAX - 1) * t * t * (3 - 2 * t)
}

export interface SurfaceSceneOptions {
  readonly seed: number
  readonly palette: PlanetPalette
  readonly tier: Tier
  readonly still: boolean
  readonly terrain: TerrainClient
  readonly density: number
  readonly tileBudget: number
  readonly start: Vec3 | null
  readonly sites: readonly Site[]
  readonly onLevel: (level: Level) => void
}

export interface Projected {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export interface SurfaceScene {
  project(point: Vec3): Projected
  onFrame(callback: () => void): () => void
  goTo(dir: Vec3, level: Level): void
  resize(width: number, height: number, dpr: number): void
  zoom(factor: number): boolean
  setLevel(level: Level): void
  pan(dx: number, dy: number): void
  setHour(hour: number | null): void
  setModel(model: SurfaceModel | null): void
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

  const life = createLife({ sun: sunDir })
  life.group.visible = false
  scene.add(life.group)
  const night = createNight({
    sun: sunDir,
    shared: life.shared,
    density: options.density,
    still: options.still,
    animated: options.tier !== 'low',
    ground: (x, y, z) => groundAt(x, y, z),
  })
  scene.add(night.group)

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
  const lifeTiles = new Map<string, ObjectSet>()
  const lifePending = new Set<string>()
  let lifeWanted: string[] = []
  let lifeCenter: Vec3 = [1, 0, 0]
  let lifeReach = 0
  let lifeFrom = ''
  let lifeDirty = false
  let lifeArrived = 0
  let lifeBuilt = -Infinity
  let lifeShown = ''
  let lifeClock = 0
  let model: SurfaceModel | null = null
  let modelDirty = false
  let roads: Road[] = []
  let roadsFor = ''
  const animated = options.tier !== 'low' && !options.still

  const start = options.start
  let lat = start ? Math.asin(Math.max(-1, Math.min(1, start[1]))) : 0.35
  let lon = start ? Math.atan2(start[2], start[0]) : 0
  let altitude: number = LEVEL_ALTITUDE.orbit
  let goal: number = altitude
  let level: Level = levelOf(altitude)
  let hour: number | null = null
  let clock = 0.58
  let width = 1
  let height = 1
  const scratch = new Vector3()
  const listeners = new Set<() => void>()
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
    if (import.meta.env.DEV) canvas.dataset.chunks = String(displayed.size)
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

  function requestLife(): void {
    const free = LIFE_IN_FLIGHT - lifePending.size
    if (free <= 0) return
    const missing = lifeWanted.filter((key) => !lifeTiles.has(key) && !lifePending.has(key))
    for (const key of missing.slice(0, free)) {
      lifePending.add(key)
      options.terrain.objects(options.seed, key, options.density).then(
        (set) => {
          lifePending.delete(key)
          if (disposed) return
          lifeTiles.set(key, set)
          if (lifeWanted.includes(key)) {
            lifeDirty = true
            lifeArrived++
          }
          requestLife()
        },
        () => {
          lifePending.delete(key)
        },
      )
    }
  }

  function selectLife(): void {
    const from = `${lat.toFixed(5)},${lon.toFixed(5)},${altitude.toFixed(5)}`
    if (from !== lifeFrom) {
      lifeFrom = from
      lifeCenter = dirOf(lat, lon)
      const area = wantedTiles(lifeCenter, altitude, options.tileBudget)
      lifeReach = area.reach
      if (area.keys.join() !== lifeWanted.join()) {
        lifeWanted = area.keys
        lifeDirty = true
      }
    }
    if (lifeTiles.size > options.tileBudget * 2) {
      const keep = new Set(lifeWanted)
      for (const key of [...lifeTiles.keys()]) if (!keep.has(key)) lifeTiles.delete(key)
    }
    requestLife()
  }

  let rebuilds = 0
  let rebuildMs = 0
  let rebuildMax = 0
  // FIX: reconstrói em lotes (fila vazia, lote cheio ou espera longa) e só se o conjunto mudou
  function refreshLife(now: number): void {
    const since = now - lifeBuilt
    if (since < REBUILD_MS) return
    const settled =
      lifePending.size === 0 || lifeArrived >= REBUILD_BATCH || since >= REBUILD_WAIT_MS
    if (!settled) return
    lifeDirty = false
    lifeArrived = 0
    const keys = lifeWanted.filter((key) => lifeTiles.has(key))
    const shown = [...keys].sort().join()
    if (shown === lifeShown) return
    lifeShown = shown
    lifeBuilt = now
    const began = performance.now()
    const sets = keys.flatMap((key) => {
      const set = lifeTiles.get(key)
      return set ? [set] : []
    })
    life.setTiles(sets)
    night.setTiles(sets)
    if (import.meta.env.DEV) {
      const spent = performance.now() - began
      rebuilds++
      rebuildMs += spent
      rebuildMax = Math.max(rebuildMax, spent)
      canvas.dataset.rebuilds = `${rebuilds}/${rebuildMs.toFixed(1)}/${rebuildMax.toFixed(1)}`
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
      resolution: lod.resolution,
      minTriangle: lod.minTriangle,
      inView,
    })
    wanted = chosen.map((item) => keyOf(item.key))
    priority = new Map(chosen.map((item) => [keyOf(item.key), item.distance]))
    dirty = true
    request()
    selectLife()
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
    if (lifeDirty) refreshLife(now)
    life.setView(lifeCenter, lifeReach, growAt(altitude))
    if (import.meta.env.DEV) {
      const shown = `${life.drawn()}/${life.count()}`
      if (canvas.dataset.life !== shown) canvas.dataset.life = shown
    }
    if (animated) lifeClock += dt
    if (modelDirty) {
      modelDirty = false
      life.group.visible = model !== null
      if (model) life.setUniforms(packLife(model, lifeClock))
      const living = roadKey(model)
      if (living !== roadsFor) {
        roadsFor = living
        roads = model ? buildRoads(model, options.sites, sampler) : []
      }
      night.setModel(model, options.sites, roads)
    } else if (animated) {
      life.setTime(lifeClock)
    }
    night.tick(dt, altitude, camera.position)
    if (import.meta.env.DEV) {
      const walking = String(night.people())
      if (canvas.dataset.people !== walking) canvas.dataset.people = walking
    }
    renderer.render(scene, camera)
    for (const listener of listeners) listener()
  })

  return {
    project(point) {
      scratch.set(point[0], point[1], point[2])
      const facing = scratch.dot(camera.position) > scratch.lengthSq()
      scratch.project(camera)
      return {
        x: ((scratch.x + 1) / 2) * width,
        y: ((1 - scratch.y) / 2) * height,
        visible:
          facing &&
          scratch.z > -1 &&
          scratch.z < 1 &&
          Math.abs(scratch.x) <= 1.05 &&
          Math.abs(scratch.y) <= 1.05,
      }
    },
    onFrame(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    goTo(dir, next) {
      lat = Math.asin(Math.max(-1, Math.min(1, dir[1])))
      lon = Math.atan2(dir[2], dir[0])
      goal = next === 'region' ? lod.regionAltitude : LEVEL_ALTITUDE[next]
    },
    resize(nextWidth, nextHeight, dpr) {
      width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      renderer.setPixelRatio(Math.min(dpr, spec.dpr))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      night.setFocal(focalPixels(height * renderer.getPixelRatio(), FOV))
    },
    zoom(factor) {
      const next = zoomGoal(goal, factor, lod.minAltitude, ALTITUDE.max)
      goal = next.goal
      return !next.beyond
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
    setModel(next) {
      model = next
      modelDirty = true
    },
    get hour() {
      return hour ?? clock
    },
    dispose(release = false) {
      disposed = true
      listeners.clear()
      renderer.setAnimationLoop(null)
      for (const cached of meshes.values()) cached.mesh.geometry.dispose()
      meshes.clear()
      terrainMaterial.dispose()
      life.dispose()
      night.dispose()
      lifeTiles.clear()
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
