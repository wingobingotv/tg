/**
 * The 3D reveal.
 *
 * The object is a machined lottery ball with a recessed medallion face,
 * held inside counter-rotating holographic rings and standing in a fan of
 * light shafts. It is real geometry with physically based materials
 * reflecting a hand-painted studio environment, lit by a key, a warm
 * kicker and a cool rim — so it reflects, catches highlights as it turns,
 * and sits in the frame like an object rather than a decal.
 *
 * The one thing that is deliberately *not* curved or refracted is the
 * numeral. It rides on a flat, camera-facing face and is extruded by
 * stacking silhouettes behind it, because the brief's hardest constraint
 * is that the number must never be distorted or covered. Everything
 * else — rings, motes, beams, shockwave, flare — is either behind the
 * face in depth or radially outside it, so nothing can ever cross it.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { PALETTE } from "../cinematic-fx";
import type { QualityTier } from "../cinematic-fx";
import {
  beamTexture,
  drawCaption,
  drawNumeral,
  environmentTexture,
  faceTexture,
  flareTexture,
  moteTexture,
  ringTexture,
} from "./textures";
import {
  clamp,
  damped,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  phaseAt,
  progress,
  type Timeline,
} from "./timeline";

/** Outer radius of the whole assembly, for framing maths. */
const ASSEMBLY_RADIUS = 2.35;
const BALL_RADIUS = 1.24;
/** Depth of the medallion face above the ball's centre. */
const FACE_Z = 0.995;

interface TierSettings {
  bloom: boolean;
  antialias: boolean;
  motes: number;
  burst: number;
  beams: number;
  /** Glass transmission is the most expensive material feature we use. */
  transmission: boolean;
  maxPixelRatio: number;
  envSize: number;
}

const TIERS: Record<QualityTier, TierSettings> = {
  high: {
    bloom: true,
    antialias: true,
    motes: 900,
    burst: 700,
    beams: 9,
    // Glass transmission is the single most expensive material feature: it
    // forces an extra render of the whole scene behind the shell every
    // frame. Over a live stream that second render is what tips a busy GPU
    // into dropping the video's composited frames, so it is not worth the
    // faint back-half refraction. The ball, bezel and clearcoat keep the
    // object reading as machined metal without it.
    transmission: false,
    maxPixelRatio: 1.75,
    envSize: 1024,
  },
  medium: {
    bloom: true,
    antialias: true,
    motes: 480,
    burst: 380,
    beams: 7,
    transmission: false,
    maxPixelRatio: 1.6,
    envSize: 512,
  },
  low: {
    bloom: false,
    antialias: false,
    motes: 200,
    burst: 160,
    beams: 5,
    transmission: false,
    maxPixelRatio: 1.25,
    envSize: 256,
  },
};

export interface SceneOptions {
  tier: QualityTier;
  reducedMotion: boolean;
  onContextLost?: () => void;
}

export class LuckyNumberScene {
  private readonly settings: TierSettings;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private reduced = false;

  /**
   * The object itself: ball, glass, plaque. Scaled from almost nothing to
   * full size on impact, so *only* things that should arrive with it live
   * in here.
   */
  private readonly assembly = new THREE.Group();
  /**
   * The energy field around the object: rings, beams, motes, wave fronts.
   * Kept out of `assembly` because it is already at full size during the
   * gather — scaling it with the object's entrance would collapse the
   * whole gathering cloud into a dot on the presenter's chest.
   */
  private readonly field = new THREE.Group();
  /** The face plate, numeral stack and caption. Never rotated in Y. */
  private readonly plaque = new THREE.Group();

  private ball!: THREE.Mesh;
  private ballMaterial!: THREE.MeshPhysicalMaterial;
  private glass: THREE.Mesh | null = null;
  private facePlate!: THREE.Mesh;
  private bezel!: THREE.Mesh;
  private readonly numeralLayers: THREE.Mesh[] = [];
  private caption: THREE.Mesh | null = null;
  private readonly rings: THREE.Mesh[] = [];
  private readonly beams = new THREE.Group();
  private shockwave!: THREE.Mesh;
  private shockwaveInner!: THREE.Mesh;
  private flare!: THREE.Sprite;
  private keyLight!: THREE.DirectionalLight;
  private impactLight!: THREE.PointLight;

