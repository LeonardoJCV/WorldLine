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
      painted(new ConeGeometry(0.0005, 0.0015, 5).translate(0, 0.00105, 0), '#2f8a47'),
      painted(new CylinderGeometry(0.0001, 0.00013, 0.0006, 4).translate(0, 0.0001, 0), '#6b4a2f'),
    ]),
  buildings: () =>
    merged([
      painted(new BoxGeometry(0.0009, BODY_TOP, 0.0009).translate(0, BODY_TOP / 2, 0), '#e8e4dc'),
      painted(
        new ConeGeometry(0.00075, 0.0005, 4)
          .rotateY(Math.PI / 4)
          .translate(0, BODY_TOP + 0.00025, 0),
        '#b0563a',
      ),
    ]),
  fields: () => painted(new BoxGeometry(0.0022, 0.0004, 0.0015).translate(0, 0.0002, 0), '#d9c35a'),
  animals: () =>
    painted(new BoxGeometry(0.00045, 0.0003, 0.00025).translate(0, 0.00016, 0), '#f0e8d8'),
  boats: () =>
    merged([
      painted(new BoxGeometry(0.0009, 0.00025, 0.00035).translate(0, 0.00012, 0), '#f2efe6'),
      painted(new ConeGeometry(0.00022, 0.0006, 3).translate(0, 0.00055, 0), '#e6e4f5'),
    ]),
  factories: () =>
    merged([
      painted(new BoxGeometry(0.0014, 0.0008, 0.001).translate(0, 0.0004, 0), '#8a7f78'),
      painted(
        new CylinderGeometry(0.00012, 0.00016, 0.0016, 5).translate(0.0004, 0.0012, 0),
        '#5a4e48',
      ),
    ]),
  mines: () => painted(new ConeGeometry(0.0009, 0.0006, 4).translate(0, 0.0003, 0), '#4a3f3a'),
}

