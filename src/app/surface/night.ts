import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hexToRgb } from '../theme/color.ts'
import type { SurfaceModel } from './civilization.ts'
import type { LifeShared } from './life.ts'
import { STRIDE, scatter, type ObjectSet } from './objects.ts'
import type { Road } from './roads.ts'
import { DAY_FROM, DAY_TO, NIGHT_FLOOR } from './shading.ts'
import { BUILT_MAX, INFLUENCE, MAX_SITES, type Site } from './sites.ts'
import { surfaceRadius } from './terrain.ts'

const HALO_LIFT = 0.004
const HALO = 0.14
const HALO_RISE = 0.006
const LAMP = 0.008
const ROAD_LIFT = 0.0015
const FADE_FROM = 0.55
const SMOKE_PER_FACTORY = 6
const MAX_SMOKE = 3600
const MAX_FIRE = 6000
const MAX_PEOPLE = 1500
const PEOPLE_PER_ROAD = 40
const WALK_BELOW = 0.12
const WALK = 0.03
const SIDE_STEP = 0.00025
const PARTICLE = 10
const IMPOSTOR_MIN = 0.006
const IMPOSTOR_FROM = 0.35
const IMPOSTOR_TO = 2.2
const IMPOSTOR_GROW = 3.5
const SHORE = 1.00032
const SKY_FILL = 0.12
const ERA_HEIGHT: Readonly<Record<SurfaceModel['era'], number>> = {
  village: 0.6,
  town: 1,
  industrial: 1.4,
  modern: 2.2,
}

const defines = {
  DAY_FROM: DAY_FROM.toFixed(2),
  DAY_TO: DAY_TO.toFixed(2),
  NIGHT_FLOOR: NIGHT_FLOOR.toFixed(2),
  FADE_FROM: FADE_FROM.toFixed(2),
  MAX_SITES,
}

const nightOf = `
float nightOf(vec3 p) {
  return 1.0 - smoothstep(DAY_FROM, DAY_TO, dot(normalize(p), uSun));
}
`

const haloVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aGlow;
uniform vec3 uSun;
uniform float uFocal;
uniform float uElectric;
varying float vAlpha;
${nightOf}
void main() {
  // FIX: ergue o centro com a distância para o relevo grosso de longe não cobrir o halo
  vec3 p = position + normalize(position) * length(cameraPosition - position) * HALO_RISE;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.0001);
  float close = mix(0.35, 1.0, smoothstep(0.02, 0.15, dist));
  float facing = dot(normalize(position), normalize(cameraPosition - p));
  vAlpha = nightOf(position) * close * smoothstep(-0.05, 0.08, facing) * min(1.0, 0.4 + aGlow);
  gl_PointSize = vAlpha > 0.003 ? clamp(HALO * (0.5 + aGlow) * uFocal / dist, 6.0, uFocal * 0.6) : 0.0;
  #include <logdepthbuf_vertex>
}
`

const haloFragment = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uWarm;
uniform vec3 uCore;
uniform vec3 uFire;
uniform float uElectric;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float halo = (1.0 - r2) * (1.0 - r2);
  float core = exp(-r2 * 16.0);
  vec3 warm = mix(uFire, uWarm, step(0.001, uElectric));
  gl_FragColor = vec4(warm * halo * 0.8 + uCore * core * (0.8 + uElectric), vAlpha);
  #include <colorspace_fragment>
}
`

const roadVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uSun;
uniform float uFocal;
uniform float uElectric;
varying float vNight;
varying float vAlpha;
${nightOf}
void main() {
  // FIX: ergue com a distância para a estrada não sumir sob o relevo grosso de longe
  vec3 p = position + normalize(position) * length(cameraPosition - position) * ROAD_LIFT;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vNight = nightOf(position);
#ifdef LAMPS
  vAlpha = vNight * uElectric;
  gl_PointSize = vAlpha > 0.003 ? clamp(LAMP * uFocal / max(-mv.z, 0.0001), 1.5, 6.0) : 0.0;
#else
  vAlpha = 0.85;
#endif
  #include <logdepthbuf_vertex>
}
`

const roadFragment = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform vec3 uLamp;
uniform float uElectric;
varying float vNight;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
#ifdef LAMPS
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(uLamp * (1.0 - r2), vAlpha);
#else
  vec3 lit = uColor * (NIGHT_FLOOR + (1.0 - NIGHT_FLOOR) * (1.0 - vNight));
  gl_FragColor = vec4(lit + uLamp * uElectric * vNight * 0.55, vAlpha);
#endif
  #include <colorspace_fragment>
}
`

const particleVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSpin;
attribute vec4 aData;
attribute vec2 aPhase;
uniform vec4 uCity[MAX_SITES];
uniform vec4 uCity2[MAX_SITES];
uniform vec4 uLife;
uniform vec4 uLife2;
uniform vec4 uLife3;
uniform vec4 uView;
uniform float uGrow;
uniform float uThin;
uniform vec3 uSun;
uniform float uFocal;
varying float vAlpha;
varying float vLight;
${nightOf}
void main() {
  vec3 up = normalize(position);
  float rank = aData.y;
  int site = int(aData.z);
  float ring = aData.w;
  bool known = site >= 0 && site < MAX_SITES;
  vec4 city = known ? uCity[site] : vec4(0.0);
  vec4 city2 = known ? uCity2[site] : vec4(0.0);
  bool alive = city.y > 0.5 && city.y < 1.5;
  float t = uLife3.z;
  float near = dot(up, uView.xyz);
  float away = length(up - uView.xyz * near) / max(near, 0.001);
  float fade = near > 0.0 ? 1.0 - smoothstep(uView.w * FADE_FROM, uView.w, away) : 0.0;
  float s = aData.x * uGrow;
  vec3 p;
  float size;
  float alpha;
  bool show;
#if PARTICLE_KIND == 0
  show = alive && rank < uLife2.x;
  vec3 ref = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 east = normalize(cross(ref, up));
  vec3 north = cross(up, east);
  vec3 side = east * cos(aSpin) + north * sin(aSpin);
  float h = fract(t * 0.2 + aPhase.x);
  p = position + (side * 0.0004 + up * 0.002) * s + (up * 0.006 + side * 0.0012) * h * uGrow;
  size = (0.0006 + h * 0.0022) * uGrow;
  alpha = (1.0 - h) * 0.75;
  vLight = NIGHT_FLOOR + (1.0 - NIGHT_FLOOR) * (1.0 - nightOf(position));
#else
  bool building = aPhase.y < 0.5;
  show = building
    ? uLife3.x > 0.5 && alive && ring <= max(city.x, 0.02) && rank < 0.08
    : uLife2.w > 0.5 && rank < uLife.x * uThin && rank >= uLife.x * 0.7 && !(alive && ring < city2.z);
  float lift = alive ? city.z * (1.0 + 1.5 * (1.0 - ring / max(city.x, 0.001))) : 1.0;
  float top = building ? 0.0012 * lift + 0.0005 : 0.0018;
  float flicker = 0.6 + 0.4 * sin(t * 9.0 + aPhase.x * 6.2831);
  p = position + up * (top * s + flicker * 0.0003 * uGrow);
  size = 0.0012 * uGrow * (0.8 + 0.4 * flicker);
  alpha = flicker;
  vLight = 1.0;
#endif
  vAlpha = alpha * fade;
  if (!show || vAlpha < 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  } else {
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uFocal / max(-mv.z, 0.0001), 1.0, 64.0);
  }
  #include <logdepthbuf_vertex>
}
`

const particleFragment = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform vec3 uCore;
varying float vAlpha;
varying float vLight;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
#if PARTICLE_KIND == 0
  gl_FragColor = vec4(uColor * vLight, vAlpha * (1.0 - r2));
#else
  gl_FragColor = vec4(mix(uColor, uCore, exp(-r2 * 6.0)) * (1.0 - r2), vAlpha);
#endif
  #include <colorspace_fragment>
}
`

