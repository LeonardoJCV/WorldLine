import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  Vector4,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hexToRgb } from '../theme/color.ts'
import type { LifeUniforms } from './civilization.ts'
import { OBJECT_KINDS, STRIDE, type ObjectKind, type ObjectSet } from './objects.ts'
import { DAY_FROM, DAY_TO, NIGHT_FLOOR } from './shading.ts'
import type { Vec3 } from './cube.ts'
import { MAX_SITES } from './sites.ts'

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

function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) throw new Error('could not merge model parts')
  return geometry
}

const MODELS: Readonly<Record<ObjectKind, () => BufferGeometry>> = {
  trees: () =>
    merged([
      painted(new ConeGeometry(0.0005, 0.0015, 5, 1, true).translate(0, 0.00105, 0), '#2f8a47'),
      painted(
        new CylinderGeometry(0.0001, 0.00013, 0.0006, 3, 1, true).translate(0, 0.0001, 0),
        '#6b4a2f',
      ),
    ]),
  buildings: () =>
    merged([
      painted(new BoxGeometry(0.0009, BODY_TOP, 0.0009).translate(0, BODY_TOP / 2, 0), '#e8e4dc'),
      painted(
        new ConeGeometry(0.00075, 0.0005, 4, 1, true)
          .rotateY(Math.PI / 4)
          .translate(0, BODY_TOP + 0.00025, 0),
        '#b0563a',
      ),
    ]),
  fields: () => painted(new BoxGeometry(0.003, 0.0004, 0.002).translate(0, 0.0002, 0), '#ffffff'),
  animals: () =>
    painted(new BoxGeometry(0.00045, 0.0003, 0.00025).translate(0, 0.00016, 0), '#f0e8d8'),
  boats: () =>
    merged([
      painted(new BoxGeometry(0.0009, 0.00025, 0.00035).translate(0, 0.00012, 0), '#f2efe6'),
      painted(new ConeGeometry(0.00022, 0.0006, 3, 1, true).translate(0, 0.00055, 0), '#e6e4f5'),
    ]),
  factories: () =>
    merged([
      painted(new BoxGeometry(0.0014, 0.0008, 0.001).translate(0, 0.0004, 0), '#8a7f78'),
      painted(
        new CylinderGeometry(0.00012, 0.00016, 0.0016, 5).translate(0.0004, 0.0012, 0),
        '#5a4e48',
      ),
    ]),
  mines: () =>
    painted(new ConeGeometry(0.0009, 0.0006, 4, 1, true).translate(0, 0.0003, 0), '#b08a5e'),
}

const BODY_TOP = 0.0012
const SKY_FILL = 0.12
const FADE_FROM = 0.55

const BUCKETS = 256

function bucketOf(rank: number): number {
  return Math.min(BUCKETS - 1, Math.max(0, Math.floor(rank * BUCKETS)))
}

const KIND_INDEX: Readonly<Record<ObjectKind, number>> = {
  trees: 0,
  buildings: 1,
  fields: 2,
  animals: 3,
  boats: 4,
  factories: 5,
  mines: 6,
}

const vertexPrelude = `
attribute vec4 aPlace;
attribute vec4 aData;
uniform vec4 uCity[${MAX_SITES}];
uniform vec4 uCity2[${MAX_SITES}];
uniform vec4 uLife;
uniform vec4 uLife2;
uniform vec4 uLife3;
uniform vec4 uView;
uniform float uGrow;
uniform float uThin;
varying vec3 vTint;
varying float vWindow;
varying float vLocalY;
varying vec3 vSurface;
`