const BODY_TOP = 0.0012
const SKY_FILL = 0.12

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
varying vec3 vTint;
varying float vWindow;
varying float vLocalY;
varying vec3 vSurface;
`

const vertexNormal = `
#include <beginnormal_vertex>
{
  vec3 u0 = normalize(aPlace.xyz);
  vec3 r0 = abs(u0.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 e0 = normalize(cross(r0, u0));
  vec3 n0 = cross(u0, e0);
  vec3 s0 = e0 * cos(aPlace.w) + n0 * sin(aPlace.w);
  objectNormal = normalize(s0 * objectNormal.x + u0 * objectNormal.y + cross(u0, s0) * objectNormal.z);
}
`

const vertexBody = `
vec3 up = normalize(aPlace.xyz);
vec3 ref = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 east = normalize(cross(ref, up));
vec3 north = cross(up, east);
float spin = aPlace.w;
float t = uLife3.z;
vec3 side = east * cos(spin) + north * sin(spin);
vec3 front = cross(up, side);
float rank = aData.y;
int site = int(aData.z + 0.5);
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
  show = rank < uLife.x ? 1.0 : 0.0;
  if (alive && ring < city2.z) show = 0.0;
  if (uLife2.w > 0.5 && rank > uLife.x * 0.7) vTint = vec3(0.3, 0.24, 0.2);
#elif LIFE_KIND == 1
  show = (alive || ruin) && ring <= max(city.x, 0.02) && rank < 0.92 ? 1.0 : 0.0;
  lift = alive ? city.z * (1.0 + 1.5 * (1.0 - ring / max(city.x, 0.001))) : city.z;
  if (ruin) vTint = vec3(0.45, 0.43, 0.42);
  vWindow = alive ? city.w : 0.0;
#elif LIFE_KIND == 2
  show = alive && ring >= city2.x && ring <= city2.y && rank < 0.85 ? 1.0 : 0.0;
  if (uLife2.z > 0.5) vTint = vec3(0.72, 0.52, 0.32);
#elif LIFE_KIND == 3
  bool pasture = alive && ring < city2.y * 1.2;
  show = pasture ? (rank < uLife.y ? 1.0 : 0.0) : (rank < uLife.z * 0.6 ? 1.0 : 0.0);
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
float scale = aData.x * show;
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
float dayLight = smoothstep(-0.12, 0.18, dot(normalize(vSurface), uSun));
outgoingLight += diffuseColor.rgb * SKY_FILL;
outgoingLight *= 0.05 + 0.95 * dayLight;
float rows = step(0.5, fract(vLocalY * 2600.0)) * step(vLocalY, BODY_TOP);
outgoingLight += vec3(1.0, 0.78, 0.45) * vWindow * rows * (1.0 - dayLight) * 0.9;
#include <opaque_fragment>
`

export interface LifeShared {
  readonly uCity: { value: Vector4[] }
  readonly uCity2: { value: Vector4[] }
  readonly uLife: { value: Vector4 }
  readonly uLife2: { value: Vector4 }
  readonly uLife3: { value: Vector4 }
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
  count(): number
  dispose(): void
}

interface Layer {
  readonly kind: ObjectKind
  readonly geometry: InstancedBufferGeometry
  readonly model: BufferGeometry
  readonly material: MeshStandardMaterial
  readonly mesh: Mesh
}

export function createLife(options: LifeOptions): Life {
  const group = new Group()
  const shared: LifeShared = {
    uCity: { value: Array.from({ length: MAX_SITES }, () => new Vector4()) },
    uCity2: { value: Array.from({ length: MAX_SITES }, () => new Vector4()) },
    uLife: { value: new Vector4() },
    uLife2: { value: new Vector4() },
    uLife3: { value: new Vector4() },
    uSun: options.sun,
  }
  const layers: Layer[] = OBJECT_KINDS.map((kind) => {
    const model = MODELS[kind]()
    const geometry = new InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'color']) {
      const attribute = model.getAttribute(name)
      if (attribute) geometry.setAttribute(name, attribute)
    }
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
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexPrelude}`)
        .replace('#include <beginnormal_vertex>', vertexNormal)
        .replace('#include <begin_vertex>', vertexBody)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentPrelude}`)
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= vTint;',
        )
        .replace('#include <opaque_fragment>', fragmentLight)
    }
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.visible = false
    group.add(mesh)
    return { kind, geometry, model, material, mesh }
  })
  let total = 0

  return {
    group,
    shared,
    setTiles(sets) {
      total = 0
      for (const layer of layers) {
        const size = sets.reduce((sum, set) => sum + set[layer.kind].length, 0)
        const data = new Float32Array(size)
        let offset = 0
        for (const set of sets) {
          data.set(set[layer.kind], offset)
          offset += set[layer.kind].length
        }
        const buffer = new InstancedInterleavedBuffer(data, STRIDE)
        // FIX: trocar o buffer exige descartar o antigo na GPU para não vazar memória
        layer.geometry.dispose()
        layer.geometry.setAttribute('aPlace', new InterleavedBufferAttribute(buffer, 4, 0))
        layer.geometry.setAttribute('aData', new InterleavedBufferAttribute(buffer, 4, 4))
        layer.geometry.instanceCount = size / STRIDE
        total += size / STRIDE
        layer.mesh.visible = size > 0
      }
    },
    setUniforms(u) {
      for (let i = 0; i < MAX_SITES; i++) {
        shared.uCity.value[i]?.fromArray(u.city, i * 4)
        shared.uCity2.value[i]?.fromArray(u.city2, i * 4)
      }
      shared.uLife.value.fromArray(u.life)
      shared.uLife2.value.fromArray(u.life2)
      shared.uLife3.value.fromArray(u.life3)
    },
    setTime(time) {
      shared.uLife3.value.z = time
    },
    count() {
      return total
    },
    dispose() {
      for (const layer of layers) {
        layer.geometry.dispose()
        layer.model.dispose()
        layer.material.dispose()
      }
    },
  }
}
