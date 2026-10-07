/**
 * The stage: canvases, the frame loop, the atmosphere and the emitters
 * that choreographies drive.
 *
 * Depth is built out of three stacked canvases rather than one. Sorting
 * particles into a far, a middle and a near plate lets us apply a real
 * (GPU-composited) blur to the outer two, which is what produces the
 * depth-of-field the brief asks for — a per-particle blur would be an
 * order of magnitude more expensive and is the usual reason web
 * "3D" particle effects end up looking flat.
 */

import { Camera, LAYER_FRONT_Z } from "./camera";
import { FrameGovernor, detectQualityTier, prefersReducedMotion, profileFor } from "./quality";
import {
  Confetti,
  Ember,
  GodraySweep,
  Ignition,
  LightPillar,
  Rocket,
  Shockwave,
  Spark,
  Spiral,
  Streak,
  type BurstOptions,
  type Particle,
  type SpawnSink,
  type UpdateContext,
} from "./particles";
import { createRng, type Rng } from "./rng";
import { PALETTE, SHELL_COLORS, SpriteAtlas, hexToRgba } from "./sprites";
import type { QualityProfile, QualityTier, SafeZone } from "./types";

/** Beyond this we stop spawning rather than risk the frame budget. */
const HARD_PARTICLE_CAP = 3200;

export type { BurstOptions, ShellShape } from "./particles";

export interface StageOptions {
  /** Overrides device detection. Useful for the admin preview. */
  tier?: QualityTier;
  safeZone?: Partial<SafeZone>;
  /** Called once the last particle has left the frame. */
  onIdle?: () => void;
}

/**
 * Owns the DOM, the particle pools and the clock. Choreographies never
 * touch canvases; they only call the emitter methods below.
 */
/** One depth layer's draw lists: [opaque, additive]. */
type DrawBucket = [Particle[], Particle[]];

export class CinematicStage implements SpawnSink {
  readonly camera = new Camera();
  readonly atlas = new SpriteAtlas();

  private readonly root: HTMLElement;
  /** Every canvas, in stacking order, for sizing and teardown. */
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly allContexts: CanvasRenderingContext2D[] = [];
  /** The three depth plates only: far, mid, near. */
  private readonly layerCanvases: HTMLCanvasElement[] = [];
  private readonly contexts: CanvasRenderingContext2D[] = [];
  private bloomCanvas: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;
  private trailCanvas: HTMLCanvasElement | null = null;
  private trailCtx: CanvasRenderingContext2D | null = null;