const vertexBody = `
vec3 up = normalize(aPlace.xyz);
vec3 ref = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 east = normalize(cross(ref, up));
vec3 north = cross(up, east);
float spin = aPlace.w;
float t = uLife3.z;
vec3 side = east * cos(spin) + north * sin(spin);
// FIX: base destra; a canhota espelhava os modelos e o descarte de faces mostrava o avesso
vec3 front = cross(side, up);
float rank = aData.y;
int site = int(aData.z);
float ring = aData.w;
bool known = site >= 0 && site < ${MAX_SITES};
vec4 city = known ? uCity[site] : vec4(0.0);
vec4 city2 = known ? uCity2[site] : vec4(0.0);
bool alive = city.y > 0.5 && city.y < 1.5;
bool ruin = city.y > 1.5;
float show = 1.0;
float lift = 1.0;
vec3 shift = vec3(0.0);
vTint = vec3(1.0);
vWindow = 0.0;
#if LIFE_KIND == 0
  show = rank < uLife.x * uThin ? 1.0 : 0.0;
  if (alive && ring < city2.z) show = 0.0;
  if (uLife2.w > 0.5 && rank > uLife.x * 0.7) vTint = vec3(0.3, 0.24, 0.2);
#elif LIFE_KIND == 1
  show = (alive || ruin) && ring <= max(city.x, 0.02) && rank < 0.92 ? 1.0 : 0.0;
  lift = alive ? city.z * (1.0 + 1.5 * (1.0 - ring / max(city.x, 0.001))) : city.z;
  // FIX: tom negativo pede cinza; as ruínas perdem a cor dos telhados
  if (ruin) vTint = vec3(-0.55, -0.54, -0.53);
  vWindow = alive ? city.w : 0.0;
#elif LIFE_KIND == 2
  show = alive && ring >= city2.x && ring <= city2.y && rank < 0.85 ? 1.0 : 0.0;
  float crop = fract(spin * 1.618);
  vTint = crop < 0.3 ? vec3(0.89, 0.78, 0.35)
    : crop < 0.55 ? vec3(0.6, 0.8, 0.36)
    : crop < 0.8 ? vec3(0.86, 0.6, 0.3)
    : vec3(0.78, 0.68, 0.46);
  if (uLife2.z > 0.5) vTint *= vec3(0.9, 0.72, 0.5);
#elif LIFE_KIND == 3
  bool pasture = alive && ring < city2.y * 1.2;
  show = rank < (pasture ? uLife.y : uLife.z * 0.6) * uThin ? 1.0 : 0.0;
  if (!pasture) vTint = vec3(0.62, 0.45, 0.3);
  shift = (side * sin(t * 0.4 + spin * 3.0) + front * cos(t * 0.3 + spin)) * 0.0006;
#elif LIFE_KIND == 4
  show = alive && rank < uLife.w ? 1.0 : 0.0;
  shift = (side * cos(t * 0.15 + spin) + front * sin(t * 0.15 + spin)) * 0.0018;
#elif LIFE_KIND == 5
  show = alive && rank < uLife2.x ? 1.0 : 0.0;
#else
  show = alive && rank < uLife2.y ? 1.0 : 0.0;
#endif
float near = dot(up, uView.xyz);
float away = length(up - uView.xyz * near) / max(near, 0.001);
float fade = near > 0.0 ? 1.0 - smoothstep(uView.w * FADE_FROM, uView.w, away) : 0.0;
float scale = aData.x * show * fade * uGrow;
float rise = min(position.y, BODY_TOP) * lift + max(position.y - BODY_TOP, 0.0);
vec3 transformed = aPlace.xyz + shift + (side * position.x + up * rise + front * position.z) * scale;
vLocalY = position.y;
vSurface = aPlace.xyz;
`

const fragmentPrelude = `
uniform vec3 uSun;
varying vec3 vTint;
varying float vWindow;
varying float vLocalY;
varying vec3 vSurface;
`

const fragmentLight = `
float dayLight = smoothstep(DAY_FROM, DAY_TO, dot(normalize(vSurface), uSun));
outgoingLight += diffuseColor.rgb * SKY_FILL;
outgoingLight *= NIGHT_FLOOR + (1.0 - NIGHT_FLOOR) * dayLight;
float rows = step(0.5, fract(vLocalY * 2600.0)) * step(vLocalY, BODY_TOP);
outgoingLight += vec3(1.0, 0.78, 0.45) * vWindow * rows * (1.0 - dayLight) * 1.2;
#include <opaque_fragment>
`

export interface LifeShared {
  readonly uCity: { value: Vector4[] }
  readonly uCity2: { value: Vector4[] }
  readonly uLife: { value: Vector4 }
  readonly uLife2: { value: Vector4 }
  readonly uLife3: { value: Vector4 }
  readonly uView: { value: Vector4 }
  readonly uGrow: { value: number }
  readonly uThin: { value: number }
  readonly uSun: { value: Vector3 }
}

export interface LifeOptions {
  readonly sun: { value: Vector3 }
}

export interface Life {
  readonly group: Group
  readonly shared: LifeShared
  setTiles(sets: readonly ObjectSet[]): void
  setUniforms(uniforms: LifeUniforms): void
  setTime(time: number): void
  setView(center: Vec3, reach: number, grow: number): void
  count(): number
  drawn(): number
  dispose(): void
}

interface Layer {
  readonly kind: ObjectKind
  readonly geometry: InstancedBufferGeometry
  readonly material: MeshStandardMaterial
  readonly mesh: Mesh
  buffer: InstancedInterleavedBuffer | null
  readonly start: Uint32Array
}

