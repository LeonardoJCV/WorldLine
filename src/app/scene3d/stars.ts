import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three'

export function starField(seed: number): Points {
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
