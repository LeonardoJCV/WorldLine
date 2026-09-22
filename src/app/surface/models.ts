import { BufferAttribute, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hexToRgb } from '../theme/color.ts'

export function painted(geometry: BufferGeometry, hex: string): BufferGeometry {
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

export function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) throw new Error('could not merge model parts')
  return geometry
}

// FEAT: base leste/norte sobre a esfera, igual à de tangentFrame em cube.ts
export const TANGENT_FRAME = `
vec3 ref = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 east = normalize(cross(ref, up));
vec3 north = cross(up, east);
`