export function createLife(options: LifeOptions): Life {
  const group = new Group()
  const shared: LifeShared = {
    uCity: { value: Array.from({ length: MAX_SITES }, () => new Vector4()) },
    uCity2: { value: Array.from({ length: MAX_SITES }, () => new Vector4()) },
    uLife: { value: new Vector4() },
    uLife2: { value: new Vector4() },
    uLife3: { value: new Vector4() },
    uView: { value: new Vector4() },
    uGrow: { value: 1 },
    uThin: { value: 1 },
    uSun: options.sun,
  }
  const layers: Layer[] = OBJECT_KINDS.map((kind) => {
    const model = MODELS[kind]()
    const geometry = new InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'color']) {
      const attribute = model.getAttribute(name)
      if (attribute) geometry.setAttribute(name, attribute)
    }
    model.dispose()
    geometry.instanceCount = 0
    const material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
    })
    material.defines = {
      LIFE_KIND: KIND_INDEX[kind],
      BODY_TOP: BODY_TOP.toFixed(5),
      SKY_FILL: SKY_FILL.toFixed(2),
      FADE_FROM: FADE_FROM.toFixed(2),
      DAY_FROM: DAY_FROM.toFixed(2),
      DAY_TO: DAY_TO.toFixed(2),
      NIGHT_FLOOR: NIGHT_FLOOR.toFixed(2),
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexPrelude}`)
        .replace('#include <begin_vertex>', vertexBody)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentPrelude}`)
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = vTint.x < 0.0 ? dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * -vTint : diffuseColor.rgb * vTint;',
        )
        .replace('#include <opaque_fragment>', fragmentLight)
    }
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.visible = false
    group.add(mesh)
    const layer: Layer = {
      kind,
      geometry,
      material,
      mesh,
      buffer: null,
      start: new Uint32Array(BUCKETS + 1),
    }
    return layer
  })
  let total = 0

  function limit(): void {
    const life = shared.uLife.value
    const life2 = shared.uLife2.value
    const thin = shared.uThin.value
    const ceiling: Readonly<Record<ObjectKind, number>> = {
      trees: life.x * thin,
      buildings: 0.92,
      fields: 0.85,
      animals: Math.max(life.y, life.z * 0.6) * thin,
      boats: life.w,
      factories: life2.x,
      mines: life2.y,
    }
    for (const layer of layers) {
      const count = layer.start[Math.min(BUCKETS, Math.ceil(ceiling[layer.kind] * BUCKETS))] ?? 0
      layer.geometry.instanceCount = count
      layer.mesh.visible = count > 0
    }
  }

  return {
    group,
    shared,
    setTiles(sets) {
      total = 0
      for (const layer of layers) {
        const size = sets.reduce((sum, set) => sum + set[layer.kind].length, 0)
        let buffer = layer.buffer
        if (!buffer || buffer.array.length < size) {
          // FIX: o buffer só cresce (em dobro); ao crescer, o descarte da geometria libera o antigo na GPU
          if (buffer) layer.geometry.dispose()
          buffer = new InstancedInterleavedBuffer(
            new Float32Array(Math.max(size, (buffer?.array.length ?? 0) * 2, STRIDE * 64)),
            STRIDE,
          )
          layer.buffer = buffer
          layer.geometry.setAttribute('aPlace', new InterleavedBufferAttribute(buffer, 4, 0))
          layer.geometry.setAttribute('aData', new InterleavedBufferAttribute(buffer, 4, 4))
        }
        const data = buffer.array
        // FEAT: ordena por faixa de rank para desenhar só o prefixo que pode aparecer
        const start = layer.start
        start.fill(0)
        for (const set of sets) {
          const part = set[layer.kind]
          for (let i = 5; i < part.length; i += STRIDE) {
            const b = bucketOf(part[i] ?? 0) + 1
            start[b] = (start[b] ?? 0) + 1
          }
        }
        for (let b = 0; b < BUCKETS; b++) start[b + 1] = (start[b + 1] ?? 0) + (start[b] ?? 0)
        const cursor = start.slice(0, BUCKETS)
        for (const set of sets) {
          const part = set[layer.kind]
          for (let i = 0; i < part.length; i += STRIDE) {
            const b = bucketOf(part[i + 5] ?? 0)
            const at = cursor[b] ?? 0
            cursor[b] = at + 1
            for (let k = 0; k < STRIDE; k++) data[at * STRIDE + k] = part[i + k] ?? 0
          }
        }
        buffer.clearUpdateRanges()
        buffer.addUpdateRange(0, Math.max(size, STRIDE))
        buffer.needsUpdate = true
        total += size / STRIDE
      }
      limit()
    },
    setUniforms(u) {
      for (let i = 0; i < MAX_SITES; i++) {
        shared.uCity.value[i]?.fromArray(u.city, i * 4)
        shared.uCity2.value[i]?.fromArray(u.city2, i * 4)
      }
      shared.uLife.value.fromArray(u.life)
      shared.uLife2.value.fromArray(u.life2)
      shared.uLife3.value.fromArray(u.life3)
      limit()
    },
    setTime(time) {
      shared.uLife3.value.z = time
    },
    setView(center, reach, grow) {
      shared.uView.value.set(center[0], center[1], center[2], reach)
      shared.uGrow.value = grow
      const thin = 1 / (grow * grow)
      if (thin !== shared.uThin.value) {
        shared.uThin.value = thin
        limit()
      }
    },
    count() {
      return total
    },
    drawn() {
      return layers.reduce((sum, layer) => sum + layer.geometry.instanceCount, 0)
    },
    dispose() {
      for (const layer of layers) {
        layer.geometry.dispose()
        layer.material.dispose()
      }
    },
  }
}
