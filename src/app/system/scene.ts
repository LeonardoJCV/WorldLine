import {
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Snapshot } from '../../worker/protocol.ts'
import { TIERS, type PlanetDetail, type Tier } from '../graphics/settings.ts'
import { createPlanetBody, type PlanetBody } from '../planet/body.ts'
import { terrainTexture } from '../planet/terrainTexture.ts'
import { starField } from '../scene3d/stars.ts'
import { zoomGoal } from '../surface/camera.ts'
import type { TerrainMap } from '../surface/terrainClient.ts'
import { bodyPalette, bodyState, bodyYaw } from './palette.ts'
import type { PlacedBody, SystemPlacement } from './model.ts'

const FOV = 40
const VOID = 0x0a0b1e
const TILT = 0.62
const STAR_RADIUS = 0.62
const MARGIN = 1.4
const NEAR = 0.1
const FAR = 900
const SEGMENTS = 32
const ORBIT_SEGMENTS = 128
const ZOOM = { min: 0.6, max: 1.5 } as const
const START = 1
const EASE = 5
const DRIFT = 0.06
// FEAT: o quanto de mundo desce uma tela na vertical, para a âncora do rótulo sair do disco
const DROP = 1 / Math.cos(TILT)
// FEAT: o campo de estrelas foi feito para uma câmera a um raio de planeta, não a vinte órbitas
const FIELD_SCALE = 3
const FIELD_POINT = 1.1

export interface SystemSceneOptions {
  readonly placement: SystemPlacement
  readonly seed: number
  readonly tier: Tier
  // FEAT: o mesmo terreno do mundo natal, a única textura que existe — Tarefa 5 explica o porquê
  readonly terrain: TerrainMap
  readonly present: Snapshot
  readonly dpr: number
  // FEAT: sem movimento, a deriva ambiente não anda — a cena fica parada e continua certa
  readonly still: boolean
  onPick(index: number | null): void
}