const impostorPrelude = `
uniform vec3 uSun;
attribute vec4 aPlace;
attribute vec4 aData;
uniform vec4 uView;
uniform float uImpostor;
varying vec3 vSurface;
`

const impostorBody = `
vec3 up = normalize(aPlace.xyz);
vec3 ref = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 east = normalize(cross(ref, up));
vec3 north = cross(up, east);
vec3 side = east * cos(aPlace.w) + north * sin(aPlace.w);
vec3 front = cross(side, up);
float near = dot(up, uView.xyz);
float away = length(up - uView.xyz * near) / max(near, 0.001);
// FEAT: some onde a vida detalhada está carregada, no mesmo esmaecimento da borda
float keep = uView.w > 0.0 && near > 0.0 ? smoothstep(uView.w * FADE_FROM, uView.w, away) : 1.0;
float day = smoothstep(DAY_FROM, DAY_TO, dot(up, uSun));
float scale = aData.x * keep * uImpostor * day;
float lift = length(cameraPosition - aPlace.xyz) * ROAD_LIFT;
vec3 transformed = aPlace.xyz + up * lift + (side * position.x + up * position.y * aData.y + front * position.z) * scale;
vSurface = aPlace.xyz;
`

const surfaceFragment = `
float dayLight = smoothstep(DAY_FROM, DAY_TO, dot(normalize(vSurface), uSun));
outgoingLight += diffuseColor.rgb * SKY_FILL;
outgoingLight *= NIGHT_FLOOR + (1.0 - NIGHT_FLOOR) * dayLight;
#include <opaque_fragment>
`

function painted(geometry: BufferGeometry, hex: string): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  if (flat !== geometry) geometry.dispose()
  flat.deleteAttribute('uv')
  const [r, g, b] = hexToRgb(hex)
  const count = flat.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  return flat
}

const BLOCKS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0.28, 0.42],
  [0.42, 0.12, 0.22, 0.26],
  [-0.38, 0.3, 0.24, 0.3],
  [0.12, -0.44, 0.2, 0.22],
  [-0.3, -0.36, 0.22, 0.26],
  [0.36, 0.5, 0.18, 0.2],
  [-0.58, -0.02, 0.18, 0.2],
  [0.6, -0.3, 0.18, 0.18],
  [-0.05, 0.6, 0.2, 0.24],
]

function clusterModel(): BufferGeometry {
  const parts: BufferGeometry[] = [
    painted(new CylinderGeometry(0.9, 1, 0.4, 7).translate(0, -0.18, 0), '#b9a88a'),
  ]
  for (const [x, z, w, h] of BLOCKS) {
    parts.push(painted(new BoxGeometry(w, h, w).translate(x, h / 2, z), '#e8e4dc'))
    parts.push(
      painted(
        new ConeGeometry(w * 0.75, w * 0.5, 4, 1, true)
          .rotateY(Math.PI / 4)
          .translate(x, h + w * 0.25, z),
        '#b0563a',
      ),
    )
  }
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) throw new Error('could not merge the city cluster')
  return geometry
}

const surfaceDefines = {
  ...defines,
  SKY_FILL: SKY_FILL.toFixed(2),
  ROAD_LIFT: ROAD_LIFT.toFixed(4),
}

function shadeDaySide(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSun;\nvarying vec3 vSurface;')
    .replace('#include <opaque_fragment>', surfaceFragment)
}

interface Particles {
  readonly points: Points
  readonly material: ShaderMaterial
  data: Float32Array
}

function particleGeometry(capacity: number): { geometry: BufferGeometry; data: Float32Array } {
  const data = new Float32Array(capacity * PARTICLE)
  const buffer = new InterleavedBuffer(data, PARTICLE)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0))
  geometry.setAttribute('aSpin', new InterleavedBufferAttribute(buffer, 1, 3))
  geometry.setAttribute('aData', new InterleavedBufferAttribute(buffer, 4, 4))
  geometry.setAttribute('aPhase', new InterleavedBufferAttribute(buffer, 2, 8))
  geometry.setDrawRange(0, 0)
  return { geometry, data }
}

