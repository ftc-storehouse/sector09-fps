import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityPreset } from '../types';

const AAAFilmicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    uChromatic: { value: 0.0009 },
    uVignette: { value: 0.34 },
    uSharpen: { value: 0.42 },
    uGrain: { value: 0.022 },
    uDamage: { value: 0.0 },
    uSuppression: { value: 0.0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uChromatic;
    uniform float uVignette;
    uniform float uSharpen;
    uniform float uGrain;
    uniform float uDamage;
    uniform float uSuppression;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Radial optical chromatic aberration
      float ca = uChromatic * (1.0 + uDamage * 2.8 + uSuppression * 1.8) * (0.35 + r2 * 3.4);
      vec2 dir = centered * ca;

      float r = texture2D(tDiffuse, clamp(vUv + dir, 0.001, 0.999)).r;
      vec3 cCenter = texture2D(tDiffuse, vUv).rgb;
      float b = texture2D(tDiffuse, clamp(vUv - dir, 0.001, 0.999)).b;
      vec3 col = vec3(r, cCenter.g, b);

      // Contrast Adaptive Sharpening (CAS-inspired 5-tap)
      if (uSharpen > 0.01) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;

        vec3 mn = min(min(min(n, s), min(e, w)), cCenter);
        vec3 mx = max(max(max(n, s), max(e, w)), cCenter);
        vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0);
        vec3 weight = -sqrt(amp) * (0.14 * uSharpen);
        vec3 sharpened = (cCenter + (n + s + e + w) * weight) / (1.0 + 4.0 * weight);
        col = mix(col, clamp(sharpened, 0.0, 1.0), 0.85);
      }

      // Subtle cool-shadow / warm-highlight cinema grade
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolTint = vec3(0.95, 0.99, 1.05);
      vec3 warmTint = vec3(1.03, 1.00, 0.96);
      col *= mix(coolTint, warmTint, smoothstep(0.15, 0.85, luma));

      // Suppression / low-health adrenaline desaturation + edge crimson
      float desat = clamp(uSuppression * 0.35 + uDamage * 0.28, 0.0, 0.65);
      col = mix(col, vec3(luma), desat);
      col = mix(col, vec3(0.75, 0.06, 0.08), uDamage * smoothstep(0.12, 0.52, r2) * 0.65);

      // Optical lens vignette
      float vig = smoothstep(0.68, 0.14, r2 * (1.0 + uVignette * 1.45 + uSuppression * 0.55));
      col *= mix(1.0 - uVignette, 1.0, vig);

      // Animated film grain (breaks 8-bit dark fog banding)
      float grain = (hash12(vUv * uResolution + fract(uTime * 17.3) * 100.0) - 0.5) * uGrain;
      col = clamp(col + grain, 0.0, 1.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class PostProcessingPipeline {
  public composer: EffectComposer;
  public bloomPass: UnrealBloomPass;
  public filmicPass: ShaderPass;
  private renderer: THREE.WebGLRenderer;
  private quality: QualityPreset = 'ultra';

  constructor(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.PerspectiveCamera,
    weaponScene: THREE.Scene,
    weaponCamera: THREE.PerspectiveCamera
  ) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4
    });

    this.composer = new EffectComposer(renderer, rt);

    const worldPass = new RenderPass(worldScene, worldCamera);
    worldPass.clear = true;
    this.composer.addPass(worldPass);

    const weaponPass = new RenderPass(weaponScene, weaponCamera);
    weaponPass.clear = false;
    weaponPass.clearDepth = true;
    this.composer.addPass(weaponPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.38,
      0.52,
      0.95
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.filmicPass = new ShaderPass(AAAFilmicShader);
    this.filmicPass.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.filmicPass);
  }

  public setQuality(q: QualityPreset): void {
    this.quality = q;
    if (q === 'ultra') {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.38;
      this.filmicPass.uniforms.uSharpen.value = 0.45;
    } else if (q === 'high') {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.32;
      this.filmicPass.uniforms.uSharpen.value = 0.35;
    } else {
      this.bloomPass.enabled = false;
      this.filmicPass.uniforms.uSharpen.value = 0.25;
    }
    this.resize(window.innerWidth, window.innerHeight);
  }

  public resize(width: number, height: number): void {
    const dpr = this.quality === 'perf' ? 1.0 : Math.min(window.devicePixelRatio, this.quality === 'ultra' ? 1.75 : 1.35);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloomPass.resolution.set(buf.x, buf.y);
    this.filmicPass.uniforms.uResolution.value.set(buf.x, buf.y);
  }

  public update(time: number, adsAmount: number, recoilKick: number, damageFlash: number, suppression: number): void {
    this.filmicPass.uniforms.uTime.value = time;
    this.filmicPass.uniforms.uChromatic.value = 0.00075 + recoilKick * 0.0028;
    this.filmicPass.uniforms.uVignette.value = 0.30 + adsAmount * 0.14;
    this.filmicPass.uniforms.uDamage.value = damageFlash;
    this.filmicPass.uniforms.uSuppression.value = suppression;
  }

  public render(): void {
    this.composer.render();
  }
}
