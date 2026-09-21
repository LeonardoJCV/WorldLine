export const planetVertex = `
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vPosition = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

varying vec3 vPosition;
varying vec3 vNormal;

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

float fbm(vec3 p) {
  float amplitude = 0.5;
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    sum += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec3 p = normalize(vPosition);
  float height = fbm(p * 2.2 + uOffset);
  float land = smoothstep(uSea, uSea + 0.015, height);
  float moisture = fbm(p * 4.0 + uOffset.zxy);

  vec3 ocean = mix(uOceanDeep, uOceanShallow, smoothstep(uSea - 0.12, uSea, height));
  float green = clamp(uVegetation * (0.6 + 0.8 * moisture) - uBlight * fbm(p * 9.0 + uOffset) * 0.9, 0.0, 1.0);
  vec3 ground = mix(uArid, uVegetationColor, green);
  ground = mix(ground, ground * 0.45, uFamine * smoothstep(0.4, 0.7, moisture));
  ground = mix(ground, uSnow, smoothstep(0.78, 0.92, abs(p.y) + (height - uSea) * 0.6));

  vec3 surface = mix(ocean, ground, land);
  float gray = dot(surface, vec3(0.3, 0.59, 0.11));
  surface = mix(surface, vec3(gray) * 0.6, uExtinct);

  float day = smoothstep(-0.15, 0.25, dot(normalize(vNormal), uLight));
  vec3 color = surface * (0.08 + 0.92 * day);

  float cities = step(1.0 - uLights * 0.35, noise(p * 60.0 + uOffset)) * land * (1.0 - day);
  float pulse = uUnrest * (0.5 + 0.5 * sin(uTime * 3.0 + height * 40.0));
  color += vec3(1.0, 0.78, 0.45) * cities * (0.9 + pulse);

  gl_FragColor = vec4(color, 1.0);
}
`

export const atmosphereVertex = `
varying vec3 vNormalView;

void main() {
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const atmosphereFragment = `
uniform vec3 uClear;
uniform vec3 uSmog;
uniform float uHaze;

varying vec3 vNormalView;

void main() {
  float intensity = pow(clamp(0.72 - dot(vNormalView, vec3(0.0, 0.0, 1.0)), 0.0, 1.5), 3.0);
  vec3 color = mix(uClear, uSmog, uHaze);
  gl_FragColor = vec4(color, clamp(intensity * (0.45 + 0.35 * uHaze), 0.0, 1.0));
}
`

export const ringVertex = `
varying float vRadius;

void main() {
  vRadius = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ringFragment = `
uniform float uRing;

varying float vRadius;

void main() {
  float bands = 0.55 + 0.45 * sin(vRadius * 70.0);
  float edge = smoothstep(1.45, 1.55, vRadius) * (1.0 - smoothstep(1.85, 1.95, vRadius));
  gl_FragColor = vec4(0.79, 0.68, 1.0, uRing * 0.32 * bands * edge);
}
`
