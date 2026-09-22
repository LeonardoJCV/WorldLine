import type { Material, Vector3 } from 'three'

export const DAY_FROM = -0.12
export const DAY_TO = 0.18
export const NIGHT_FLOOR = 0.05

export function shadeByDaySide(material: Material, sun: { value: Vector3 }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSun = sun
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurface;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSurface = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun;\nvarying vec3 vSurface;')
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight *= ${NIGHT_FLOOR.toFixed(2)} + ${(1 - NIGHT_FLOOR).toFixed(2)} * smoothstep(${DAY_FROM.toFixed(2)}, ${DAY_TO.toFixed(2)}, dot(normalize(vSurface), uSun));\n#include <opaque_fragment>`,
      )
  }
}

export const skyVertex = `
varying vec3 vNormalWorld;
varying vec3 vWorld;

void main() {
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const skyFragment = `
uniform vec3 uColor;
uniform vec3 uSun;

varying vec3 vNormalWorld;
varying vec3 vWorld;

void main() {
  vec3 normal = normalize(vNormalWorld);
  float away = dot(normal, normalize(vWorld - cameraPosition));
  float intensity = pow(clamp(0.68 + away, 0.0, 1.5), 5.0);
  float sun = dot(normalize(vWorld), uSun);
  float dusk = smoothstep(0.35, 0.0, sun) * smoothstep(-0.35, 0.0, sun);
  vec3 color = mix(uColor, vec3(1.0, 0.55, 0.3), dusk * 0.7);
  intensity *= 0.08 + 0.92 * smoothstep(-0.3, 0.2, sun);
  gl_FragColor = sRGBTransferEOTF(vec4(color, clamp(intensity * 0.35, 0.0, 0.6)));
  #include <colorspace_fragment>
}
`