function reserve(particles: Particles, count: number): Float32Array {
  if (particles.data.length >= count * PARTICLE) return particles.data
  const capacity = Math.max(count, (particles.data.length / PARTICLE) * 2, 256)
  const next = particleGeometry(capacity)
  particles.points.geometry.dispose()
  particles.points.geometry = next.geometry
  particles.data = next.data
  return next.data
}

function commit(particles: Particles, count: number): void {
  const geometry = particles.points.geometry
  const position = geometry.getAttribute('position')
  if (position instanceof InterleavedBufferAttribute) {
    position.data.clearUpdateRanges()
    position.data.addUpdateRange(0, Math.max(count, 1) * PARTICLE)
    position.data.needsUpdate = true
  }
  geometry.setDrawRange(0, count)
  particles.points.visible = count > 0
}

export interface NightOptions {
  readonly sun: { value: Vector3 }
  readonly shared: LifeShared
  readonly density: number
  readonly still: boolean
  readonly animated: boolean
}

export interface Night {
  readonly group: Group
  setModel(model: SurfaceModel | null, sites: readonly Site[], roads: readonly Road[]): void
  setTiles(sets: readonly ObjectSet[]): void
  setFocal(pixels: number): void
  tick(dt: number, altitude: number): void
  people(): number
  dispose(): void
}

