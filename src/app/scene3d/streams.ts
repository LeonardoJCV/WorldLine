import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  Points,
  RGBAFormat,
  ShaderMaterial,
} from 'three'
import { STRANDS } from '../current/normalize.ts'
import { STRAND_COLORS } from '../theme/palette.ts'
import { PATH_ROWS, type PathData } from './path.ts'
import { SAMPLES } from './space.ts'

export const OTHERS_WEIGHT = 0.4
export const OTHERS_BRIGHTNESS = 0.35
export const FLOW_SPEED = 0.03
export const JITTER = 0.06

export const INTENSITY_REFERENCE = 8000
export const MIN_INTENSITY = 0.32
export const MAX_INTENSITY = 1.8

export function streamIntensity(count: number): number {
  if (count <= 0) return MAX_INTENSITY
  return Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, Math.sqrt(INTENSITY_REFERENCE / count)))
}

const vertex = `
uniform sampler2D uPath;
uniform float uSamples;
uniform vec2 uAlive;
uniform float uTime;
uniform float uEmphasis;
uniform float uPixelRatio;
uniform float uIntensity;

attribute vec3 aSeed;
attribute vec3 aColor;
attribute vec3 aJitter;

varying vec3 vColor;
varying float vAlpha;

vec4 row(float r, float u) {
  float x = u * (uSamples - 1.0);
  float i = floor(x);
  float v = (r + 0.5) / ${PATH_ROWS}.0;
  vec4 a = texture2D(uPath, vec2((i + 0.5) / uSamples, v));
  vec4 b = texture2D(uPath, vec2((min(i + 1.0, uSamples - 1.0) + 0.5) / uSamples, v));
  return mix(a, b, x - i);
}

void main() {
  float strand = aSeed.x;
  float u = mix(uAlive.x, uAlive.y, fract(aSeed.y + uTime * ${FLOW_SPEED}));
  vec4 axis = row(0.0, u);
  vec4 first = row(1.0, u);
  vec4 second = row(2.0, u);
  float value = strand < 0.5 ? first.x : strand < 1.5 ? first.y : strand < 2.5 ? first.z
    : strand < 3.5 ? first.w : strand < 4.5 ? second.x : second.y;
  float radius = 0.42 * (1.0 + 1.3 * (1.0 - axis.w)) * (1.0 + 0.08 * aSeed.z);
  float angle = u * 36.0 + strand * 1.0471976 + uTime * 0.15;
  vec3 position = axis.xyz + vec3(0.0, cos(angle), sin(angle)) * radius + aJitter;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(
    (0.7 + 0.6 * value) * 3.2 * uPixelRatio * (14.0 / -view.z) * sqrt(uIntensity),
    1.5,
    20.0
  );
  vColor = aColor;
  vAlpha = min(
    1.0,
    step(0.5, second.z) * (0.55 + 0.45 * value) * uEmphasis *
      (0.35 + 0.65 * smoothstep(0.0, 0.5, u)) * uIntensity
  );
}
`

const fragment = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= a;
}
`

export function particleCounts(
  total: number,
  ids: readonly string[],
  focus: string,
): Map<string, number> {
  const weight = (id: string) => (id === focus ? 1 : OTHERS_WEIGHT)
  const sum = ids.reduce((acc, id) => acc + weight(id), 0)
  const counts = new Map<string, number>()
  for (const id of ids) {
    const share = sum === 0 ? 0 : (total * weight(id)) / sum
    counts.set(id, Math.floor(share / STRANDS.length) * STRANDS.length)
  }
  return counts
}

export interface Stream {
  readonly points: Points
  setPath(path: PathData): void
  setEmphasis(focused: boolean): void
  setTime(time: number): void
  setPixelRatio(dpr: number): void
  readonly count: number
  dispose(): void
}

export function createStream(count: number, seed: number): Stream {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  const seeds = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const jitters = new Float32Array(count * 3)
  const linear = new Color()
  let state = seed >>> 0 || 1
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const strand = i % STRANDS.length
    const { r, g, b } = linear.set(STRAND_COLORS[STRANDS[strand] ?? 'population'])
    seeds.set([strand, next(), next() * 2 - 1], i * 3)
    colors.set([r, g, b], i * 3)
    jitters.set(
      [(next() * 2 - 1) * JITTER, (next() * 2 - 1) * JITTER, (next() * 2 - 1) * JITTER],
      i * 3,
    )
  }
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3))
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
  geometry.setAttribute('aJitter', new BufferAttribute(jitters, 3))

  const texture = new DataTexture(
    new Float32Array(SAMPLES * PATH_ROWS * 4),
    SAMPLES,
    PATH_ROWS,
    RGBAFormat,
    FloatType,
  )
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true

  const uniforms = {
    uPath: { value: texture },
    uSamples: { value: SAMPLES },
    uAlive: { value: [0, 0] as number[] },
    uTime: { value: 0 },
    uEmphasis: { value: 1 },
    uPixelRatio: { value: 1 },
    uIntensity: { value: streamIntensity(count) },
  }
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false

  return {
    points,
    count,
    setPath(path) {
      texture.image.data = path.data
      texture.needsUpdate = true
      uniforms.uAlive.value = [path.alive[0], path.alive[1]]
    },
    setEmphasis(focused) {
      uniforms.uEmphasis.value = focused ? 1 : OTHERS_BRIGHTNESS
    },
    setTime(time) {
      uniforms.uTime.value = time
    },
    setPixelRatio(dpr) {
      uniforms.uPixelRatio.value = dpr
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
