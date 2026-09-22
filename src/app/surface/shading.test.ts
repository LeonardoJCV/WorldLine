import { MeshStandardMaterial, Vector3, type WebGLProgramParametersWithUniforms } from 'three'
import { describe, expect, it } from 'vitest'
import { shadeByDaySide, skyFragment } from './shading.ts'

describe('shadeByDaySide', () => {
  it('darkens the terrain by the position on the planet, not by the slope', () => {
    const material = new MeshStandardMaterial()
    const sun = { value: new Vector3(1, 0, 0) }
    shadeByDaySide(material, sun)
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    } as unknown as WebGLProgramParametersWithUniforms
    material.onBeforeCompile(shader, undefined as never)
    expect(shader.uniforms.uSun).toBe(sun)
    expect(shader.vertexShader).toContain('vSurface = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(shader.fragmentShader).toContain(
      'outgoingLight *= 0.05 + 0.95 * smoothstep(-0.12, 0.18, dot(normalize(vSurface), uSun));',
    )
    expect(shader.fragmentShader.indexOf('outgoingLight *=')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <opaque_fragment>'),
    )
  })
})

describe('skyFragment', () => {
  it('converts its colour like the other planet shaders', () => {
    expect(skyFragment).toContain('sRGBTransferEOTF')
    expect(skyFragment).toContain('#include <colorspace_fragment>')
  })
})