  private readonly embers: Ember[] = [];
  private readonly streaks: Streak[] = [];
  private readonly sparks: Spark[] = [];
  private readonly ignitions: Ignition[] = [];
  private readonly confetti: Confetti[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly rockets: Rocket[] = [];
  private readonly spirals: Spiral[] = [];
  private readonly pillars: LightPillar[] = [];
  private readonly sweeps: GodraySweep[] = [];

  /** Particles that also deposit into the persistence buffer this frame. */
  private readonly trailBucket: Particle[] = [];

  /** Reusable draw buckets: [layer][opaque|additive]. No per-frame alloc. */
  private readonly buckets: [DrawBucket, DrawBucket, DrawBucket] = [
    [[], []],
    [[], []],
    [[], []],
  ];

  private governor: FrameGovernor;
  private rng: Rng = createRng(1);
  private dpr = 1;
  private rafId = 0;
  private lastFrame = 0;
  private running = false;
  private resizeObserver: ResizeObserver | null = null;

  /** 0..1 — how present the atmospheric glow and light rays are. */
  private atmosphere = 0;
  private atmosphereTarget = 0;
  private atmosphereClock = 0;
  /**
   * Short-lived spike on top of the atmosphere, driven by detonations.
   * A big shell lights the room it is fired in; without this the frame
   * stays at a constant exposure no matter what explodes in it, which is
   * one of the quieter reasons overlay effects look pasted on.
   */
  private pulse = 0;

  private readonly reducedMotion: boolean;
  private readonly onIdle?: () => void;

  /**
   * Per-frame hook the choreographer drives. Kept on the stage so there
   * is exactly one `requestAnimationFrame` loop for the whole overlay.
   */
  onTick: ((dtMs: number) => void) | null = null;

  /**
   * Set while a sequence is running. Without it the loop would shut down
   * during the beat between `start()` and the first cue, or in any lull
   * where the frame happens to contain no particles.
   */
  holding = false;

  constructor(root: HTMLElement, options: StageOptions = {}) {
    this.root = root;
    this.onIdle = options.onIdle;
    this.reducedMotion = prefersReducedMotion();

    const tier = options.tier ?? detectQualityTier();
    const profile = profileFor(tier);
    if (this.reducedMotion) {
      // Same choreography, far less of it, and nothing flying at the face.
      profile.density *= 0.35;
      profile.maxForegroundCrossings = 0;
    }
    this.governor = new FrameGovernor(profile);

    if (options.safeZone) {
      this.camera.safeZone = { ...this.camera.safeZone, ...options.safeZone };
    }

    const makeCanvas = (): CanvasRenderingContext2D | null => {
      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.pointerEvents = "none";
      // willChange is set per plate by applyDepthOfField, and only on the
      // plates that actually carry a blur. The sharp middle plate is never
      // filtered, so promoting it just reserves GPU memory for nothing.
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) return null;
      this.root.appendChild(canvas);
      this.canvases.push(canvas);
      this.allContexts.push(ctx);
      return ctx;
    };

    const addLayer = (): void => {
      const ctx = makeCanvas();
      if (!ctx) return;
      this.contexts.push(ctx);
      this.layerCanvases.push(this.canvases[this.canvases.length - 1]!);
    };

    // Far plate first, then the persistence buffer, then the sharp middle
    // and the near plate. DOM order is the stacking order.
    addLayer();

    // The persistence buffer is never cleared, only faded. Light that
    // lands in it lingers for a few frames, which is what turns a moving
    // spark into a continuous trail instead of a dotted line.
    this.trailCtx = makeCanvas();
    this.trailCanvas = this.trailCtx ? (this.canvases[this.canvases.length - 1] ?? null) : null;

    addLayer();
    addLayer();

    this.applyDepthOfField();
    this.resize();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.root);
    }
  }

  get profile(): QualityProfile {
    return this.governor.current;
  }

  /** Reseed so every viewer renders an identical sequence. */
  setSeed(seed: number): void {
    this.rng = createRng(seed);
  }

  get random(): Rng {
    return this.rng;
  }

  // -------------------------------------------------------------------
  // Emitters — the vocabulary available to a choreography
  // -------------------------------------------------------------------

  /** Target level for the edge glow and light rays, 0..1. */
  setAtmosphere(level: number): void {
    this.atmosphereTarget = Math.max(0, Math.min(1, level));
  }

  emitEmbers(count: number, opts: { z?: number; fromBottom?: boolean } = {}): void {
    const n = this.scaled(count);
    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      this.embers.push(Ember.spawn(this.rng, this.camera, opts));
    }
  }

  emitStreaks(count: number): void {
    const n = this.scaled(count);
    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      this.streaks.push(Streak.spawn(this.rng, this.camera));
    }
  }

  /**
   * One firework. Stars are given a spherical velocity distribution that
   * is deliberately uneven — a perfectly even sphere reads as a graphic,
   * while clumping reads as a real shell.
   */
  burst(options: BurstOptions): void {
    const {
      x,
      y,
      z,
      count = 90,
      power = 620,
      color = this.rng.pick(SHELL_COLORS),
      flashRadius = 60,
      flare = false,
      life = 1.5,
      fragment = true,
      shape = "peony",
      pulse = 0,
    } = options;

    if (pulse > 0) this.pulse = Math.min(1, this.pulse + pulse);

    // Perspective alone shrinks a distant shell to a speck. Real displays
    // fire physically bigger shells further out, so partially compensating
    // for depth keeps far bursts legible while still reading as far away.
    const depthScale = Math.pow(1 + Math.max(0, z) / this.camera.focal, 0.72);
    const scaledPower = power * depthScale;
    const scaledFlash = flashRadius * depthScale;

    this.ignitions.push(new Ignition(x, y, z, scaledFlash, color, 0.95, flare));

    // A slight anisotropy per shell. Perfectly circular bursts are the
    // tell-tale of a generated effect; a real shell is always a little
    // lopsided from how it was packed and how it was tumbling.
    const stretchX = this.rng.range(0.88, 1.16);
    const stretchY = this.rng.range(0.86, 1.12);

    // Per-shape physics. Each of these is a recognisable firework in its
    // own right, which is what lets one preset read as a different
    // product from another rather than as the same one at a new tempo.
    const trail = shape === "palm" || shape === "willow";
    const gravity = shape === "willow" ? 190 : shape === "palm" ? 300 : 540;
    const drag = shape === "willow" ? 0.42 : shape === "palm" ? 0.3 : 0.12;
    const lifeScale = shape === "willow" ? 2.1 : shape === "palm" ? 1.7 : shape === "crackle" ? 0.55 : 1;
    const sizeScale = shape === "palm" ? 1.7 : shape === "crackle" ? 0.6 : shape === "willow" ? 0.8 : 1;
    const flicker = shape === "crackle" ? this.rng.range(26, 44) : undefined;

    const stars = this.scaled(count);
    for (let i = 0; i < stars && this.hasRoom(); i += 1) {
      const theta = this.rng.range(0, Math.PI * 2);
      // A crown keeps its stars close to one plane so the burst reads as
      // a ring; a palm throws thick fronds upward; the rest use a full
      // sphere.
      const phi =
        shape === "crown"
          ? Math.PI / 2 + this.rng.spread(0.22)
          : shape === "palm"
            ? this.rng.range(Math.PI * 0.18, Math.PI * 0.82)
            : Math.acos(this.rng.range(-1, 1));
      // Radial bias gives the shell a dense core and a sparse fringe
      // instead of a uniform shell of dots. A palm has few, even fronds.
      const bias =
        shape === "crown"
          ? this.rng.range(0.82, 1)
          : shape === "palm"
            ? this.rng.range(0.86, 1)
            : Math.pow(this.rng.next(), 0.55);
      const speed = scaledPower * bias * this.rng.range(0.75, 1.15);
      const vertical = shape === "palm" ? -Math.abs(Math.sin(phi) * Math.sin(theta)) : Math.sin(phi) * Math.sin(theta);

      this.sparks.push(
        new Spark({
          x,
          y,
          z,
          vx: Math.sin(phi) * Math.cos(theta) * speed * stretchX,
          vy: vertical * speed * stretchY,
          // Depth velocity is damped: stars flying straight at the lens
          // would otherwise dominate the frame.
          vz: Math.cos(phi) * speed * 0.45,
          life: life * this.rng.range(0.7, 1.25) * lifeScale,
          color: this.rng.chance(0.18) ? PALETTE.crystal : color,
          size: this.rng.range(1.1, 2.4) * sizeScale,
          generation: fragment ? 1 : 0,
          trailStrength: this.profile.trailStrength,
          // A willow hangs: weak gravity and little braking, so its
          // stars drape downwards for a long time after the flash.
          gravity,
          dragPerSecond: drag,
          flicker,
          // Only the slow, heavy shapes earn a persistence trail; putting
          // one on every star would smear the whole frame.
          trail: trail && this.profile.bloom,
        }),
      );
    }
  }

  /**
   * Launches shells from below the frame. They climb, arc, and detonate
   * at apex with the payload given here, so the explosion has a cause.
   */
  emitRockets(
    count: number,
    opts: {
      payload?: Omit<BurstOptions, "x" | "y" | "z">;
      depth?: [number, number];
      /** Fraction of frame height the apex should land at. */
      apex?: [number, number];
      side?: -1 | 1;
    } = {},
  ): void {
    const [minDepth, maxDepth] = opts.depth ?? [300, 1400];
    const [minApex, maxApex] = opts.apex ?? [0.12, 0.42];

    for (let i = 0; i < count && this.hasRoom(); i += 1) {
      const depth = this.rng.range(minDepth, maxDepth);
      const scale = this.camera.focal / (this.camera.focal + depth);
      const nx = opts.side
        ? opts.side < 0
          ? this.rng.range(0.08, 0.4)
          : this.rng.range(0.6, 0.92)
        : this.rng.range(0.08, 0.92);

      const startX = (nx * this.camera.width - this.camera.cx) / scale;
      const startY = (this.camera.height * 1.1 - this.camera.cy) / scale;
      const apexY =
        (this.camera.height * this.rng.range(minApex, maxApex) - this.camera.cy) / scale;

      // Solve the launch for a chosen *flight time* rather than a fixed
      // gravity. The world-space climb scales with depth, so a shared
      // gravity constant makes distant shells crawl for two seconds while
      // near ones snap up instantly. Fixing the time and deriving
      // gravity from it keeps every shell's ascent equally readable:
      //   h = ½·g·t²  ⇒  g = 2h/t²,  v = g·t
      const climb = Math.max(60, startY - apexY);
      const flight = this.rng.range(0.62, 0.95);
      const gravity = (2 * climb) / (flight * flight);

      this.rockets.push(
        new Rocket(
          startX,
          startY,
          depth,
          // Lateral drift in proportion to the climb, so the arc leans
          // the same amount whatever the depth.
          this.rng.spread(climb * 0.16),
          -gravity * flight,
          this.rng.chance(0.7) ? PALETTE.gold : PALETTE.champagne,
          opts.payload ?? {
            count: 110,
            power: 620,
            flashRadius: 74,
            life: 1.6,
          },
          gravity,
          flight + 0.25,
        ),
      );
    }
  }

  /**
   * A rising helix of dust around a vertical axis. Because the orbit is
   * real, motes pass in front of and behind the axis, which gives the
   * money effects a genuinely volumetric shape.
   */
  emitVortex(
    count: number,
    opts: {
      x?: number;
      z?: number;
      radius?: [number, number];
      /** Negative converges the helix inwards as it climbs. */
      radialVelocity?: number;
      angularVelocity?: number;
      rise?: [number, number];
      life?: [number, number];
      color?: string;
    } = {},
  ): void {
    const [minRadius, maxRadius] = opts.radius ?? [140, 340];
    const [minRise, maxRise] = opts.rise ?? [-190, -70];
    const [minLife, maxLife] = opts.life ?? [1.8, 3.4];
    const n = this.scaled(count);

    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      this.spirals.push(
        new Spiral(
          opts.x ?? 0,
          this.camera.halfHeight * this.rng.range(0.2, 0.95),
          opts.z ?? 260,
          this.rng.range(0, Math.PI * 2),
          this.rng.range(minRadius, maxRadius),
          (opts.angularVelocity ?? 2.1) * this.rng.range(0.75, 1.3),
          opts.radialVelocity ?? 18,
          this.rng.range(minRise, maxRise),
          this.rng.range(minLife, maxLife),
          this.rng.range(1.1, 2.6),
          opts.color ?? this.rng.pick(SHELL_COLORS),
        ),
      );
    }
  }

  /** A beam switched on behind the subject. */
  lightPillar(opts: { x?: number; z?: number; width?: number; color?: string; life?: number } = {}): void {
    this.pillars.push(
      new LightPillar(
        opts.x ?? 0,
        opts.z ?? 700,
        opts.width ?? this.camera.width * 0.3,
        opts.color ?? PALETTE.gold,
        opts.life ?? 2.2,
      ),
    );
  }

  /** One slow pass of light across the frame. */
  godraySweep(opts: { life?: number; color?: string; tilt?: number; peak?: number } = {}): void {
    this.sweeps.push(new GodraySweep(opts.life, opts.color, opts.tilt, opts.peak));
  }

  /**
   * Foil fired horizontally from off-frame, the way a stage cannon does
   * it. Completely different from a shower falling under gravity: the
   * pieces cross the frame fast and flat before the air takes them.
   */
  emitCannon(
    count: number,
    opts: {
      from: "left" | "right" | "bottom-left" | "bottom-right";
      power?: number;
      round?: boolean;
      scale?: number;
    },
  ): void {
    const n = this.scaled(count);
    const fromLeft = opts.from === "left" || opts.from === "bottom-left";
    const fromBottom = opts.from.startsWith("bottom");
    const power = opts.power ?? 900;

    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      const z = this.rng.range(-20, 520);
      const spanX = this.camera.halfWidth * (1 + z / this.camera.focal);
      const spanY = this.camera.halfHeight * (1 + z / this.camera.focal);
      // Cone of fire, aimed up and inwards.
      const spreadAngle = this.rng.range(fromBottom ? -1.15 : -0.75, fromBottom ? -0.45 : -0.1);
      const speed = power * this.rng.range(0.45, 1.3);
      const vx = (fromLeft ? 1 : -1) * Math.cos(spreadAngle) * speed;
      const vy = Math.sin(spreadAngle) * speed;
      // A real cannon empties over a fraction of a second, so the charge
      // becomes a long jet. Spawning it all at one point instead gives a
      // single travelling puck of foil; giving each piece a head start
      // along its own path stretches the volley out without needing a
      // staggered cue.
      const lead = this.rng.range(0, 0.34);

      this.confetti.push(
        Confetti.spawn(this.rng, this.camera, {
          x: (fromLeft ? -1 : 1) * spanX * 1.02 + vx * lead,
          y: (fromBottom ? spanY * 0.95 : spanY * this.rng.range(0.1, 0.6)) + vy * lead,
          z,
          vx,
          vy,
          vz: this.rng.spread(120),
          scale: opts.scale ?? this.rng.range(0.9, 1.5),
          life: this.rng.range(3, 5.5),
          round: opts.round,
        }),
      );
    }
  }

  emitConfetti(count: number, opts: Parameters<typeof Confetti.spawn>[2] = {}): void {
    const n = this.scaled(count);
    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      this.confetti.push(Confetti.spawn(this.rng, this.camera, opts));
    }
  }

  /**
   * Foil that passes between the viewer and the stage. Strictly rationed:
   * these are the most attention-grabbing elements in the whole effect and
   * they cross content, so the budget is small and they are launched from
   * the frame edges rather than through the middle.
   */
  emitForegroundConfetti(count: number): void {
    const budget = this.profile.maxForegroundCrossings - this.foregroundCount();
    const n = Math.min(count, Math.max(0, budget));
    for (let i = 0; i < n && this.hasRoom(); i += 1) {
      const fromLeft = this.rng.chance(0.5);
      const span = this.camera.halfWidth;
      this.confetti.push(
        Confetti.spawn(this.rng, this.camera, {
          // Start outside the frame, near a corner, travelling inwards
          // and towards the lens.
          x: fromLeft ? -span * 0.95 : span * 0.95,
          y: this.rng.range(-this.camera.halfHeight * 0.5, this.camera.halfHeight * 0.9),
          z: this.rng.range(60, 200),
          vx: (fromLeft ? 1 : -1) * this.rng.range(120, 240),
          vy: this.rng.range(-120, -30),
          // Negative depth velocity: it comes at the camera.
          vz: -this.rng.range(190, 330),
          scale: this.rng.range(2.2, 3.4),
          life: this.rng.range(1.6, 2.6),
        }),
      );
    }
  }

  shockwave(options: {
    x?: number;
    y?: number;
    z?: number;
    maxRadius?: number;
    life?: number;
    color?: string;
    thickness?: number;
  } = {}): void {
    const {
      x = 0,
      y = 0,
      z = 220,
      maxRadius = Math.max(this.camera.width, this.camera.height) * 0.95,
      life = 1.25,
      color = PALETTE.gold,
      thickness = 26,
    } = options;
    this.shockwaves.push(new Shockwave(x, y, z, maxRadius, life, color, thickness));
  }

  // SpawnSink — used by particles that create other particles.
  addSpark(spark: Spark): void {
    if (this.hasRoom()) this.sparks.push(spark);
  }

  addEmber(ember: Ember): void {
    if (this.hasRoom()) this.embers.push(ember);
  }

  /**
   * Picks a burst position that reads as "around the stage" rather than
   * "on top of the host": biased to the sides and to the upper frame, and
   * rejected outright if it projects inside the protected rectangle at a
   * depth shallow enough to obscure it.
   */
  pickBurstPosition(
    depth: number,
    /**
     * Forces the burst into one half of the frame. Pure randomness
     * reliably clumps several shells onto one side and leaves the other
     * dead, which reads as a bug rather than as a display.
     */
    side?: -1 | 1,
  ): { x: number; y: number; z: number } {
    // Aim in screen space and invert the projection, rather than picking
    // world coordinates and hoping. Picking in world space and dividing
    // by depth crowds every distant shell into a narrow band at the top
    // of the frame, which is the opposite of the layered sky we want.
    const scale = this.camera.focal / (this.camera.focal + depth);
    const toWorld = (sx: number, sy: number) => ({
      x: (sx - this.camera.cx) / scale,
      y: (sy - this.camera.cy) / scale,
      z: depth,
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const nx = side
        ? side < 0
          ? this.rng.range(0.05, 0.42)
          : this.rng.range(0.58, 0.95)
        : this.rng.range(0.05, 0.95);
      // Upper two thirds: shells belong in the air above the show.
      const ny = this.rng.range(0.07, 0.6);
      const sx = nx * this.camera.width;
      const sy = ny * this.camera.height;
      // Deep shells are allowed behind the host: they read as background.
      if (depth > 900 || !this.camera.isInsideSafeZone(sx, sy, -0.04)) {
        return toWorld(sx, sy);
      }
    }

    // Fallback: push it out to a side.
    const fallbackSide = side ?? (this.rng.chance(0.5) ? -1 : 1);
    return toWorld(
      this.camera.width * (fallbackSide < 0 ? 0.12 : 0.88),
      this.camera.height * 0.24,
    );
  }

  // -------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Drops every particle immediately. Used when the overlay unmounts. */
  clear(): void {
    this.embers.length = 0;
    this.streaks.length = 0;
    this.sparks.length = 0;
    this.ignitions.length = 0;
    this.confetti.length = 0;
    this.shockwaves.length = 0;
    this.rockets.length = 0;
    this.spirals.length = 0;
    this.pillars.length = 0;
    this.sweeps.length = 0;
    this.atmosphere = 0;
    this.atmosphereTarget = 0;
    this.pulse = 0;
    for (const ctx of this.contexts) {
      ctx.clearRect(0, 0, this.camera.width, this.camera.height);
    }
    this.trailCtx?.clearRect(0, 0, this.camera.width, this.camera.height);
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const canvas of this.canvases) canvas.remove();
    this.canvases.length = 0;
    this.allContexts.length = 0;
    this.layerCanvases.length = 0;
    this.contexts.length = 0;
    this.trailCanvas = null;
    this.trailCtx = null;
  }

  get isEmpty(): boolean {
    return (
      this.embers.length === 0 &&
      this.streaks.length === 0 &&
      this.sparks.length === 0 &&
      this.ignitions.length === 0 &&
      this.confetti.length === 0 &&
      this.shockwaves.length === 0 &&
      this.rockets.length === 0 &&
      this.spirals.length === 0 &&
      this.pillars.length === 0 &&
      this.sweeps.length === 0 &&
      this.atmosphere < 0.01
    );
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    // A backgrounded tab or a long GC must not teleport every particle.
    const dt = Math.min(frameMs, 50) / 1000;

    if (this.governor.sample(frameMs)) {
      // A downgrade changes both the blur passes and the pixel budget, so the
      // backing stores have to be re-sized for it to actually cost less.
      this.applyDepthOfField();
      this.resize();
    }

    this.onTick?.(Math.min(frameMs, 50));
    this.update(dt);
    this.render();

    if (this.isEmpty && !this.holding) {
      this.stop();
      this.onIdle?.();
      return;
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const ctx: UpdateContext = { dt, camera: this.camera, rng: this.rng, sink: this };

    this.atmosphereClock += dt;
    // Ease towards the target so a choreography can ramp the mood without
    // the glow ever snapping on.
    const ease = Math.min(1, dt * 2.4);
    this.atmosphere += (this.atmosphereTarget - this.atmosphere) * ease;

    // Detonation flash decays fast: it is an exposure change, not a mood.
    this.pulse *= Math.pow(0.06, dt);
    if (this.pulse < 0.004) this.pulse = 0;

    stepAll(this.embers, ctx, this.camera);
    stepAll(this.streaks, ctx, this.camera);
    stepAll(this.sparks, ctx, this.camera);
    stepAll(this.ignitions, ctx, this.camera);
    stepAll(this.confetti, ctx, this.camera);
    stepAll(this.shockwaves, ctx, this.camera);
    stepAll(this.rockets, ctx, this.camera);
    stepAll(this.spirals, ctx, this.camera);
    stepAll(this.pillars, ctx, this.camera);
    stepAll(this.sweeps, ctx, this.camera);
  }

  private render(): void {
    const { width, height } = this.camera;
    for (const ctx of this.contexts) ctx.clearRect(0, 0, width, height);
    if (this.contexts.length < 3) return;

    for (const layer of this.buckets) {
      layer[0].length = 0;
      layer[1].length = 0;
    }
    this.trailBucket.length = 0;

    this.sortInto(this.embers);
    this.sortInto(this.streaks);
    this.sortInto(this.sparks);
    this.sortInto(this.ignitions);
    this.sortInto(this.confetti);
    this.sortInto(this.shockwaves);
    this.sortInto(this.rockets);
    this.sortInto(this.spirals);
    this.sortInto(this.pillars);
    this.sortInto(this.sweeps);

    if (this.atmosphere > 0.01 || this.pulse > 0.01) this.drawAtmosphere(this.contexts[0]!);
    this.renderTrails();

    for (let layer = 0; layer < 3; layer += 1) {
      const ctx = this.contexts[layer];
      const bucket = this.buckets[layer];
      if (!ctx || !bucket) continue;
      const [opaque, additive] = bucket;

      if (opaque.length) {
        ctx.globalCompositeOperation = "source-over";
        for (const particle of opaque) particle.draw(ctx, this.camera, this.atlas);
      }
      if (additive.length) {
        ctx.globalCompositeOperation = "lighter";
        for (const particle of additive) particle.draw(ctx, this.camera, this.atlas);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    if (this.profile.bloom) this.applyBloom();
  }

  private sortInto(particles: Particle[]): void {
    for (const particle of particles) {
      if (this.camera.isCulled(particle.z)) continue;
      const layer = this.camera.layerFor(particle.z);
      this.buckets[layer][particle.opaque ? 0 : 1].push(particle);
      if (particle.trail) this.trailBucket.push(particle);
    }
  }

  /**
   * The persistence buffer. Instead of clearing, we erase a fraction of
   * the accumulated light each frame, so anything drawn here leaves a
   * smoothly decaying wake. A rocket's climb becomes one continuous
   * ribbon rather than a row of dots — this is the trick behind the long
   * light trails in broadcast graphics, and it costs one fill per frame.
   */
  private renderTrails(): void {
    const ctx = this.trailCtx;
    if (!ctx) return;
    const { width, height } = this.camera;

    ctx.globalCompositeOperation = "destination-out";
    // ~0.25/frame is roughly a quarter-second wake at 60fps. Slower decay
    // stops reading as a trail and starts reading as a painted stroke.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, width, height);

    if (this.trailBucket.length) {
      ctx.globalCompositeOperation = "lighter";
      for (const particle of this.trailBucket) {
        particle.draw(ctx, this.camera, this.atlas);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Edge glow and volumetric rays.
   *
   * Both are deliberately anchored to the frame border. Filling the centre
   * would fight the live video for attention, whereas light creeping in
   * from the edges reads as the room reacting to something happening in
   * it — which is exactly the build-up the brief describes.
   */
  private drawAtmosphere(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.camera;
    // The detonation flash rides on top of the ambient level and is
    // capped well below saturation: the brief is explicit that the whole
    // frame must never be flashed aggressively.
    const level = Math.min(1.35, this.atmosphere + this.pulse * 0.75);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Inverse vignette: transparent through the middle, warm at the edges.
    const radius = Math.hypot(width, height) * 0.62;
    const glow = ctx.createRadialGradient(
      width / 2,
      height / 2,
      radius * 0.42,
      width / 2,
      height / 2,
      radius,
    );
    glow.addColorStop(0, hexToRgba(PALETTE.gold, 0));
    glow.addColorStop(0.72, hexToRgba(PALETTE.gold, 0.09 * level));
    glow.addColorStop(1, hexToRgba(PALETTE.deepGold, 0.32 * level));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Volumetric shafts from above, drifting out of phase with each other.
    //
    // A hard-edged wedge is the single most artificial-looking thing you
    // can put over live video — it reads as a grey triangle, not as light
    // in air. Blurring the shafts as they are drawn is what turns them
    // into haze; without it the shape of the polygon is visible and the
    // whole build-up looks like a graphic.
    // Canvas-2D blur is charged per device pixel covered, and the radius here
    // is in CSS pixels on a scaled context, so a wide desktop player was
    // asking for a ~38px CSS radius over a plate several million pixels
    // large — three times per frame. Cap it: past about 30px the shafts read
    // as haze either way, and the far plate is already blurred again by the
    // depth-of-field pass on top.
    const canFilter = "filter" in ctx;
    if (canFilter) {
      const shaftBlur = Math.min(30, Math.max(18, width * 0.03));
      ctx.filter = `blur(${shaftBlur}px)`;
    }

    const rays = 3;
    for (let i = 0; i < rays; i += 1) {
      if (this.atmosphere <= 0.01) break;
      const phase = this.atmosphereClock * 0.16 + (i * Math.PI * 2) / rays;
      const originX = width * (0.24 + 0.26 * i);
      const originY = -height * 0.2;
      const angle = Math.sin(phase) * 0.16 + (i - 1) * 0.3;
      const length = Math.hypot(width, height) * 1.3;
      const halfWidth = width * 0.055;
      // Without the blur available, thin the shafts right down instead —
      // a faint sliver is far less objectionable than a crisp wedge.
      const alpha = (canFilter ? 0.085 : 0.045) * level;

      const beam = ctx.createLinearGradient(0, 0, 0, length);
      beam.addColorStop(0, hexToRgba(PALETTE.gold, alpha));
      beam.addColorStop(0.45, hexToRgba(PALETTE.gold, alpha * 0.55));
      beam.addColorStop(1, hexToRgba(PALETTE.gold, 0));

      ctx.save();
      ctx.translate(originX, originY);
      ctx.rotate(angle);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(-halfWidth * 0.4, 0);
      ctx.lineTo(halfWidth * 0.4, 0);
      ctx.lineTo(halfWidth * 2.4, length);
      ctx.lineTo(-halfWidth * 2.4, length);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (canFilter) ctx.filter = "none";
    ctx.restore();
  }

  /**
   * Cheap separable-ish bloom: downsample the mid plate, blur it on the
   * GPU through the canvas filter, then add it back. At quarter
   * resolution the blur radius is effectively 4× wider for a sixteenth of
   * the fill cost, which is what makes a real bloom affordable here.
   */
  private applyBloom(): void {
    const mid = this.layerCanvases[1];
    const ctx = this.contexts[1];
    if (!mid || !ctx) return;

    const bw = Math.max(1, Math.floor((this.camera.width * this.dpr) / 4));
    const bh = Math.max(1, Math.floor((this.camera.height * this.dpr) / 4));

    if (!this.bloomCanvas) {
      this.bloomCanvas = document.createElement("canvas");
      this.bloomCtx = this.bloomCanvas.getContext("2d");
    }
    const bloom = this.bloomCanvas;
    const bctx = this.bloomCtx;
    if (!bloom || !bctx || !("filter" in bctx)) return;

    if (bloom.width !== bw || bloom.height !== bh) {
      bloom.width = bw;
      bloom.height = bh;
    }

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, bw, bh);
    bctx.filter = "blur(4px)";
    bctx.drawImage(mid, 0, 0, bw, bh);
    bctx.filter = "none";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Two passes at different radii. A single-radius bloom gives a tight
    // ring that reads as a glow *effect*; adding a much wider, fainter
    // halo on top is what real lens bloom looks like and what makes a
    // detonation feel like it is lighting the room.
    ctx.globalAlpha = 0.42;
    ctx.drawImage(bloom, 0, 0, this.camera.width, this.camera.height);
    ctx.globalAlpha = 0.2;
    const spread = Math.max(this.camera.width, this.camera.height) * 0.035;
    ctx.drawImage(
      bloom,
      -spread,
      -spread,
      this.camera.width + spread * 2,
      this.camera.height + spread * 2,
    );
    ctx.restore();
  }

  private applyDepthOfField(): void {
    const on = this.profile.depthOfField;
    const set = (canvas: HTMLCanvasElement | null, blur: string): void => {
      if (!canvas) return;
      canvas.style.filter = on ? blur : "none";
      // Only hint the compositor about a filter that exists. Promoting four
      // full-frame layers for a filter none of them carry costs GPU memory
      // for nothing, and on a large desktop player that memory pressure is
      // enough to push compositing onto a slower path.
      canvas.style.willChange = on ? "filter" : "auto";
    };
    set(this.layerCanvases[0] ?? null, "blur(1.6px)");
    set(this.layerCanvases[2] ?? null, "blur(4.5px)");
    // A touch of blur on the trails keeps them reading as light in the
    // air rather than as drawn ribbons.
    set(this.trailCanvas, "blur(2px)");
  }

  /**
   * The far plate, the near plate and the persistence buffer all carry a CSS
   * blur while depth of field is on, so their backing store is being blurred
   * by the compositor on every single frame. Rendering them at half scale
   * costs a quarter of the fill and a quarter of the blur, and the blur then
   * hides the lower resolution — a 4.5px blur over a half-scale plate is
   * indistinguishable from the same blur over a full-scale one.
   *
   * With depth of field off there is no blur to hide it, so they stay sharp.
   */
  private static readonly SOFT_PLATE_SCALE = 0.5;

  private plateScaleFor(canvas: HTMLCanvasElement): number {
    if (!this.profile.depthOfField) return 1;
    const isSoft =
      canvas === this.layerCanvases[0] ||
      canvas === this.layerCanvases[2] ||
      canvas === this.trailCanvas;
    return isSoft ? CinematicStage.SOFT_PLATE_SCALE : 1;
  }

  private resize(): void {
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    let ratio = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio);

    // Fit the plate inside the tier's pixel budget. A desktop player is far
    // wider than a phone's, so capping the ratio alone still let a retina
    // desktop allocate several million pixels per plate and then blur them
    // sixty times a second — which is why desktop stuttered while mobile,
    // with a small element and no depth of field, stayed smooth.
    const budget = this.profile.maxCanvasPixels;
    if (budget > 0 && width * height * ratio * ratio > budget) {
      ratio = Math.max(1, Math.sqrt(budget / (width * height)));
    }

    this.dpr = ratio;

    for (let i = 0; i < this.canvases.length; i += 1) {
      const canvas = this.canvases[i]!;
      const scale = ratio * this.plateScaleFor(canvas);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      this.allContexts[i]?.setTransform(scale, 0, 0, scale, 0, 0);
    }

    this.camera.resize(width, height);
  }

  private scaled(count: number): number {
    return Math.max(0, Math.round(count * this.profile.density));
  }

  private hasRoom(): boolean {
    return this.total < HARD_PARTICLE_CAP;
  }

  private get total(): number {
    return (
      this.embers.length +
      this.streaks.length +
      this.sparks.length +
      this.ignitions.length +
      this.confetti.length +
      this.shockwaves.length +
      this.rockets.length +
      this.spirals.length
    );
  }

  private foregroundCount(): number {
    let count = 0;
    for (const piece of this.confetti) {
      if (piece.z < LAYER_FRONT_Z) count += 1;
    }
    return count;
  }
}

/** Advance a pool, compacting the dead out in a single pass. */
function stepAll<T extends Particle>(pool: T[], ctx: UpdateContext, camera: Camera): void {
  let write = 0;
  for (let read = 0; read < pool.length; read += 1) {
    const particle = pool[read]!;
    particle.update(ctx);
    // Anything that has fallen far below the frame is gone for good.
    if (!particle.dead && camera.isCulled(particle.z)) particle.dead = true;
    if (!particle.dead) {
      pool[write] = particle;
      write += 1;
    }
  }
  pool.length = write;
}
