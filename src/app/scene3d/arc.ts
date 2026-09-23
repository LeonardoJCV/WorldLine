import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Tier } from '../graphics/settings.ts'
import type { Vec3 } from './camera.ts'

export const ARC_SPEED = 0.35
export const ARC_JITTER = 0.05
// FIX: menor e mais fraco para não estourar em branco somado ao bloom e ao eco
export const ARC_POINT_SIZE = 2.0
export const ARC_ALPHA = 0.65
export const ARC_COLOR = 0xf2d9a8
export const ARC_LINE_SAMPLES = 24

export const ARC_PARTICLES: Readonly<Record<Tier, number>> = { low: 0, high: 120, ultra: 260 }

const vertex = `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform vec3 uControl;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;

attribute float aOffset;
attribute vec3 aJitter;

varying float vAlpha;

void main() {
  float t = fract(aOffset + uTime * ${ARC_SPEED});
  vec3 a = mix(uFrom, uControl, t);
  vec3 b = mix(uControl, uTo, t);
  // FEAT: a opacidade some nas duas pontas, e o jitter some junto para não flutuar fora da corrente
  float edge = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t);
  vec3 position = mix(a, b, t) + aJitter * edge;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uSize * uPixelRatio * (14.0 / -view.z), 1.0, 14.0);
  vAlpha = edge * ${ARC_ALPHA};
}
`

const fragment = `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= a;
}
`

export interface Arc {
  readonly object: Points | Line
  setEnds(from: Vec3, to: Vec3, control: Vec3): void
  setTime(time: number): void
  setPixelRatio(dpr: number): void
  dispose(): void
}

function bezierPoint(from: Vec3, control: Vec3, to: Vec3, t: number): Vector3 {
  const a = new Vector3(...from).lerp(new Vector3(...control), t)
  const b = new Vector3(...control).lerp(new Vector3(...to), t)
  return a.lerp(b, t)
}

function createLineArc(): Arc {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(ARC_LINE_SAMPLES * 3), 3))
  const material = new LineBasicMaterial({
    color: ARC_COLOR,
    transparent: true,
    opacity: 0.8,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const line = new Line(geometry, material)
  line.frustumCulled = false
  return {
    object: line,
    setEnds(from, to, control) {
      const position = geometry.getAttribute('position') as BufferAttribute
      for (let i = 0; i < ARC_LINE_SAMPLES; i++) {
        const t = i / (ARC_LINE_SAMPLES - 1)
        const point = bezierPoint(from, control, to, t)
        position.setXYZ(i, point.x, point.y, point.z)
      }
      position.needsUpdate = true
    },
    setTime() {},
    setPixelRatio() {},
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

function createParticleArc(count: number, seed: number): Arc {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  const offsets = new Float32Array(count)
  const jitters = new Float32Array(count * 3)
  let state = seed >>> 0 || 1
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < count; i++) {
    offsets[i] = i / count
    jitters.set(
      [(next() * 2 - 1) * ARC_JITTER, (next() * 2 - 1) * ARC_JITTER, (next() * 2 - 1) * ARC_JITTER],
      i * 3,
    )
  }
  geometry.setAttribute('aOffset', new BufferAttribute(offsets, 1))
  geometry.setAttribute('aJitter', new BufferAttribute(jitters, 3))

  const uniforms = {
    uFrom: { value: new Vector3() },
    uTo: { value: new Vector3() },
    uControl: { value: new Vector3() },
    uTime: { value: 0 },
    uSize: { value: ARC_POINT_SIZE },
    uColor: { value: new Color(ARC_COLOR) },
    uPixelRatio: { value: 1 },
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
    object: points,
    setEnds(from, to, control) {
      uniforms.uFrom.value.set(...from)
      uniforms.uTo.value.set(...to)
      uniforms.uControl.value.set(...control)
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
    },
  }
}

export function createArc(tier: Tier, count: number, seed: number): Arc {
  return tier === 'low' ? createLineArc() : createParticleArc(count, seed)
}
