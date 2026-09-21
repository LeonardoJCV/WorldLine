const noise = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int octaves) {
  float amplitude = 0.5;
  float sum = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    sum += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}
`

export const planetVertex = `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vPosition = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const planetFragment = `
uniform vec3 uOffset;
uniform float uSea;
uniform vec3 uOceanDeep;
uniform vec3 uOceanShallow;
uniform vec3 uVegetationColor;
uniform vec3 uArid;
uniform vec3 uSnow;
uniform vec3 uLight;
uniform float uVegetation;
uniform float uLights;
uniform float uFamine;
uniform float uBlight;
uniform float uUnrest;
uniform float uExtinct;
uniform float uTime;
uniform float uClouds;
uniform float uRing;
uniform vec3 uCenter;
uniform float uScale;
uniform vec3 uRingNormal;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorld;
#if DETAIL >= 2
uniform mat4 modelMatrix;
#endif
${noise}

float heightAt(vec3 p) {
  return fbm(p * 2.2 + uOffset, DETAIL >= 2 ? 7 : 5);
}

void main() {
  vec3 p = normalize(vPosition);
  float height = heightAt(p);
  float land = smoothstep(uSea, uSea + 0.015, height);
  float moisture = fbm(p * 4.0 + uOffset.zxy, 5);
  vec3 normal = normalize(vNormal);

#if DETAIL >= 2
  // FEAT: relevo com normais derivadas do ruído
  float e = 0.004;
  vec3 tangent = normalize(cross(p, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 bitangent = cross(p, tangent);
  float hx = heightAt(normalize(p + tangent * e));
  float hy = heightAt(normalize(p + bitangent * e));
  vec3 bump = (tangent * (height - hx) + bitangent * (height - hy)) * (land * 18.0);
  normal = normalize(normal + mat3(modelMatrix) * bump);
#endif

  float depth = smoothstep(uSea - 0.12, uSea, height);
  vec3 ocean = mix(uOceanDeep, uOceanShallow, depth);
  float green = clamp(uVegetation * (0.6 + 0.8 * moisture) - uBlight * fbm(p * 9.0 + uOffset, 5) * 0.9, 0.0, 1.0);
  vec3 ground = mix(uArid, uVegetationColor, green);
  ground = mix(ground, ground * 0.45, uFamine * smoothstep(0.4, 0.7, moisture));
  ground = mix(ground, uSnow, smoothstep(0.78, 0.92, abs(p.y) + (height - uSea) * 0.6));

  vec3 surface = mix(ocean, ground, land);
  float gray = dot(surface, vec3(0.3, 0.59, 0.11));
  surface = mix(surface, vec3(gray) * 0.6, uExtinct);

  float lambert = dot(normal, uLight);
  float day = smoothstep(-0.15, 0.25, lambert);
  float shade = 1.0;

#if DETAIL >= 1
  float cover = smoothstep(0.45, 0.75, fbm(normalize(p + uLight * 0.02) * 3.0 + uOffset + vec3(uTime * 0.01, 0.0, 0.0), 5));
  shade *= 1.0 - 0.35 * cover * uClouds;
#endif

#if DETAIL >= 2
  // FEAT: sombra do anel sobre o planeta
  float facing = dot(uLight, uRingNormal);
  if (uRing > 0.0 && abs(facing) > 1e-3) {
    float s = dot(uCenter - vWorld, uRingNormal) / facing;
    if (s > 0.0) {
      float r = length(vWorld + uLight * s - uCenter) / uScale;
      float band = smoothstep(1.25, 1.32, r) * (1.0 - smoothstep(1.48, 1.55, r));
      shade *= 1.0 - 0.45 * band * uRing;
    }
  }
#endif

  vec3 color = surface * (0.08 + 0.92 * day * shade);

#if DETAIL >= 2
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 halfway = normalize(uLight + view);
  float glint = pow(max(dot(normal, halfway), 0.0), 60.0) * (1.0 - land) * day;
  color += vec3(0.9, 0.95, 1.0) * glint * 0.6 * (1.0 - uExtinct);
  float coast = 1.0 - smoothstep(0.0, 0.06, abs(height - uSea));
  float clusters = smoothstep(0.5, 0.72, noise(p * 14.0 + uOffset));
  float grid = step(1.0 - uLights * 0.55, noise(p * 90.0 + uOffset));
  float cities = grid * land * (0.25 + 0.75 * max(coast, clusters)) * (1.0 - day);
#else
  float cities = step(1.0 - uLights * 0.35, noise(p * 60.0 + uOffset)) * land * (1.0 - day);
#endif

  float pulse = uUnrest * (0.5 + 0.5 * sin(uTime * 3.0 + height * 40.0));
  color += vec3(1.0, 0.78, 0.45) * cities * (0.9 + pulse);

  // FIX: sombreamento ajustado em sRGB; volta ao linear e codifica uma vez só
  gl_FragColor = sRGBTransferEOTF(vec4(color, 1.0));
  #include <colorspace_fragment>
}
`

