import {
  BufferGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PointsMaterial,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
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
import {
  frameTime,
  MEASURE_DELAY_MS,
  MEASURE_FRAMES,
  TIERS,
  type Tier,
} from '../graphics/settings.ts'
import { createPlanetBody, type PlanetBody } from '../planet/body.ts'
import { terrainTexture } from '../planet/terrainTexture.ts'
import { PLANET_LIGHT, type PlanetPalette, type PlanetState } from '../planet/uniforms.ts'
import type { TerrainMap } from '../surface/terrainClient.ts'
import {
  approach,
  FOCUS_RADIUS,
  OTHER_RADIUS,
  railDistance,
  railPose,
  RAIL_FOV,
  RAIL_OFFSET,
  type Vec3,
} from './camera.ts'
import { axisPoint, type PathData } from './path.ts'
import { starField } from './stars.ts'
import { createStream, particleCounts, type Stream } from './streams.ts'

const VOID = 0x0a0b1e
const BLOOM_SCALE = 0.22
const BLOOM_THRESHOLD = 0.5
const BLOOM_RADIUS = 0.18

export interface SceneWorld {
  readonly key: string
  readonly focused: boolean
  readonly path: PathData
  readonly head: Vec3 | null
  readonly planet: PlanetState
}

export interface SceneMarker {
  readonly key: string
  readonly kind: 'event' | 'decision' | 'fork'
  readonly position: Vec3
}

export interface CurrentSceneOptions {
  readonly palette: PlanetPalette
  readonly tier: Tier
  readonly still: boolean
  readonly seed: number
  readonly map: TerrainMap
  readonly onMeasured?: (frameMs: number, software: boolean) => void
}

export interface Projected {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export interface CurrentScene {
  setWorlds(worlds: readonly SceneWorld[]): void
  setMarkers(markers: readonly SceneMarker[], selected: string | null): void
  setCursor(point: Vec3 | null): void
  measure(): void
  resize(width: number, height: number, dpr: number): void
  recenter(): void
  project(point: Vec3): Projected
  onFrame(callback: () => void): () => void
  dive(): Promise<void>
  pause(paused: boolean): void
  readonly scene: Scene
  dispose(release?: boolean): void
}

interface Entry {
  stream: Stream
  guide: Line
  body: PlanetBody
  detail: string
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
  const camera = new PerspectiveCamera(RAIL_FOV, 1, 0.1, 200)
  const stars = starField(options.seed)
  scene.add(stars)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.enablePan = false
  controls.enableZoom = false
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: MOUSE.ROTATE }
  controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE }

  const terrain = terrainTexture(options.map)
  const light = new Vector3(...PLANET_LIGHT).normalize()
  const initial = railPose([12, 0, 0])
  let target: Vec3 = initial.target
  let goal: Vec3 = initial.target
  let reach = 1
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
        const body = createPlanetBody(options.palette, detail, terrain)
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
      if (world.focused) {
        focusHead = world.head
        if (world.head) goal = railPose(world.head).target
      }
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

  const markerGroup = new Group()
  scene.add(markerGroup)
  const markerGeometry = {
    event: new SphereGeometry(0.07, 12, 8),
    decision: new OctahedronGeometry(0.08),
    fork: new SphereGeometry(0.09, 16, 12),
  }
  const markerMaterial = {
    event: new MeshBasicMaterial({ color: 0xe6e4f5 }),
    selected: new MeshBasicMaterial({ color: 0xffffff }),
    decision: new MeshBasicMaterial({ color: 0x6a5a94 }),
    fork: new MeshBasicMaterial({ color: 0x9a8fc4 }),
  }

  const cursorPlane = new Mesh(
    new PlaneGeometry(4, 4),
    new ShaderMaterial({
      uniforms: { uColor: { value: new Color(0xe6e4f5) } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * 0.05;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  )
  cursorPlane.rotation.y = Math.PI / 2
  const cursorRing = new Mesh(
    new RingGeometry(0.62, 0.68, 48),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: DoubleSide }),
  )
  cursorRing.rotation.y = Math.PI / 2
  cursorPlane.visible = false
  cursorRing.visible = false
  scene.add(cursorPlane, cursorRing)

  function setMarkers(markers: readonly SceneMarker[], selected: string | null): void {
    markerGroup.clear()
    for (const marker of markers) {
      const material =
        marker.kind === 'event'
          ? marker.key === selected
            ? markerMaterial.selected
            : markerMaterial.event
          : markerMaterial[marker.kind]
      const mesh = new Mesh(markerGeometry[marker.kind], material)
      mesh.position.set(...marker.position)
      if (marker.kind === 'event' && marker.key === selected) mesh.scale.setScalar(1.8)
      markerGroup.add(mesh)
    }
  }

  function setCursor(point: Vec3 | null): void {
    cursorPlane.visible = point !== null
    cursorRing.visible = point !== null
    if (!point) return
    cursorPlane.position.set(...point)
    cursorRing.position.set(...point)
  }

  let last = performance.now()
  let started = last
  let measuring = options.onMeasured !== undefined
  let samples: number[] = []
  let time = 0

  const DIVE_MS = 900
  let dive: { from: Vector3; to: Vector3; look: Vec3; start: number; done: () => void } | null =
    null
  let divePromise: Promise<void> | null = null
  let back: { from: Vector3; to: Vector3; start: number } | null = null
  let saved: Vector3 | null = null
  let focusHead: Vec3 | null = null
  let paused = false
  const ease = (t: number) => t * t * (3 - 2 * t)

  function renderFrame(): void {
    if (composer) composer.render()
    else renderer.render(scene, camera)
    for (const listener of listeners) listener()
  }

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    if (measuring && now - started > MEASURE_DELAY_MS) {
      samples.push(now - last)
      if (samples.length >= MEASURE_FRAMES) {
        measuring = false
        options.onMeasured?.(frameTime(samples), softwareRenderer(renderer))
      }
    }
    last = now
    if (dive) {
      const k = ease(Math.min(1, (now - dive.start) / DIVE_MS))
      camera.position.lerpVectors(dive.from, dive.to, k)
      controls.target.set(
        target[0] + (dive.look[0] - target[0]) * k,
        target[1] + (dive.look[1] - target[1]) * k,
        target[2] + (dive.look[2] - target[2]) * k,
      )
      camera.lookAt(controls.target)
      if (k >= 1) {
        const done = dive.done
        dive = null
        done()
      }
      renderFrame()
      return
    }
    if (back) {
      const k = ease(Math.min(1, (now - back.start) / DIVE_MS))
      // FIX: volta à pose relativa ao alvo do trilho, que pode ter mudado de foco durante o planeta
      camera.position.lerpVectors(back.from, back.to, k).add(new Vector3(...target))
      if (k >= 1) back = null
    }
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
    renderFrame()
  }
  renderer.setAnimationLoop(frame)

  return {
    scene,
    setWorlds,
    setMarkers,
    setCursor,
    measure() {
      if (!options.onMeasured || measuring) return
      measuring = true
      started = performance.now()
      samples = []
    },
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
      const nextReach = railDistance(camera.aspect)
      if (nextReach !== reach) {
        const k = nextReach / reach
        camera.position.set(
          target[0] + (camera.position.x - target[0]) * k,
          target[1] + (camera.position.y - target[1]) * k,
          target[2] + (camera.position.z - target[2]) * k,
        )
        reach = nextReach
      }
      for (const entry of entries.values()) entry.stream.setPixelRatio(dpr)
    },
    recenter() {
      camera.position.set(
        target[0] + RAIL_OFFSET[0] * reach,
        target[1] + RAIL_OFFSET[1] * reach,
        target[2] + RAIL_OFFSET[2] * reach,
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
    dive() {
      // FIX: um mergulho já em andamento devolve a mesma promise, sem órfãos
      if (divePromise) return divePromise
      if (paused) return Promise.resolve()
      const promise = new Promise<void>((resolve) => {
        if (!focusHead || options.still) {
          resolve()
          return
        }
        saved = camera.position.clone().sub(new Vector3(...target))
        const head = new Vector3(...focusHead)
        const away = camera.position
          .clone()
          .sub(head)
          .normalize()
          .multiplyScalar(FOCUS_RADIUS * 2.6)
        dive = {
          from: camera.position.clone(),
          to: head.clone().add(away),
          look: focusHead,
          start: performance.now(),
          done: resolve,
        }
      })
      divePromise = promise
      void promise.finally(() => {
        if (divePromise === promise) divePromise = null
      })
      return promise
    },
    pause(next) {
      paused = next
      if (next) {
        renderer.setAnimationLoop(null)
        if (dive) {
          const done = dive.done
          dive = null
          done()
        }
        return
      }
      last = performance.now()
      if (saved) {
        const offset = camera.position.clone().sub(new Vector3(...target))
        back = { from: offset, to: saved, start: last }
        saved = null
      }
      controls.target.set(...target)
      renderer.setAnimationLoop(frame)
    },
    dispose(release = false) {
      renderer.setAnimationLoop(null)
      // FIX: descarte no meio do mergulho não pode deixar a promise pendente para sempre
      if (dive) {
        const done = dive.done
        dive = null
        done()
      }
      controls.dispose()
      for (const key of [...entries.keys()]) remove(key)
      guideMaterial.dispose()
      stars.geometry.dispose()
      ;(stars.material as PointsMaterial).dispose()
      scene.remove(markerGroup, cursorPlane, cursorRing)
      markerGroup.clear()
      for (const geometry of Object.values(markerGeometry)) geometry.dispose()
      for (const material of Object.values(markerMaterial)) material.dispose()
      cursorPlane.geometry.dispose()
      ;(cursorPlane.material as ShaderMaterial).dispose()
      cursorRing.geometry.dispose()
      ;(cursorRing.material as MeshBasicMaterial).dispose()
      renderPass?.dispose()
      bloom?.dispose()
      outputPass?.dispose()
      composer?.dispose()
      terrain.dispose()
      // FIX: libera o contexto só quando o canvas sai de cena; trocar de nível reaproveita o canvas
      if (release) renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
