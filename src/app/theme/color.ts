export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function rgba(rgb: Rgb, alpha: number): string {
  const channel = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255)
  return `rgba(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])}, ${alpha})`
}

export function withAlpha(hex: string, alpha: number): string {
  return rgba(hexToRgb(hex), alpha)
}