export const cloudVertex = planetVertex

export const cloudFragment = `
uniform vec3 uOffset;
uniform vec3 uLight;
uniform float uTime;
uniform float uClouds;
uniform float uHaze;
uniform vec3 uSmog;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorld;
${noise}

void main() {
  vec3 p = normalize(vPosition);
  float density = smoothstep(0.52, 0.82, fbm(p * 3.0 + uOffset + vec3(uTime * 0.01, 0.0, 0.0), 6)) * uClouds;
  float day = smoothstep(-0.2, 0.3, dot(normalize(vNormal), uLight));
  vec3 tint = mix(vec3(0.85), uSmog, uHaze * 0.7);
  gl_FragColor = sRGBTransferEOTF(vec4(tint * (0.05 + 0.95 * day), density * 0.6));
  #include <colorspace_fragment>
}
`

export const atmosphereVertex = `
varying vec3 vNormalView;
varying vec3 vNormalWorld;

void main() {
  vNormalView = normalize(normalMatrix * normal);
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const atmosphereFragment = `
uniform vec3 uClear;
uniform vec3 uSmog;
uniform float uHaze;
uniform vec3 uLight;

varying vec3 vNormalView;
varying vec3 vNormalWorld;

void main() {
  float intensity = pow(clamp(0.68 - dot(vNormalView, vec3(0.0, 0.0, 1.0)), 0.0, 1.5), 5.0);
  vec3 color = mix(uClear, uSmog, uHaze);
#if DETAIL >= 1
  // FEAT: limbo azul no dia e terminador quente
  float sun = dot(normalize(vNormalWorld), uLight);
  float dusk = smoothstep(0.35, 0.0, sun) * smoothstep(-0.35, 0.0, sun);
  color = mix(color, vec3(1.0, 0.55, 0.3), dusk * 0.7);
  intensity *= 0.25 + 0.75 * smoothstep(-0.3, 0.2, sun);
#endif
  gl_FragColor = sRGBTransferEOTF(vec4(color, clamp(intensity * (0.22 + 0.3 * uHaze), 0.0, 1.0)));
  #include <colorspace_fragment>
}
`

export const ringVertex = `
varying float vRadius;
varying vec3 vWorld;

void main() {
  vRadius = length(position.xy);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const ringFragment = `
uniform float uRing;
uniform vec3 uLight;
uniform vec3 uCenter;
uniform float uScale;

varying float vRadius;
varying vec3 vWorld;

void main() {
  float bands = 0.6 + 0.4 * sin(vRadius * 38.0);
  float edge = smoothstep(1.25, 1.32, vRadius) * (1.0 - smoothstep(1.48, 1.55, vRadius));
  float shade = 1.0;
#if DETAIL >= 2
  // FEAT: sombra do planeta sobre o anel
  vec3 toPoint = vWorld - uCenter;
  float b = dot(toPoint, uLight);
  float c = dot(toPoint, toPoint) - uScale * uScale;
  if (b < 0.0 && b * b - c > 0.0) shade = 0.25;
#endif
  gl_FragColor = sRGBTransferEOTF(vec4(vec3(0.79, 0.68, 1.0) * shade, uRing * 0.22 * bands * edge));
  #include <colorspace_fragment>
}
`

export const discVertex = `
varying vec3 vNormal;

void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const discFragment = `
uniform vec3 uColor;
uniform vec3 uLight;

varying vec3 vNormal;

void main() {
  float day = smoothstep(-0.15, 0.4, dot(normalize(vNormal), uLight));
  gl_FragColor = sRGBTransferEOTF(vec4(uColor * (0.12 + 0.88 * day), 1.0));
  #include <colorspace_fragment>
}
`
