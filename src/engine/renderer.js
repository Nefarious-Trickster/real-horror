import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// Display-space horror grade: film grain, vignette, chromatic aberration,
// dread warping, scanline tearing, gamma/brightness and cold/warm split-toning.
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDread: { value: 0 },        // 0..1 sustained fear
    uShock: { value: 0 },        // 0..1 short spikes (scares)
    uTear: { value: 0 },         // 0..1 screen tearing
    uBlack: { value: 0 },        // 0..1 fade to black
    uRed: { value: 0 },          // 0..1 death tint
    uGamma: { value: 1.0 },
    uHurt: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDread, uShock, uTear, uBlack, uRed, uGamma, uHurt;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float hash1(float n){ return fract(sin(n)*43758.5453123); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c,c);

      // subtle lens barrel distortion, stronger with dread
      float k = 0.025 + 0.06*uDread + 0.12*uShock;
      uv = 0.5 + c*(1.0 + k*r2);

      // dread: slow breathing warp of the image
      float w = uDread*uDread;
      uv.x += sin(uv.y*9.0 + uTime*1.7)*0.0025*w;
      uv.y += cos(uv.x*7.0 - uTime*1.3)*0.0020*w;

      // tearing: horizontal band offsets
      float band = floor(uv.y*48.0 + floor(uTime*24.0)*7.0);
      float tr = step(1.0 - 0.35*uTear, hash1(band + floor(uTime*30.0)));
      uv.x += (hash1(band*1.7+uTime) - 0.5)*0.12*uTear*tr;

      // chromatic aberration (radial)
      float ca = (0.0012 + 0.006*uDread + 0.02*uShock + 0.02*uTear) ;
      vec2 dir = c * ca * (0.6 + 2.5*r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // brightness / gamma (user setting)
      col = pow(max(col, 0.0), vec3(1.0/uGamma));

      // split-tone: cold shadows, warm highlights, desaturate
      float l = dot(col, vec3(0.299,0.587,0.114));
      vec3 cold = vec3(0.80, 0.92, 1.08);
      vec3 warm = vec3(1.08, 0.98, 0.86);
      col *= mix(cold, warm, smoothstep(0.05, 0.6, l));
      col = mix(vec3(l), col, 0.78 - 0.35*uDread);

      // vignette
      float vig = smoothstep(0.85, 0.18 - 0.08*uDread, length(c*vec2(1.0, 0.9)) * (1.0 + 0.5*uDread));
      col *= mix(0.25, 1.0, vig);

      // red pulse when hurt/dying
      col = mix(col, col*vec3(1.4,0.25,0.2) + vec3(0.06,0.0,0.0), uRed);
      col += vec3(0.25,0.0,0.0)*uHurt*(1.0-vig);

      // film grain (luma-weighted: more visible in shadows)
      float t = floor(uTime*24.0);
      float g = hash(vUv*uRes + t*17.13) - 0.5;
      float gAmt = 0.055 + 0.08*uDread + 0.15*uShock;
      col += g * gAmt * (1.2 - l);

      // occasional dust / scratch
      float scratch = step(0.9985, hash1(floor(vUv.x*uRes.x*0.5) + t)) * step(0.6, hash1(t*3.1));
      col += scratch*0.05;

      // shock flash: brief inversion-ish sting
      col = mix(col, vec3(1.0) - col*0.6, uShock*uShock*0.15);

      col *= (1.0 - uBlack);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.03, 120);
    this.baseFov = 72;

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    this.fx = this.horror.uniforms;
    this.fx.uRes.value.copy(size);

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fx.uRes.value.copy(size);
  }

  render(dt, t) {
    this.fx.uTime.value = t;
    this.composer.render(dt);
  }
}
