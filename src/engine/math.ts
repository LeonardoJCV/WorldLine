const LN2_HI = 6.9314718036912381649e-1
const LN2_LO = 1.90821492927058770002e-10
const INV_LN2 = 1.442695040888963387
const TWO_POW_54 = 18014398509481984
const MIN_NORMAL = 2.2250738585072014e-308

const view = new DataView(new ArrayBuffer(8))

function pow2(k: number): number {
  view.setUint32(0, ((k + 1023) << 20) >>> 0)
  view.setUint32(4, 0)
  return view.getFloat64(0)
}

// Só + − × ÷ e operações de bits: resultado idêntico em qualquer engine JS
export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x > 709.782712893384) return Infinity
  if (x < -708.3964185322641) return 0
  const k = Math.round(x * INV_LN2)
  const r = x - k * LN2_HI - k * LN2_LO
  let series = 1
  for (let n = 13; n >= 1; n--) series = 1 + (series * r) / n
  return k > 1023 ? series * pow2(k - 1) * 2 : series * pow2(k)
}

export function ln(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN
  if (x === 0) return -Infinity
  if (x === Infinity) return Infinity
  let e = 0
  if (x < MIN_NORMAL) {
    x *= TWO_POW_54
    e = -54
  }
  view.setFloat64(0, x)
  const high = view.getUint32(0)
  e += ((high >>> 20) & 0x7ff) - 1023
  view.setUint32(0, ((high & 0x000fffff) | 0x3ff00000) >>> 0)
  let m = view.getFloat64(0)
  if (m > Math.SQRT2) {
    m *= 0.5
    e += 1
  }
  const s = (m - 1) / (m + 1)
  const s2 = s * s
  let series = 1 / 21
  for (let n = 19; n >= 1; n -= 2) series = 1 / n + s2 * series
  return e * LN2_HI + (e * LN2_LO + 2 * s * series)
}

export function pow(x: number, y: number): number {
  if (y === 0) return 1
  if (x === 0) return 0
  return exp(y * ln(x))
}

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