  private motes!: THREE.Points;
  private moteHome!: Float32Array;
  private moteStart!: Float32Array;
  private moteSpin!: Float32Array;
  private burst!: THREE.Points;
  private burstVelocity!: Float32Array;

  private readonly disposables: Array<{ dispose(): void }> = [];
  private envMap: THREE.Texture | null = null;

  private width = 1;
  private height = 1;
  private captionAspect = 1;
  private baseCameraZ = 8;
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: SceneOptions,
  ) {
    this.settings = TIERS[options.tier];

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: this.settings.antialias,
      powerPreference: "high-performance",
    });
    this.renderer.setClearAlpha(0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES keeps the specular highlights from clipping to flat white,
    // which is most of what separates "cinematic" from "shiny".
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const canvas = this.renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.root.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    this.camera.position.set(0, 0, this.baseCameraZ);

    this.buildEnvironment();
    this.buildLights();
    this.buildBall();
    this.buildPlaque();
    this.buildRings();
    this.buildBeams();
    this.buildShockwave();
    this.buildParticles();
    this.buildFlare();

    this.scene.add(this.assembly, this.field);

    if (this.settings.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // A high threshold and a modest radius. Bloom is here to give the
      // highlights a halo, not to raise the exposure of the frame — the
      // live video underneath has to stay the anchor.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private buildEnvironment(): void {
    const source = new THREE.CanvasTexture(environmentTexture(this.settings.envSize));
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.colorSpace = THREE.SRGBColorSpace;

    // Pre-filtered once at construction. The mip chain is what lets a
    // rough surface reflect a blurred version of the same room as a
    // polished one, which is the whole basis of the material contrast
    // between the ball, the bezel and the medallion.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(source);
    this.envMap = target.texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
    source.dispose();
  }

  private buildLights(): void {
    // Ambient is deliberately low: the environment map does the filling,
    // and a bright ambient would wash out the metal's contrast.
    this.scene.add(new THREE.AmbientLight(0x20242e, 1.1));

    this.keyLight = new THREE.DirectionalLight(0xfff0cf, 3.1);
    this.keyLight.position.set(1.6, 3.2, 3.4);
    this.scene.add(this.keyLight);

    const kicker = new THREE.DirectionalLight(new THREE.Color(PALETTE.gold), 1.5);
    kicker.position.set(-3.4, -0.6, 1.8);
    this.scene.add(kicker);

    const frontFill = new THREE.DirectionalLight(new THREE.Color(PALETTE.champagne), 1.7);
    frontFill.position.set(0.4, 0.8, 6);
    this.scene.add(frontFill);

    // Cool separation from behind, so the silhouette reads against a dark
    // video frame.
    const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.electric), 1.9);
    rim.position.set(-1.2, 1.4, -3.6);
    this.scene.add(rim);

    // Fires only at the moment of impact.
    this.impactLight = new THREE.PointLight(new THREE.Color(PALETTE.crystal), 0, 9, 2);
    this.impactLight.position.set(0, 0, 1.6);
    this.scene.add(this.impactLight);
  }

  private buildBall(): void {
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 64, 48);
    this.disposables.push(geometry);

    this.ballMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(PALETTE.deepGold),
      metalness: 1,
      roughness: 0.24,
      envMapIntensity: 1.05,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      transparent: true,
      opacity: 1,
    });
    this.disposables.push(this.ballMaterial);

    this.ball = new THREE.Mesh(geometry, this.ballMaterial);
    this.assembly.add(this.ball);

    // A crystal shell floating just clear of the metal. Only on the top
    // tier: transmission needs its own render of the scene behind it.
    if (this.settings.transmission) {
      const shellGeometry = new THREE.SphereGeometry(BALL_RADIUS * 1.1, 48, 32);
      const shellMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(PALETTE.crystal),
        metalness: 0,
        roughness: 0.04,
        transmission: 0.94,
        thickness: 0.9,
        ior: 1.46,
        envMapIntensity: 2.1,
        clearcoat: 1,
        transparent: true,
        opacity: 1,
        // Only the back half: a full shell in front of the medallion
        // would refract the numeral, and readability wins over sparkle.
        side: THREE.BackSide,
      });
      this.disposables.push(shellGeometry, shellMaterial);
      this.glass = new THREE.Mesh(shellGeometry, shellMaterial);
      this.assembly.add(this.glass);
    }
  }

  private buildPlaque(): void {
    // Recessed medallion, spun metal, sitting proud of the ball.
    const faceMap = new THREE.CanvasTexture(faceTexture());
    faceMap.colorSpace = THREE.SRGBColorSpace;
    const faceGeometry = new THREE.CircleGeometry(BALL_RADIUS * 0.66, 64);
    const faceMaterial = new THREE.MeshPhysicalMaterial({
      map: faceMap,
      metalness: 0.45,
      roughness: 0.44,
      envMapIntensity: 0.75,
      transparent: true,
    });
    this.disposables.push(faceMap, faceGeometry, faceMaterial);
    this.facePlate = new THREE.Mesh(faceGeometry, faceMaterial);
    this.facePlate.position.z = FACE_Z;
    this.plaque.add(this.facePlate);

    // Polished bezel around it. This ring is what catches the rim light
    // and gives the face a physical edge.
    const bezelGeometry = new THREE.TorusGeometry(BALL_RADIUS * 0.68, BALL_RADIUS * 0.05, 20, 96);
    const bezelMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(PALETTE.champagne),
      metalness: 1,
      roughness: 0.12,
      envMapIntensity: 2,
      transparent: true,
    });
    this.disposables.push(bezelGeometry, bezelMaterial);
    this.bezel = new THREE.Mesh(bezelGeometry, bezelMaterial);
    this.bezel.position.z = FACE_Z;
    this.plaque.add(this.bezel);

    this.assembly.add(this.plaque);
  }

  private buildRings(): void {
    const map = new THREE.CanvasTexture(ringTexture(0.05, 512));
    map.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(map);

    const specs = [
      { radius: 1.86, tilt: 0.34, spin: 0.42, color: PALETTE.gold, opacity: 0.85 },
      { radius: 2.18, tilt: -0.62, spin: -0.3, color: PALETTE.champagne, opacity: 0.6 },
      { radius: 2.34, tilt: 1.18, spin: 0.22, color: PALETTE.electric, opacity: 0.38 },
    ];

    for (const spec of specs) {
      const geometry = new THREE.PlaneGeometry(spec.radius * 2, spec.radius * 2);
      const material = new THREE.MeshBasicMaterial({
        map,
        color: new THREE.Color(spec.color),
        transparent: true,
        opacity: spec.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(geometry, material);
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = spec.tilt;
      ring.userData.spin = spec.spin;
      ring.userData.tilt = spec.tilt;
      ring.userData.opacity = spec.opacity;
      this.rings.push(ring);
      this.field.add(ring);
    }
  }

  private buildBeams(): void {
    const map = new THREE.CanvasTexture(beamTexture());
    map.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(map);

    const count = this.settings.beams;
    for (let i = 0; i < count; i += 1) {
      const geometry = new THREE.PlaneGeometry(0.62, 7.4);
      geometry.translate(0, 3.7, 0);
      const material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(geometry, material);
      const beam = new THREE.Mesh(geometry, material);
      beam.rotation.z = (i / count) * Math.PI * 2;
      beam.userData.base = 0.09 + (i % 3) * 0.035;
      this.beams.add(beam);
    }
    // Well behind the ball, so the shafts read as light escaping from
    // behind the object rather than lying across it.
    this.beams.position.z = -2.1;
    this.field.add(this.beams);
  }

  private buildShockwave(): void {
    const map = new THREE.CanvasTexture(ringTexture(0.09, 512));
    map.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(map);

    const make = (color: string, opacity: number): THREE.Mesh => {
      const geometry = new THREE.PlaneGeometry(2, 2);
      const material = new THREE.MeshBasicMaterial({
        map,
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      // Tilted well off the camera axis so it expands *through* the scene
      // in perspective instead of reading as a flat circle drawn on the
      // glass.
      mesh.rotation.x = -1.16;
      mesh.position.z = -0.2;
      mesh.visible = false;
      return mesh;
    };

    this.shockwave = make(PALETTE.gold, 0);
    this.shockwaveInner = make(PALETTE.crystal, 0);
    this.field.add(this.shockwave, this.shockwaveInner);
  }

  private buildParticles(): void {
    const map = new THREE.CanvasTexture(moteTexture());
    map.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(map);

    // Ambient cloud. Each mote has a resting place on a shell around the
    // assembly and a far-off start point; the gather phase interpolates
    // between them, which is the "particles drawing inwards" beat.
    const count = this.settings.motes;
    const home = new Float32Array(count * 3);
    const start = new Float32Array(count * 3);
    const spin = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const gold = new THREE.Color(PALETTE.gold);
    const crystal = new THREE.Color(PALETTE.crystal);
    const champagne = new THREE.Color(PALETTE.champagne);

    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      // Minimum radius keeps the cloud outside the medallion, so motes
      // can never drift across the numeral.
      const radius = 1.75 + Math.random() * 2.5;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.sin(phi) * Math.sin(theta);
      const sz = Math.cos(phi);

      home[i * 3] = sx * radius;
      home[i * 3 + 1] = sy * radius;
      home[i * 3 + 2] = sz * radius * 0.7;

      const spread = 3.4 + Math.random() * 5;
      start[i * 3] = sx * radius * spread;
      start[i * 3 + 1] = sy * radius * spread;
      start[i * 3 + 2] = sz * radius * spread * 0.5;

      spin[i * 3] = 0.06 + Math.random() * 0.24;
      spin[i * 3 + 1] = Math.random() * Math.PI * 2;
      spin[i * 3 + 2] = 0.1 + Math.random() * 0.5;

      positions[i * 3] = start[i * 3]!;
      positions[i * 3 + 1] = start[i * 3 + 1]!;
      positions[i * 3 + 2] = start[i * 3 + 2]!;

      const tint = Math.random();
      const color = tint > 0.86 ? crystal : tint > 0.5 ? gold : champagne;
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      sizes[i] = 0.05 + Math.random() * 0.12;
    }

    this.moteHome = home;
    this.moteStart = start;
    this.moteSpin = spin;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      map,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(geometry, material);
    this.motes = new THREE.Points(geometry, material);
    this.field.add(this.motes);

    // Impact burst: a separate cloud that only exists after the lock.
    const burstCount = this.settings.burst;
    const burstPositions = new Float32Array(burstCount * 3);
    const burstColors = new Float32Array(burstCount * 3);
    this.burstVelocity = new Float32Array(burstCount * 3);
    for (let i = 0; i < burstCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 3.6 + Math.random() * 7.4;
      this.burstVelocity[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.burstVelocity[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      this.burstVelocity[i * 3 + 2] = Math.cos(phi) * speed * 0.55;
      const color = Math.random() > 0.7 ? crystal : gold;
      burstColors[i * 3] = color.r;
      burstColors[i * 3 + 1] = color.g;
      burstColors[i * 3 + 2] = color.b;
    }
    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute("position", new THREE.BufferAttribute(burstPositions, 3));
    burstGeometry.setAttribute("color", new THREE.BufferAttribute(burstColors, 3));
    const burstMaterial = new THREE.PointsMaterial({
      map,
      size: 0.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(burstGeometry, burstMaterial);
    this.burst = new THREE.Points(burstGeometry, burstMaterial);
    this.burst.visible = false;
    this.field.add(this.burst);
  }

  private buildFlare(): void {
    const map = new THREE.CanvasTexture(flareTexture());
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.disposables.push(map, material);
    this.flare = new THREE.Sprite(material);
    this.flare.scale.setScalar(6);
    // Behind the plaque in depth: a flare drawn over the numeral would
    // wash out the very thing it is celebrating.
    this.flare.position.set(0, 0, -0.6);
    this.field.add(this.flare);
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  /**
   * Builds the numeral stack for a given number. Called on every reveal
   * and on every resize, so the glyphs are always rendered at the pixel
   * size they will actually occupy — no upscaled bitmaps.
   */
  setNumber(text: string, label?: string): void {
    for (const layer of this.numeralLayers) {
      this.plaque.remove(layer);
      layer.geometry.dispose();
      (layer.material as THREE.Material).dispose();
    }
    this.numeralLayers.length = 0;

    if (this.caption) {
      this.plaque.remove(this.caption);
      this.caption.geometry.dispose();
      (this.caption.material as THREE.Material).dispose();
      this.caption = null;
    }

    // Render at roughly the on-screen size of the numeral, capped.
    const pixelHeight = clamp(Math.min(this.width, this.height) * 0.3, 96, 420);
    const art = drawNumeral(text, pixelHeight);

    // Size the *glyphs* to the medallion, then derive the plane from the
    // glyph-to-canvas ratio. Fitting the padded canvas instead would leave
    // the number visibly undersized inside its own plate.
    const faceRadius = BALL_RADIUS * 0.66;
    const glyphHeight = Math.min(faceRadius * 1.34, (faceRadius * 1.7) / art.aspect);
    const height = glyphHeight / art.glyphHeightRatio;
    const width = height * art.aspect;
    // Guard the width too: three digits are much wider than one.
    const glyphWidth = width * art.glyphWidthRatio;
    const widthLimit = faceRadius * 1.72;
    const shrink = glyphWidth > widthLimit ? widthLimit / glyphWidth : 1;

    // Extrusion: silhouettes marching back from the lit face, darkening
    // as they go. Read from the front they form a solid metal numeral
    // standing off the plate.
    const planeWidth = width * shrink;
    const planeHeight = height * shrink;
    const depthLayers = 5;
    const silhouetteMap = new THREE.CanvasTexture(art.silhouette);
    silhouetteMap.colorSpace = THREE.SRGBColorSpace;
    for (let i = depthLayers; i >= 1; i -= 1) {
      const t = i / depthLayers;
      const geometry = new THREE.PlaneGeometry(
        planeWidth * (1 - t * 0.012),
        planeHeight * (1 - t * 0.012),
      );
      const material = new THREE.MeshBasicMaterial({
        map: silhouetteMap,
        transparent: true,
        color: new THREE.Color(PALETTE.deepGold).multiplyScalar(0.42 - t * 0.22),
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = FACE_Z + 0.012 + (1 - t) * 0.1;
      mesh.renderOrder = 10 + i;
      this.numeralLayers.push(mesh);
      this.plaque.add(mesh);
    }

    const faceMap = new THREE.CanvasTexture(art.face);
    faceMap.colorSpace = THREE.SRGBColorSpace;
    const faceGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const faceMaterial = new THREE.MeshBasicMaterial({
      map: faceMap,
      transparent: true,
      // No depth test: nothing in the scene may ever occlude the number.
      depthTest: false,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
    faceMesh.position.z = FACE_Z + 0.13;
    faceMesh.renderOrder = 30;
    this.numeralLayers.push(faceMesh);
    this.plaque.add(faceMesh);

    const captionArt = label ? drawCaption(label, pixelHeight * 0.17) : null;
    if (captionArt) {
      const map = new THREE.CanvasTexture(captionArt.canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      this.captionAspect = captionArt.aspect;
      // Sized from the cap height, not the padded canvas — the first cut
      // of this rendered a six-pixel-tall caption on a 720p frame.
      const captionHeight = (faceRadius * 0.34) / captionArt.glyphHeightRatio;
      const geometry = new THREE.PlaneGeometry(captionHeight * this.captionAspect, captionHeight);
      const material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // Not additive. The caption has to stay solid when a wave front
        // or a ring passes behind it; additive let the bright pass eat
        // the letters.
      });
      this.caption = new THREE.Mesh(geometry, material);
      this.caption.position.set(0, BALL_RADIUS * 1.2 + captionHeight * 0.42, FACE_Z + 0.14);
      this.caption.renderOrder = 31;
      this.plaque.add(this.caption);
    }
  }

  /**
   * Sheds the two expensive passes, once, mid-reveal.
   *
   * Called by the player when real frame times say this device cannot
   * hold the budget. It drops the bloom composite and the glass shell —
   * the two things that cost the most and change the composition the
   * least. The ball, the number, the rings, the beams, the wave and the
   * particles all stay, so it reads as the same reveal rendered by a
   * smaller rig rather than as a different effect.
   */
  reduceQuality(): void {
    if (this.reduced) return;
    this.reduced = true;

    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;

    if (this.glass) {
      this.assembly.remove(this.glass);
      this.glass.visible = false;
      this.glass = null;
    }

    // Lift the exposure a touch: bloom was contributing part of the
    // highlight, and losing it should not make the object look flatter.
    this.renderer.toneMappingExposure += 0.06;
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;

    let dpr = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);

    // A ratio cap is not an area cap. The bloom composer, the transmission
    // pass and MSAA all cost per drawn pixel, and a desktop player is several
    // times the area of a phone's, so the same ratio buys a far bigger bill
    // on desktop. Hold the drawing buffer to roughly 1080p.
    const MAX_PIXELS = 2_100_000;
    if (width * height * dpr * dpr > MAX_PIXELS) {
      dpr = Math.max(1, Math.sqrt(MAX_PIXELS / (width * height)));
    }

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(width, height);
    this.bloom?.resolution.set(width, height);

    this.camera.aspect = width / height;

    // Frame the assembly to a share of the player, then pull back if that
    // would push it past the sides. A phone in portrait and a desktop in
    // fullscreen therefore get the same composition, not the same numbers.
    const portrait = height > width;
    const share = portrait ? 0.56 : 0.46;
    const targetPx = Math.min(Math.min(width, height) * share, width * 0.7);
    const visibleWorldHeight = (ASSEMBLY_RADIUS * 2 * height) / Math.max(1, targetPx);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    this.baseCameraZ = clamp(visibleWorldHeight / (2 * Math.tan(fovRad / 2)), 5, 26);

    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  render(elapsed: number, timeline: Timeline): void {
    if (this.disposed) return;

    const phase = phaseAt(timeline, elapsed);
    const gather = progress(elapsed, 0, timeline.gatherEnd);
    const sinceImpact = (elapsed - timeline.gatherEnd) / 1000;
    const release = progress(elapsed, timeline.holdEnd, timeline.totalMs);
    const calm = this.options.reducedMotion ? 0.35 : 1;
    const seconds = elapsed / 1000;

    // Master fade. In and out are asymmetric on purpose: arrive quickly,
    // leave slowly, so the overlay never appears to cut.
    const fadeIn = progress(elapsed, 0, 320);
    const overall = fadeIn * (1 - easeInCubic(release));

    this.updateCamera(elapsed, timeline, gather, release, calm, seconds);
    this.updateAssembly(phase, elapsed, timeline, sinceImpact, calm, seconds, overall);
    this.updateGatherLayer(gather, phase, overall, calm, seconds);
    this.updateImpactLayer(phase, sinceImpact, overall);
    this.updateAmbient(phase, gather, overall, calm, seconds, release);

    if (this.composer && this.bloom) {
      // Bloom spikes on the lock and settles back to a controlled level.
      const spike = phase === "gather" ? gather * 0.08 : Math.max(0, 1 - sinceImpact / 0.5);
      this.bloom.strength = (0.24 + spike * 0.3) * overall;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateCamera(
    elapsed: number,
    timeline: Timeline,
    gather: number,
    release: number,
    calm: number,
    seconds: number,
  ): void {
    // Slow push in through the build-up, a hard nudge on impact, then a
    // gentle drift and a pull back as we let go.
    const push = 1.34 - 0.34 * easeOutCubic(gather);
    const retreat = 1 + easeInCubic(release) * 0.16;
    let z = this.baseCameraZ * push * retreat;

    const shake = elapsed >= timeline.gatherEnd ? damped((elapsed - timeline.gatherEnd) / 460, 3, 7) : 0;
    z += shake * 0.16 * calm;

    // Parallax: a small lateral orbit keeps the object feeling like it is
    // sitting in a space the camera is moving through.
    const drift = Math.sin(seconds * 0.34) * 0.16 * calm;
    const lift = Math.cos(seconds * 0.26) * 0.1 * calm;
    this.camera.position.set(drift + shake * 0.05 * calm, lift, z);
    this.camera.lookAt(0, 0, 0);
  }

  private updateAssembly(
    phase: string,
    elapsed: number,
    timeline: Timeline,
    sinceImpact: number,
    calm: number,
    seconds: number,
    overall: number,
  ): void {
    let scale: number;
    let opacity: number;

    if (phase === "gather") {
      // Not yet arrived. A faint seed of the object is present so the
      // convergence has a visible target.
      const bloomIn = progress(elapsed, timeline.gatherEnd - 260, timeline.gatherEnd);
      scale = 0.06 + bloomIn * 0.14;
      opacity = bloomIn * 0.35;
    } else {
      // Overshoot and settle: the lock-in.
      const arrive = clamp(sinceImpact / 0.42, 0, 1);
      scale = 0.2 + (1 - 0.2) * easeOutBack(arrive, 1.9);
      scale += damped(clamp(sinceImpact / 0.9, 0, 1), 2.5, 7) * 0.035 * calm;
      opacity = clamp(sinceImpact / 0.06, 0, 1);
    }

    this.assembly.scale.setScalar(scale);
    // Slow float, and a slow turn so highlights travel across the metal.
    this.assembly.position.y = Math.sin(seconds * 0.62) * 0.075 * calm;
    this.ball.rotation.y = seconds * 0.16 * calm;
    this.ball.rotation.x = Math.sin(seconds * 0.3) * 0.05 * calm;
    if (this.glass) {
      this.glass.rotation.y = -seconds * 0.1 * calm;
    }
    // The plaque counter-tilts so the numeral stays square to the camera
    // however the ball behind it turns.
    this.plaque.rotation.set(
      Math.sin(seconds * 0.42) * 0.035 * calm,
      Math.sin(seconds * 0.31) * 0.05 * calm,
      0,
    );

    const alpha = opacity * overall;
    this.ballMaterial.opacity = alpha;
    (this.facePlate.material as THREE.Material).opacity = alpha;
    (this.bezel.material as THREE.Material).opacity = alpha;
    if (this.glass) (this.glass.material as THREE.Material).opacity = alpha;
    for (const layer of this.numeralLayers) {
      (layer.material as THREE.Material).opacity = alpha;
    }
    if (this.caption) {
      // Caption lands just after the number, never at the same time.
      const captionIn = phase === "gather" ? 0 : clamp((sinceImpact - 0.22) / 0.34, 0, 1);
      (this.caption.material as THREE.Material).opacity = captionIn * overall;
    }
  }

  private updateGatherLayer(
    gather: number,
    phase: string,
    overall: number,
    calm: number,
    seconds: number,
  ): void {
    // Motes travel from far out to their resting shell during the gather,
    // then orbit. This is the "energy drawing toward the centre" beat and
    // it is done in world space, so it has real depth and parallax.
    const converge = easeOutCubic(gather);
    const positions = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = positions.array as Float32Array;
    const count = array.length / 3;

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const orbitSpeed = this.moteSpin[i3]!;
      const phaseOffset = this.moteSpin[i3 + 1]!;
      const bobAmount = this.moteSpin[i3 + 2]!;

      const hx = this.moteHome[i3]!;
      const hy = this.moteHome[i3 + 1]!;
      const hz = this.moteHome[i3 + 2]!;

      // Orbit the resting position about the vertical axis.
      const angle = seconds * orbitSpeed * calm + phaseOffset;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ox = hx * cos - hz * sin;
      const oz = hx * sin + hz * cos;
      const oy = hy + Math.sin(seconds * bobAmount + phaseOffset) * 0.14 * calm;

      const sx = this.moteStart[i3]!;
      const sy = this.moteStart[i3 + 1]!;
      const sz = this.moteStart[i3 + 2]!;
      array[i3] = sx + (ox - sx) * converge;
      array[i3 + 1] = sy + (oy - sy) * converge;
      array[i3 + 2] = sz + (oz - sz) * converge;
    }
    positions.needsUpdate = true;

    const moteMaterial = this.motes.material as THREE.PointsMaterial;
    // Brightest during the gather, when they are the only thing on
    // screen; pulled back once the number is the subject.
    const presence = phase === "gather" ? 0.3 + gather * 0.35 : 0.3;
    moteMaterial.opacity = presence * overall;

    // Beams brighten as the energy builds and hold at a low level after.
    const beamLevel = phase === "gather" ? easeOutCubic(gather) : 0.6;
    this.beams.rotation.z = seconds * 0.11 * calm;
    for (const child of this.beams.children) {
      const beam = child as THREE.Mesh;
      const base = beam.userData.base as number;
      const flicker = 0.82 + Math.sin(seconds * 1.6 + base * 22) * 0.18;
      (beam.material as THREE.Material).opacity = base * beamLevel * flicker * overall;
    }

    // Rings spin up during the gather and keep turning through the hold.
    for (const ring of this.rings) {
      const spin = ring.userData.spin as number;
      const tilt = ring.userData.tilt as number;
      ring.rotation.z = seconds * spin * calm;
      ring.rotation.x = tilt + Math.sin(seconds * 0.24 + spin) * 0.16 * calm;
      const target = ring.userData.opacity as number;
      (ring.material as THREE.Material).opacity =
        target * (phase === "gather" ? gather * 0.5 : 1) * overall;
    }
  }

  private updateImpactLayer(phase: string, sinceImpact: number, overall: number): void {
    if (phase === "gather") {
      this.shockwave.visible = false;
      this.shockwaveInner.visible = false;
      this.burst.visible = false;
      this.flare.material.opacity = 0;
      this.impactLight.intensity = 0;
      return;
    }

    // Expanding wave front. Two rings at different speeds: the crystal
    // one races ahead as a leading edge, the gold body follows.
    const waveLife = 1.5;
    if (sinceImpact < waveLife) {
      const t = sinceImpact / waveLife;
      const outer = 1.2 + easeOutExpo(t) * 4.2;
      const inner = 1.2 + easeOutExpo(Math.min(1, t * 1.35)) * 5;
      this.shockwave.visible = true;
      this.shockwaveInner.visible = true;
      this.shockwave.scale.setScalar(outer);
      this.shockwaveInner.scale.setScalar(inner);
      (this.shockwave.material as THREE.Material).opacity = Math.pow(1 - t, 2.2) * 0.3 * overall;
      (this.shockwaveInner.material as THREE.Material).opacity =
        Math.pow(1 - Math.min(1, t * 1.35), 2.8) * 0.22 * overall;
    } else {
      this.shockwave.visible = false;
      this.shockwaveInner.visible = false;
    }

    // Spark burst, thrown outwards and slowed by drag.
    const burstLife = 2.2;
    if (sinceImpact < burstLife) {
      const t = sinceImpact / burstLife;
      const travel = (1 - Math.exp(-sinceImpact * 2.2)) / 2.2;
      const positions = this.burst.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = positions.array as Float32Array;
      for (let i = 0; i < array.length; i += 3) {
        array[i] = this.burstVelocity[i]! * travel;
        array[i + 1] = this.burstVelocity[i + 1]! * travel - sinceImpact * sinceImpact * 0.7;
        array[i + 2] = this.burstVelocity[i + 2]! * travel;
      }
      positions.needsUpdate = true;
      this.burst.visible = true;
      (this.burst.material as THREE.PointsMaterial).opacity = Math.pow(1 - t, 1.7) * overall;
    } else {
      this.burst.visible = false;
    }

    // Lens character and a real light pulse, both very short.
    const flash = Math.max(0, 1 - sinceImpact / 0.62);
    this.flare.material.opacity = Math.pow(flash, 2) * 0.26 * overall;
    this.flare.scale.setScalar(3.4 + (1 - flash) * 3);
    this.impactLight.intensity = Math.pow(flash, 2) * 5;
    this.keyLight.intensity = 3.1 + Math.pow(flash, 2) * 1.1;
  }

  private updateAmbient(
    phase: string,
    gather: number,
    _overall: number,
    calm: number,
    seconds: number,
    release: number,
  ): void {
    // A slow exposure lift into the reveal and a drain on the way out, so
    // the whole frame breathes with the moment.
    const lift = phase === "gather" ? gather * 0.04 : 0.055 * (1 - release);
    this.renderer.toneMappingExposure = 1.0 + lift;
    void calm;
    void seconds;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  private handleContextLost = (event: Event): void => {
    // A lost context on a live stream is not recoverable in place; the
    // host swaps to the 2D renderer so the reveal still happens.
    event.preventDefault();
    this.options.onContextLost?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);

    for (const layer of this.numeralLayers) {
      layer.geometry.dispose();
      (layer.material as THREE.Material).dispose();
    }
    this.numeralLayers.length = 0;
    if (this.caption) {
      this.caption.geometry.dispose();
      (this.caption.material as THREE.Material).dispose();
    }
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.envMap?.dispose();
    this.scene.environment = null;
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