export interface Projected {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

// FEAT: por onde o pedido de zoom saiu da lente — 'in' cai no planeta, 'out' volta à Corrente
export type Escape = 'in' | 'out' | null

export interface SystemScene {
  setPlacement(placement: SystemPlacement): void
  // FEAT: só o corpo vivo carrega um Snapshot de verdade; os outros não mudam com o relógio da sim
  setPresent(present: Snapshot): void
  setStill(still: boolean): void
  resize(width: number, height: number): void
  zoom(factor: number): Escape
  // FEAT: onde cada corpo caiu na tela, para os rótulos em HTML seguirem, como Current3D já faz
  project(index: number): Projected
  dispose(release?: boolean): void
}

interface Entry {
  readonly planet: PlanetBody
  readonly picker: Mesh
  readonly ring: LineLoop
  detail: PlanetDetail
}

function ringGeometry(radius: number): BufferGeometry {
  const points: number[] = []
  for (let i = 0; i < ORBIT_SEGMENTS; i++) {
    const angle = (i / ORBIT_SEGMENTS) * Math.PI * 2
    points.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  return geometry
}

export function createSystemScene(
  canvas: HTMLCanvasElement,
  options: SystemSceneOptions,
): SystemScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(VOID, 1)
  const scene = new Scene()
  scene.background = new Color(VOID)
  const camera = new PerspectiveCamera(FOV, 1, NEAR, FAR)

  const field = starField(options.seed)
  field.scale.setScalar(FIELD_SCALE)
  const fieldMaterial = field.material as PointsMaterial
  fieldMaterial.size = FIELD_POINT
  scene.add(field)

  // FEAT: a primeira estrela do projeto — um corpo que se vê, e não só uma direção de luz
  const starGeometry = new SphereGeometry(STAR_RADIUS, SEGMENTS, SEGMENTS)
  const starMaterial = new MeshBasicMaterial({ color: 0xffe2a8 })
  scene.add(new Mesh(starGeometry, starMaterial))
  // FIX: PlanetBody usa ShaderMaterial próprio, que não responde a luz de cena — uma PointLight/
  // HemisphereLight aqui não iluminaria nada; a luz de cada corpo é a direção até a estrela, abaixo

  const spec = TIERS[options.tier]
  const terrain = terrainTexture(options.terrain)
  // FEAT: reaproveitado a cada corpo, a cada quadro — evita um Vector3 novo por corpo por quadro
  const sunDirection = new Vector3()

  // FEAT: um alvo invisível por corpo, do tamanho do disco — separa o que se raycasta do que se vê
  const pickerGeometry = new SphereGeometry(1, SEGMENTS, SEGMENTS)
  const pickerMaterial = new MeshBasicMaterial({ visible: false })
  const orbitMaterial = new LineBasicMaterial({ color: 0x5a5480, transparent: true, opacity: 0.75 })
  const bodyGroup = new Group()
  const orbitGroup = new Group()
  scene.add(bodyGroup, orbitGroup)

  let placement = options.placement
  let present = options.present
  let still = options.still
  const entries = new Map<number, Entry>()
  const pickerIndex = new Map<Mesh, number>()
  let width = 1
  let height = 1
  let drift = 0
  let goal: number = START
  let reach: number = START
  let hovered: number | null = null
  let pointing = false
  const scratch = new Vector3()
  const pointer = new Vector2()
  const ray = new Raycaster()

  // FIX: 'base'+ amostra o terreno pela posição do vértice, não por uOffset — sem girar o corpo,
  // todo corpo que não é o vivo mostraria o mesmo litoral de Dedes; o giro por corpo resolve isso
  function detailFor(body: PlacedBody): PlanetDetail {
    return body.living ? spec.focus : spec.others
  }

  function removeEntry(index: number): void {
    const entry = entries.get(index)
    if (!entry) return
    bodyGroup.remove(entry.planet.group, entry.picker)
    orbitGroup.remove(entry.ring)
    entry.ring.geometry.dispose()
    entry.planet.dispose()
    pickerIndex.delete(entry.picker)
    entries.delete(index)
  }

  function clear(): void {
    for (const index of [...entries.keys()]) removeEntry(index)
  }

  // FEAT: reconcilia por índice de corpo — só cria/destrói quando o detalhe muda de fato, porque
  // colonies (e por tabela, placement) chega de novo a cada quadro de simulação; a distância da
  // órbita é fixa por semente+índice, então o anel de um corpo já criado nunca precisa de outro
  function sync(): void {
    const seen = new Set<number>()
    for (const body of placement.bodies) {
      seen.add(body.index)
      const detail = detailFor(body)
      let entry = entries.get(body.index)
      if (entry && entry.detail !== detail) {
        removeEntry(body.index)
        entry = undefined
      }
      if (!entry) {
        const planet = createPlanetBody(bodyPalette(options.seed, body), detail, terrain)
        // FEAT: gira o corpo que não é o vivo para mostrar outro pedaço do mesmo mapa de terreno
        if (!body.living) planet.group.rotation.y = bodyYaw(options.seed, body)
        bodyGroup.add(planet.group)
        const picker = new Mesh(pickerGeometry, pickerMaterial)
        bodyGroup.add(picker)
        pickerIndex.set(picker, body.index)
        const ring = new LineLoop(ringGeometry(body.distance), orbitMaterial)
        orbitGroup.add(ring)
        entry = { planet, picker, ring, detail }
        entries.set(body.index, entry)
      }
      entry.planet.group.scale.setScalar(body.radius)
      entry.picker.scale.setScalar(body.radius)
      entry.planet.update(bodyState(body, present))
    }
    for (const index of [...entries.keys()]) if (!seen.has(index)) removeEntry(index)
  }

  function place(): void {
    for (const body of placement.bodies) {
      const entry = entries.get(body.index)
      if (!entry) continue
      // FEAT: deriva de ambiente, não de simulação — o motor não guarda ângulo nem período algum
      const angle = body.angle + drift / Math.sqrt(Math.max(body.distance, 0.01))
      const x = Math.cos(angle) * body.distance
      const z = Math.sin(angle) * body.distance
      entry.planet.group.position.set(x, 0, z)
      entry.picker.position.set(x, 0, z)
    }
  }

  function framing(): number {
    const tan = Math.tan((FOV * Math.PI) / 360)
    const aspect = Math.max(0.35, width / height)
    const span = placement.span + MARGIN
    const vertical = (span * Math.sin(TILT) + MARGIN) / tan
    const horizontal = span / (tan * aspect)
    return Math.max(vertical, horizontal)
  }

  function pose(): void {
    const distance = framing() * reach
    camera.position.set(0, Math.sin(TILT) * distance, Math.cos(TILT) * distance)
    camera.lookAt(0, 0, 0)
  }

  function report(index: number | null): void {
    if (index === hovered) return
    hovered = index
    canvas.style.cursor = index === null ? 'default' : 'pointer'
    options.onPick(index)
  }

  function pick(): void {
    if (!pointing) return
    ray.setFromCamera(pointer, camera)
    const hit = ray.intersectObjects([...pickerIndex.keys()], false)[0]
    const index = hit ? (pickerIndex.get(hit.object as Mesh) ?? null) : null
    report(index ?? null)
  }

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    pointing = true
  }
  const onPointerLeave = () => {
    pointing = false
    report(null)
  }
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

