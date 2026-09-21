import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FogExp2,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  MOUSE,
  TOUCH,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { MEASURE_DELAY_MS, MEASURE_FRAMES, TIERS, type Tier } from '../graphics/settings.ts'
import { createPlanetBody, type PlanetBody } from '../planet/body.ts'
import { PLANET_LIGHT, type PlanetPalette, type PlanetState } from '../planet/uniforms.ts'
import { approach, railPose, RAIL_OFFSET, type Vec3 } from './camera.ts'
import { axisPoint, type PathData } from './path.ts'
import { createStream, particleCounts, type Stream } from './streams.ts'

export const FOCUS_RADIUS = 0.9
export const OTHER_RADIUS = 0.45
const VOID = 0x0a0b1e
const BLOOM_SCALE = 0.22
const BLOOM_THRESHOLD = 0.2
const BLOOM_RADIUS = 0.18

export interface SceneWorld {
  readonly key: string
  readonly focused: boolean
  readonly path: PathData
  readonly head: Vec3 | null
  readonly planet: PlanetState
}

export interface CurrentSceneOptions {
  readonly palette: PlanetPalette
  readonly tier: Tier
  readonly still: boolean
  readonly seed: number
  readonly onMeasured?: (frameMs: number, software: boolean) => void
}

export interface Projected {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export interface CurrentScene {
  setWorlds(worlds: readonly SceneWorld[]): void
  resize(width: number, height: number, dpr: number): void
  recenter(): void
  project(point: Vec3): Projected
  onFrame(callback: () => void): () => void
  readonly scene: Scene
  dispose(): void
}

interface Entry {
  stream: Stream
  guide: Line
  body: PlanetBody
  detail: string
}

function starField(seed: number): Points {
  const count = 1500
  const positions = new Float32Array(count * 3)
  let state = seed >>> 0 || 7
  for (let i = 0; i < count * 3; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    positions[i] = (state / 4294967296 - 0.5) * 120
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return new Points(
    geometry,
    new PointsMaterial({ color: 0x8e88b5, size: 0.06, transparent: true, opacity: 0.6 }),
  )
}

function softwareRenderer(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  return /swiftshader|llvmpipe|software/i.test(name)
}

export function createCurrentScene(
  canvas: HTMLCanvasElement,
  options: CurrentSceneOptions,
): CurrentScene {
  const spec = TIERS[options.tier]
  const renderer = new WebGLRenderer({ canvas, antialias: spec.bloom === 0, alpha: true })
  renderer.setClearColor(VOID, 1)
  const scene = new Scene()
  scene.background = new Color(VOID)
  scene.fog = new FogExp2(VOID, 0.022)
  const camera = new PerspectiveCamera(38, 1, 0.1, 200)
  const stars = starField(options.seed)
  scene.add(stars)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.enablePan = false
  controls.enableZoom = false
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: MOUSE.ROTATE }
  controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE }

  const light = new Vector3(...PLANET_LIGHT).normalize()
  const initial = railPose([12, 0, 0])
  let target: Vec3 = initial.target
  let goal: Vec3 = initial.target
  camera.position.set(...initial.position)
  controls.target.set(...target)

  let composer: EffectComposer | null = null
  let renderPass: RenderPass | null = null
  let bloom: UnrealBloomPass | null = null
  let outputPass: OutputPass | null = null
  if (spec.bloom > 0) {
    composer = new EffectComposer(renderer)
    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)
    bloom = new UnrealBloomPass(
      new Vector2(1, 1),
      spec.bloom * BLOOM_SCALE,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    composer.addPass(bloom)
    outputPass = new OutputPass()
    composer.addPass(outputPass)
  }

  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let dpr = 1
  let width = 1
  let height = 1
  let composerDpr = 0

  const guideMaterial = new LineBasicMaterial({ color: 0x3a2a6b, transparent: true, opacity: 0.8 })

  function guideGeometry(path: PathData): BufferGeometry {
    const points: Vector3[] = []
    for (let k = 0; k <= 64; k++) {
      const u = path.alive[0] + ((path.alive[1] - path.alive[0]) * k) / 64
      const p = axisPoint(path, u)
      if (p) points.push(new Vector3(...p))
    }
    return new BufferGeometry().setFromPoints(points)
  }