export function createNight(options: NightOptions): Night {
  const { shared } = options
  const group = new Group()
  group.visible = false
  const uFocal = { value: 800 }
  const uElectric = { value: 0 }
  const uImpostor = { value: 1 }
  const uSun = options.sun

  const haloGeometry = new BufferGeometry()
  const haloPositions = new Float32Array(MAX_SITES * 3)
  const haloGlow = new Float32Array(MAX_SITES)
  haloGeometry.setAttribute('position', new BufferAttribute(haloPositions, 3))
  haloGeometry.setAttribute('aGlow', new BufferAttribute(haloGlow, 1))
  haloGeometry.setDrawRange(0, 0)
  const haloMaterial = new ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    uniforms: {
      uSun,
      uFocal,
      uElectric,
      uWarm: { value: new Color('#ff9a3c') },
      uCore: { value: new Color('#ffe6b0') },
      uFire: { value: new Color('#e0602a') },
    },
    defines: { ...defines, HALO: HALO.toFixed(3), HALO_RISE: HALO_RISE.toFixed(4) },
    transparent: true,
    // FEAT: o halo é luz espalhada; o horizonte do planeta é testado no shader em vez da profundidade
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const halos = new Points(haloGeometry, haloMaterial)
  halos.frustumCulled = false
  halos.renderOrder = 3
  group.add(halos)

  const roadUniforms = {
    uSun,
    uFocal,
    uElectric,
    uColor: { value: new Color('#5a4a3a') },
    uLamp: { value: new Color('#ffc978') },
  }
  const roadDefines = { ...defines, ROAD_LIFT: ROAD_LIFT.toFixed(4), LAMP: LAMP.toFixed(4) }
  const lineMaterial = new ShaderMaterial({
    vertexShader: roadVertex,
    fragmentShader: roadFragment,
    uniforms: roadUniforms,
    defines: roadDefines,
    transparent: true,
    depthWrite: false,
  })
  const lampMaterial = new ShaderMaterial({
    vertexShader: roadVertex,
    fragmentShader: roadFragment,
    uniforms: roadUniforms,
    defines: { ...roadDefines, LAMPS: 1 },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const lines = new LineSegments(new BufferGeometry(), lineMaterial)
  const lamps = new Points(new BufferGeometry(), lampMaterial)
  for (const object of [lines, lamps]) {
    object.frustumCulled = false
    object.renderOrder = 2
    group.add(object)
  }

  const particleUniforms = {
    ...shared,
    uFocal,
  }
  const makeParticles = (kind: number, color: string, core: string, additive: boolean) => {
    const material = new ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        ...particleUniforms,
        uColor: { value: new Color(color) },
        uCore: { value: new Color(core) },
      },
      defines: { ...defines, PARTICLE_KIND: kind },
      transparent: true,
      depthWrite: false,
      ...(additive ? { blending: AdditiveBlending } : {}),
    })
    const { geometry, data } = particleGeometry(256)
    const points = new Points(geometry, material)
    points.frustumCulled = false
    points.renderOrder = 2
    points.visible = false
    group.add(points)
    const particles: Particles = { points, material, data }
    return particles
  }
  const smoke = makeParticles(0, '#c9c4c0', '#c9c4c0', false)
  const fire = makeParticles(1, '#ff6a1f', '#ffd27a', true)

  const cluster = clusterModel()
  const impostorGeometry = new InstancedBufferGeometry()
  for (const name of ['position', 'normal', 'color']) {
    const attribute = cluster.getAttribute(name)
    if (attribute) impostorGeometry.setAttribute(name, attribute)
  }
  cluster.dispose()
  const impostorPlace = new Float32Array(MAX_SITES * 4)
  const impostorData = new Float32Array(MAX_SITES * 4)
  const placeAttribute = new InstancedBufferAttribute(impostorPlace, 4)
  const dataAttribute = new InstancedBufferAttribute(impostorData, 4)
  impostorGeometry.setAttribute('aPlace', placeAttribute)
  impostorGeometry.setAttribute('aData', dataAttribute)
  impostorGeometry.instanceCount = 0
  const impostorMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
  })
  impostorMaterial.defines = surfaceDefines
  impostorMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uSun, uView: shared.uView, uImpostor })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${impostorPrelude}`)
      .replace('#include <begin_vertex>', impostorBody)
    shadeDaySide(shader)
  }
  const impostors = new Mesh(impostorGeometry, impostorMaterial)
  impostors.frustumCulled = false
  impostors.visible = false
  group.add(impostors)

  const walking = options.animated && !options.still
  const capacity = walking ? MAX_PEOPLE : 1
  const personGeometry = new BoxGeometry(0.00018, 0.0004, 0.00018).translate(0, 0.0002, 0)
  const personMaterial = new MeshStandardMaterial({
    color: '#f0e8d8',
    flatShading: true,
    roughness: 0.9,
  })
  personMaterial.defines = surfaceDefines
  personMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSun = uSun
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurface;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSurface = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shadeDaySide(shader)
  }
  const crowd = new InstancedMesh(personGeometry, personMaterial, capacity)
  crowd.count = 0
  crowd.frustumCulled = false
  group.add(crowd)
  const walkRoad = new Uint16Array(capacity)
  const walkT = new Float32Array(capacity)
  const walkSpeed = new Float32Array(capacity)
  const walkSide = new Float32Array(capacity)
  let crowdSize = 0
  let roadLengths = new Float32Array(0)
  let roadWet: Uint8Array[] = []
  const at = new Vector3()
  const next = new Vector3()
  const up = new Vector3()
  const across = new Vector3()
  const yAxis = new Vector3(0, 1, 0)
  const unit = new Vector3(1, 1, 1)
  const turn = new Quaternion()
  const matrix = new Matrix4()
  const hidden = new Matrix4().makeScale(0, 0, 0)

  let roads: readonly Road[] = []

  function setRoads(list: readonly Road[]): void {
    roads = list
    const segments = list.reduce((sum, road) => sum + Math.max(0, road.points.length / 3 - 1), 0)
    const linePositions = new Float32Array(segments * 6)
    const lampPositions = new Float32Array(list.reduce((sum, road) => sum + road.points.length, 0))
    let line = 0
    let lamp = 0
    roadLengths = new Float32Array(list.length)
    roadWet = list.map((road) => {
      const p = road.points
      const wet = new Uint8Array(p.length / 3)
      for (let k = 0; k < wet.length; k++) {
        const x = p[k * 3] ?? 0
        const y = p[k * 3 + 1] ?? 0
        const z = p[k * 3 + 2] ?? 0
        wet[k] = x * x + y * y + z * z < SHORE * SHORE ? 1 : 0
      }
      return wet
    })
    list.forEach((road, r) => {
      const p = road.points
      lampPositions.set(p, lamp)
      lamp += p.length
      let length = 0
      for (let i = 0; i + 5 < p.length; i += 3) {
        for (let k = 0; k < 6; k++) linePositions[line + k] = p[i + k] ?? 0
        line += 6
        const dx = (p[i + 3] ?? 0) - (p[i] ?? 0)
        const dy = (p[i + 4] ?? 0) - (p[i + 1] ?? 0)
        const dz = (p[i + 5] ?? 0) - (p[i + 2] ?? 0)
        length += Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
      roadLengths[r] = Math.max(length, 0.0001)
    })
    lines.geometry.dispose()
    lamps.geometry.dispose()
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', new BufferAttribute(linePositions, 3))
    lines.geometry = lineGeometry
    const lampGeometry = new BufferGeometry()
    lampGeometry.setAttribute('position', new BufferAttribute(lampPositions, 3))
    lamps.geometry = lampGeometry
    lines.visible = segments > 0
    lamps.visible = segments > 0
    crowdSize = walking
      ? Math.min(MAX_PEOPLE, Math.floor(list.length * PEOPLE_PER_ROAD * options.density))
      : 0
    for (let i = 0; i < crowdSize; i++) {
      walkRoad[i] = i % Math.max(1, list.length)
      walkT[i] = scatter(0x51f7, i, 1, 0)
      const pace = (0.02 + 0.03 * scatter(0x51f7, i, 2, 0)) * WALK
      walkSpeed[i] = scatter(0x51f7, i, 3, 0) < 0.5 ? -pace : pace
      walkSide[i] = (scatter(0x51f7, i, 4, 0) < 0.5 ? -1 : 1) * SIDE_STEP
    }
    crowd.count = 0
  }

  return {
    group,
    setModel(model, sites, nextRoads) {
      group.visible = model !== null
      if (nextRoads !== roads) setRoads(nextRoads)
      if (!model) return
      uElectric.value = model.electric
      let count = 0
      for (const city of model.cities) {
        if (city.state !== 'alive') continue
        const site = sites[city.site]
        if (!site || count >= MAX_SITES) continue
        const r = Math.max(surfaceRadius(site.height), 1)
        const light = 0.4 + 0.6 * city.size
        haloPositions[count * 3] = site.dir[0] * (r + HALO_LIFT)
        haloPositions[count * 3 + 1] = site.dir[1] * (r + HALO_LIFT)
        haloPositions[count * 3 + 2] = site.dir[2] * (r + HALO_LIFT)
        haloGlow[count] = Math.max(model.electric, 0.12) * light
        impostorPlace.set(
          [
            site.dir[0] * r,
            site.dir[1] * r,
            site.dir[2] * r,
            scatter(0x3a11, site.index, 0, 0) * 6,
          ],
          count * 4,
        )
        impostorData.set(
          [IMPOSTOR_MIN + city.size * BUILT_MAX * INFLUENCE, ERA_HEIGHT[model.era], 0, 0],
          count * 4,
        )
        count++
      }
      haloGeometry.setDrawRange(0, count)
      const position = haloGeometry.getAttribute('position')
      const glow = haloGeometry.getAttribute('aGlow')
      position.needsUpdate = true
      glow.needsUpdate = true
      halos.visible = count > 0
      placeAttribute.needsUpdate = true
      dataAttribute.needsUpdate = true
      impostorGeometry.instanceCount = count
      impostors.visible = count > 0
      fire.points.visible =
        (model.unrest || model.burnt) && fire.points.geometry.drawRange.count > 0
    },
    setTiles(sets) {
      let factories = 0
      let burning = 0
      for (const set of sets) {
        factories += set.factories.length / STRIDE
        burning += set.buildings.length / STRIDE + set.trees.length / STRIDE
      }
      const smokeCount = Math.min(MAX_SMOKE, factories * SMOKE_PER_FACTORY)
      const smokeData = reserve(smoke, smokeCount)
      let n = 0
      for (const set of sets) {
        const part = set.factories
        for (let i = 0; i < part.length && n < smokeCount; i += STRIDE) {
          for (let k = 0; k < SMOKE_PER_FACTORY && n < smokeCount; k++) {
            const o = n * PARTICLE
            for (let j = 0; j < STRIDE; j++) smokeData[o + j] = part[i + j] ?? 0
            smokeData[o + 8] = k / SMOKE_PER_FACTORY + (part[i + 5] ?? 0) * 0.1
            smokeData[o + 9] = 0
            n++
          }
        }
      }
      commit(smoke, n)
      const fireData = reserve(fire, Math.min(MAX_FIRE, burning))
      let f = 0
      for (const set of sets) {
        for (const [part, kind] of [
          [set.buildings, 0],
          [set.trees, 1],
        ] as const) {
          for (let i = 0; i < part.length && f < MAX_FIRE; i += STRIDE) {
            const rank = part[i + 5] ?? 0
            if (kind === 0 ? rank >= 0.08 : (rank * 7919) % 1 >= 0.25) continue
            const o = f * PARTICLE
            for (let j = 0; j < STRIDE; j++) fireData[o + j] = part[i + j] ?? 0
            fireData[o + 8] = (rank * 104729) % 1
            fireData[o + 9] = kind
            f++
          }
        }
      }
      const burningNow = shared.uLife3.value.x > 0.5 || shared.uLife2.value.w > 0.5
      commit(fire, f)
      fire.points.visible = f > 0 && burningNow
    },
    setFocal(pixels) {
      uFocal.value = pixels
    },
    tick(dt, altitude) {
      const t = Math.min(1, Math.max(0, (altitude - IMPOSTOR_FROM) / (IMPOSTOR_TO - IMPOSTOR_FROM)))
      uImpostor.value = 1 + (IMPOSTOR_GROW - 1) * t * t * (3 - 2 * t)
      const walk = crowdSize > 0 && altitude < WALK_BELOW && roads.length > 0
      if (!walk) {
        crowd.count = 0
        return
      }
      for (let i = 0; i < crowdSize; i++) {
        const r = walkRoad[i] ?? 0
        const road = roads[r]
        if (!road) continue
        const p = road.points
        let s = (walkT[i] ?? 0) + ((walkSpeed[i] ?? 0) * dt) / (roadLengths[r] ?? 1)
        if (s > 1 || s < 0) {
          s = s > 1 ? 2 - s : -s
          walkSpeed[i] = -(walkSpeed[i] ?? 0)
        }
        walkT[i] = s
        const last = p.length / 3 - 1
        const f = s * last
        const k = Math.min(last - 1, Math.floor(f))
        const u = f - k
        const wet = roadWet[r]
        // FEAT: ninguém anda sobre o mar; o trecho molhado da estrada fica sem pedestres
        if (wet && (wet[k] === 1 || wet[k + 1] === 1)) {
          crowd.setMatrixAt(i, hidden)
          continue
        }
        at.set(p[k * 3] ?? 0, p[k * 3 + 1] ?? 0, p[k * 3 + 2] ?? 0)
        next.set(p[k * 3 + 3] ?? 0, p[k * 3 + 4] ?? 0, p[k * 3 + 5] ?? 0)
        next.sub(at)
        at.addScaledVector(next, u)
        up.copy(at).normalize()
        across.crossVectors(next, up).normalize()
        at.addScaledVector(across, walkSide[i] ?? 0)
        turn.setFromUnitVectors(yAxis, up)
        matrix.compose(at, turn, unit)
        crowd.setMatrixAt(i, matrix)
      }
      crowd.count = crowdSize
      crowd.instanceMatrix.needsUpdate = true
    },
    people() {
      return crowd.count
    },
    dispose() {
      haloGeometry.dispose()
      haloMaterial.dispose()
      lines.geometry.dispose()
      lamps.geometry.dispose()
      lineMaterial.dispose()
      lampMaterial.dispose()
      for (const particles of [smoke, fire]) {
        particles.points.geometry.dispose()
        particles.material.dispose()
      }
      impostorGeometry.dispose()
      impostorMaterial.dispose()
      personGeometry.dispose()
      personMaterial.dispose()
      crowd.dispose()
    },
  }
}