  sync()
  place()
  pose()

  let last = performance.now()
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!still) drift += dt * DRIFT
    reach = still
      ? goal
      : Math.exp(Math.log(reach) + (Math.log(goal) - Math.log(reach)) * Math.min(1, dt * EASE))
    place()
    pose()
    pick()
    const tickDt = still ? 0 : dt
    // FEAT: a estrela fica na origem, então a luz de cada corpo é só a direção até ela
    for (const entry of entries.values()) {
      sunDirection.copy(entry.planet.group.position).negate().normalize()
      entry.planet.tick(tickDt, now / 1000, sunDirection)
    }
    renderer.render(scene, camera)
  })

  return {
    setPlacement(next) {
      placement = next
      sync()
      place()
    },
    setPresent(next) {
      present = next
      const living = placement.bodies.find((body) => body.living)
      const entry = living ? entries.get(living.index) : undefined
      if (living && entry) entry.planet.update(bodyState(living, present))
    },
    setStill(next) {
      still = next
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      renderer.setPixelRatio(options.dpr)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    zoom(factor) {
      const next = zoomGoal(goal, factor, ZOOM.min, ZOOM.max)
      // FEAT: a mesma disciplina do teto, agora também no chão — só sai quem insiste já no limite
      const inward = goal === ZOOM.min && goal * factor < ZOOM.min
      goal = next.goal
      return next.beyond ? 'out' : inward ? 'in' : null
    },
    project(index) {
      const entry = entries.get(index)
      const body = placement.bodies.find((candidate) => candidate.index === index)
      if (!entry || !body) return { x: 0, y: 0, visible: false }
      // FEAT: a âncora cai um disco abaixo do corpo, para um gasoso não engolir o próprio nome
      scratch
        .set(
          entry.planet.group.position.x,
          entry.planet.group.position.y - body.radius * DROP,
          entry.planet.group.position.z,
        )
        .project(camera)
      return {
        x: ((scratch.x + 1) / 2) * width,
        y: ((1 - scratch.y) / 2) * height,
        visible:
          scratch.z > -1 &&
          scratch.z < 1 &&
          Math.abs(scratch.x) <= 1.05 &&
          Math.abs(scratch.y) <= 1.05,
      }
    },
    dispose(release = false) {
      renderer.setAnimationLoop(null)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      clear()
      pickerGeometry.dispose()
      pickerMaterial.dispose()
      orbitMaterial.dispose()
      starGeometry.dispose()
      starMaterial.dispose()
      field.geometry.dispose()
      fieldMaterial.dispose()
      terrain.dispose()
      if (release) renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}