  function setWorlds(worlds: readonly SceneWorld[]): void {
    const focus = worlds.find((world) => world.focused)
    const counts = particleCounts(
      spec.particles,
      worlds.map((world) => world.key),
      focus?.key ?? '',
    )
    const seen = new Set<string>()
    for (const world of worlds) {
      seen.add(world.key)
      const count = counts.get(world.key) ?? 0
      const detail = world.focused ? spec.focus : spec.others
      let entry = entries.get(world.key)
      if (entry && (entry.stream.count !== count || entry.detail !== detail)) {
        remove(world.key)
        entry = undefined
      }
      if (!entry) {
        const stream = createStream(count, options.seed + world.key.charCodeAt(0))
        stream.setPixelRatio(dpr)
        const guide = new Line(new BufferGeometry(), guideMaterial)
        const body = createPlanetBody(options.palette, detail)
        scene.add(stream.points, guide, body.group)
        entry = { stream, guide, body, detail }
        entries.set(world.key, entry)
      }
      entry.stream.setPath(world.path)
      entry.stream.setEmphasis(world.focused)
      entry.guide.geometry.dispose()
      entry.guide.geometry = guideGeometry(world.path)
      entry.body.update(world.planet)
      const visible = world.head !== null
      entry.body.group.visible = visible
      entry.stream.points.visible = visible
      entry.guide.visible = visible
      if (world.head) {
        entry.body.group.position.set(...world.head)
        entry.body.group.scale.setScalar(world.focused ? FOCUS_RADIUS : OTHER_RADIUS)
      }
      if (world.focused && world.head) goal = railPose(world.head).target
    }
    for (const key of [...entries.keys()]) if (!seen.has(key)) remove(key)
  }

  function remove(key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    scene.remove(entry.stream.points, entry.guide, entry.body.group)
    entry.stream.dispose()
    entry.guide.geometry.dispose()
    entry.body.dispose()
    entries.delete(key)
  }

  let last = performance.now()
  const started = last
  let measuring = options.onMeasured !== undefined
  const samples: number[] = []
  let time = 0

  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    if (measuring && now - started > MEASURE_DELAY_MS) {
      samples.push(now - last)
      if (samples.length >= MEASURE_FRAMES) {
        measuring = false
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length
        options.onMeasured?.(mean, softwareRenderer(renderer))
      }
    }
    last = now
    if (!options.still) time += dt
    const next = approach(target, goal, dt)
    const delta = [next[0] - target[0], next[1] - target[1], next[2] - target[2]] as const
    target = next
    camera.position.x += delta[0]
    camera.position.y += delta[1]
    camera.position.z += delta[2]
    controls.target.set(...target)
    controls.update()
    for (const entry of entries.values()) {
      entry.stream.setTime(time)
      entry.body.tick(options.still ? 0 : dt, time, light)
    }
    if (composer) composer.render()
    else renderer.render(scene, camera)
    for (const listener of listeners) listener()
  })

  return {
    scene,
    setWorlds,
    resize(nextWidth, nextHeight, nextDpr) {
      width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      dpr = Math.min(nextDpr, spec.dpr)
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      if (composer && composerDpr !== dpr) {
        composerDpr = dpr
        composer.setPixelRatio(dpr)
      }
      composer?.setSize(width, height)
      if (bloom && spec.bloomHalf) bloom.setSize((width * dpr) / 2, (height * dpr) / 2)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      for (const entry of entries.values()) entry.stream.setPixelRatio(dpr)
    },
    recenter() {
      camera.position.set(
        target[0] + RAIL_OFFSET[0],
        target[1] + RAIL_OFFSET[1],
        target[2] + RAIL_OFFSET[2],
      )
    },
    project(point) {
      const v = new Vector3(...point).project(camera)
      return {
        x: ((v.x + 1) / 2) * width,
        y: ((1 - v.y) / 2) * height,
        visible: v.z > -1 && v.z < 1,
      }
    },
    onFrame(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      controls.dispose()
      for (const key of [...entries.keys()]) remove(key)
      guideMaterial.dispose()
      stars.geometry.dispose()
      ;(stars.material as PointsMaterial).dispose()
      renderPass?.dispose()
      bloom?.dispose()
      outputPass?.dispose()
      composer?.dispose()
      renderer.dispose()
    },
  }
}
