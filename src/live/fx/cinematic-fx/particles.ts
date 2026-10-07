/**
 * The particle vocabulary.
 *
 * Each type models one physical behaviour rather than one visual shape, so
 * the choreographies can combine them into different effects without new
 * rendering code. They all share the same contract: advance by `dt`
 * seconds, then draw themselves through the perspective camera onto
 * whichever depth layer their `z` puts them on.
 */

import { Camera, type LayerIndex, type Projected } from "./camera";
import type { Rng } from "./rng";
import {
  CONFETTI_COLORS,
  PALETTE,
  SPARK_COLORS,
  SpriteAtlas,
  hexToRgba,
  mixHex,
} from "./sprites";

/** Everything a particle needs from the world while updating. */
export interface UpdateContext {
  dt: number;
  camera: Camera;
  rng: Rng;
  /** Fragmentation and secondary bursts push new particles through this. */
  sink: SpawnSink;
}

export interface SpawnSink {
  addSpark(spark: Spark): void;
  addEmber(ember: Ember): void;
  /** Rockets detonate through this when they reach apex. */
  burst(options: BurstOptions): void;
}

export interface Particle {
  z: number;
  dead: boolean;
  update(ctx: UpdateContext): void;
  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void;
  /** True when the particle uses `source-over` instead of additive light. */
  readonly opaque?: boolean;
  /**
   * Deposits light into the persistence buffer as well as the current
   * frame, leaving a smooth decaying trail behind it.
   */
  readonly trail?: boolean;
}

/**
 * Shell types. Real displays mix a handful of recognisable firing
 * patterns, and it is the *contrast* between them that makes a sky look
 * professionally programmed. A sequence of identical bursts reads as a
 * loop no matter how good the individual explosion is.
 */
export type ShellShape = "peony" | "willow" | "crown" | "palm" | "crackle";

export interface BurstOptions {
  /** World coordinates relative to frame centre. */
  x: number;
  y: number;
  z: number;
  /** Roughly the number of stars before density scaling. */
  count?: number;
  /** Launch speed of the stars. */
  power?: number;
  color?: string;
  /** Radius of the ignition bloom. */
  flashRadius?: number;
  /** Anamorphic lens streak. Use on hero shells only. */
  flare?: boolean;
  /** How long the stars burn. */
  life?: number;
  /** Chance for stars to split into a secondary crackle. */
  fragment?: boolean;
  shape?: ShellShape;
  /** Spikes the edge bloom, as a big detonation lights the room. */
  pulse?: number;
}

/**
 * Draws a sprite stretched along a direction — one `drawImage` that reads
 * as a motion-blurred streak. Cheaper than a multi-sample trail and
 * closer to what a real camera shutter does to a moving spark.
 */
function drawStreak(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  angle: number,
  length: number,
  thickness: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sprite, -length * 0.5, -thickness * 0.5, length, thickness);
  ctx.restore();
}

/**
 * Draws light along the path a particle actually covered this frame.
 *
 * A fast mote can cross fifty pixels between frames, so stamping a
 * sprite at its current position leaves a dotted line — the giveaway of
 * a cheap particle system, and no amount of trail persistence fixes it
 * because the gaps are baked in. Spanning from the previous position to
 * the current one makes consecutive frames butt together into one
 * continuous ribbon at any speed.
 */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  from: Projected,
  to: Projected,
  thickness: number,
  alpha: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  drawStreak(
    ctx,
    sprite,
    (from.x + to.x) * 0.5,
    (from.y + to.y) * 0.5,
    Math.atan2(dy, dx),
    distance + thickness,
    thickness,
    alpha,
  );
}

// ---------------------------------------------------------------------------
// Ember — the slow atmospheric motes
// ---------------------------------------------------------------------------

/**
 * Gold dust. Used for the build-up (rising into frame), as the residue
 * that outlives the fireworks, and as the glitter that keeps drifting
 * during the finish. Cheap, so it carries the density on low tiers.
 */
export class Ember implements Particle {
  dead = false;
  private age = 0;

  constructor(
    public x: number,
    public y: number,
    public z: number,
    private vx: number,
    private vy: number,
    private vz: number,
    private life: number,
    private size: number,
    private color: string,
    /** Peak opacity; a spread of values stops the field looking uniform. */
    private peak: number,
    /** Radians per second of drift oscillation. */
    private swayRate: number,
    private swayPhase: number,
  ) {}

  static spawn(rng: Rng, camera: Camera, opts: { z?: number; fromBottom?: boolean } = {}): Ember {
    const z = opts.z ?? rng.range(-40, 1500);
    const spanX = camera.halfWidth * (1 + z / camera.focal) * 1.2;
    const spanY = camera.halfHeight * (1 + z / camera.focal);
    return new Ember(
      rng.spread(spanX),
      opts.fromBottom === false ? rng.spread(spanY) : spanY * rng.range(0.7, 1.15),
      z,
      rng.spread(14),
      // Motes rise: warm air over a stage. Slower ones read as further.
      -rng.range(16, 52),
      rng.spread(10),
      rng.range(2.4, 5.2),
      rng.range(1.2, 3.4),
      rng.pick(SPARK_COLORS),
      rng.range(0.25, 0.7),
      rng.range(0.6, 1.8),
      rng.range(0, Math.PI * 2),
    );
  }

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    this.swayPhase += this.swayRate * dt;
    this.x += (this.vx + Math.sin(this.swayPhase) * 12) * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    // Ease in and out so motes never pop into or out of existence.
    const fade = t < 0.18 ? t / 0.18 : t > 0.7 ? (1 - t) / 0.3 : 1;
    const p = camera.project(this.x, this.y, this.z);
    const radius = this.size * p.scale * 6;
    const sprite = atlas.ember(this.color);
    ctx.globalAlpha = this.peak * fade;
    ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Streak — light rays entering the frame during the build
// ---------------------------------------------------------------------------

/**
 * A fast, thin light streak. These are the first thing the viewer sees:
 * they establish that something is arriving before anything explodes.
 */
export class Streak implements Particle {
  dead = false;
  private age = 0;

  constructor(
    private x: number,
    private y: number,
    public z: number,
    private vx: number,
    private vy: number,
    private life: number,
    private length: number,
    private color: string,
  ) {}

  static spawn(rng: Rng, camera: Camera): Streak {
    const z = rng.range(120, 1100);
    const spanX = camera.halfWidth * (1 + z / camera.focal);
    const spanY = camera.halfHeight * (1 + z / camera.focal);
    // Enter from an edge and travel inwards at a shallow angle.
    const fromLeft = rng.chance(0.5);
    const speed = rng.range(420, 900);
    const angle = rng.spread(0.5) + (fromLeft ? 0 : Math.PI);
    return new Streak(
      fromLeft ? -spanX * 1.1 : spanX * 1.1,
      rng.spread(spanY * 0.85),
      z,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed * 0.35,
      rng.range(0.5, 1.0),
      rng.range(90, 240),
      rng.chance(0.82) ? PALETTE.gold : PALETTE.electric,
    );
  }

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    const fade = Math.sin(Math.PI * t);
    const p = camera.project(this.x, this.y, this.z);
    drawStreak(
      ctx,
      atlas.glow(this.color),
      p.x,
      p.y,
      Math.atan2(this.vy, this.vx),
      this.length * p.scale,
      10 * p.scale,
      fade * 0.5,
    );
  }
}

// ---------------------------------------------------------------------------
// Spark — firework debris
// ---------------------------------------------------------------------------

export interface SparkOptions {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: string;
  size: number;
  /** Remaining fragmentation generations. */
  generation: number;
  trailStrength: number;
  /** Downward acceleration. Low values give long, hanging willow trails. */
  gravity?: number;
  /**
   * Fraction of velocity surviving one second. Small numbers brake hard
   * (a crisp peony); larger numbers let stars keep coasting.
   */
  dragPerSecond?: number;
  /**
   * Strobing rate in Hz. Crackle shells use fast-twinkling stars, which
   * is a completely different texture from a smooth-burning peony and
   * the cheapest way to make two explosions read as different products.
   */
  flicker?: number;
  /** Deposit into the persistence buffer, leaving a long light trail. */
  trail?: boolean;
}

/**
 * A single ember thrown by an explosion. Its whole character comes from
 * the interaction of four things: drag that kills the initial velocity
 * fast, gravity that takes over afterwards, a brightness curve that decays
 * faster than the motion, and — for first-generation sparks — a chance to
 * fragment part-way through life the way a real shell's stars do.
 */
export class Spark implements Particle {
  dead = false;
  private age = 0;
  private readonly life: number;
  private readonly maxSpeed: number;
  private readonly phase: number;
  readonly trail: boolean;

  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;

  constructor(private readonly opts: SparkOptions) {
    this.x = opts.x;
    this.y = opts.y;
    this.z = opts.z;
    this.vx = opts.vx;
    this.vy = opts.vy;
    this.vz = opts.vz;
    this.life = opts.life;
    this.maxSpeed = Math.hypot(opts.vx, opts.vy) || 1;
    this.trail = opts.trail ?? false;
    // Derived from the launch vector so each star strobes out of step
    // with its siblings without needing another random draw.
    this.phase = (opts.vx + opts.vy) * 0.01;
  }

  update({ dt, rng, sink }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }

    // Air resistance, frame-rate independent. Sparks lose most of their
    // launch speed within the first third of a second, which is what makes
    // an explosion read as a burst rather than a starburst of straight
    // lines.
    const drag = Math.pow(this.opts.dragPerSecond ?? 0.12, dt);
    this.vx *= drag;
    this.vy *= drag;
    this.vz *= drag;
    this.vy += (this.opts.gravity ?? 540) * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    // Fragmentation: a fraction of the stars split into a small secondary
    // spray. The window is narrow so the crackle happens as one event
    // rather than as a continuous drizzle.
    const t = this.age / this.life;
    if (this.opts.generation > 0 && t > 0.32 && t < 0.44 && rng.chance(0.06)) {
      const children = rng.int(2, 4);
      for (let i = 0; i < children; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const speed = rng.range(40, 130);
        sink.addSpark(
          new Spark({
            x: this.x,
            y: this.y,
            z: this.z,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: rng.spread(60),
            life: this.life * rng.range(0.3, 0.5),
            color: rng.chance(0.7) ? PALETTE.crystal : this.opts.color,
            size: this.opts.size * 0.6,
            generation: 0,
            trailStrength: this.opts.trailStrength,
          }),
        );
      }
      // Splitting consumes the parent's remaining fuel.
      this.opts.generation = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    // Brightness falls off far faster than position changes — the star is
    // still moving long after it has stopped being a light source.
    let brightness = Math.pow(1 - t, 1.9);
    if (this.opts.flicker) {
      // Twinkle rather than blink: the star never fully extinguishes, it
      // just pulses, which is how magnesium glitter actually behaves.
      brightness *= 0.32 + 0.68 * Math.abs(Math.sin(this.age * this.opts.flicker + this.phase));
    }
    if (brightness <= 0.01) return;

    const p = camera.project(this.x, this.y, this.z);
    const speed = Math.hypot(this.vx, this.vy);
    const radius = this.opts.size * p.scale;

    // The streak is proportional to how fast the star is actually moving,
    // so it smears on launch and settles into a round ember as it slows.
    const smear = (speed / this.maxSpeed) * this.opts.trailStrength;
    if (smear > 0.08) {
      drawStreak(
        ctx,
        atlas.glow(this.opts.color),
        p.x,
        p.y,
        Math.atan2(this.vy, this.vx),
        radius * (6 + smear * 30),
        radius * 5,
        brightness * 0.4,
      );
    }

    const sprite = atlas.ember(this.opts.color);
    const head = radius * 4;
    ctx.globalAlpha = brightness;
    ctx.drawImage(sprite, p.x - head, p.y - head, head * 2, head * 2);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Rocket — the shell on its way up
// ---------------------------------------------------------------------------

/**
 * A shell climbing to its detonation point, trailing sparks.
 *
 * This is the single biggest realism upgrade available: explosions that
 * simply appear have no cause, and the eye reads them as decoration. A
 * rocket gives the burst a launch, an arc and an apex, so the display
 * becomes something that is being *fired* rather than something that is
 * being drawn.
 */
export class Rocket implements Particle {
  readonly trail = true;
  dead = false;
  private age = 0;
  private spawnClock = 0;
  private prevX: number;
  private prevY: number;

  constructor(
    private x: number,
    private y: number,
    public z: number,
    private vx: number,
    private vy: number,
    private readonly color: string,
    /** Detonation to fire at apex. Position is filled in on arrival. */
    private readonly payload: Omit<BurstOptions, "x" | "y" | "z">,
    /**
     * Set by the launcher from the desired flight time, not a fixed
     * constant: the world-space climb varies enormously with depth, so a
     * shared gravity would make far shells crawl and near ones snap.
     */
    private readonly gravity = 2400,
    /** Safety valve in case the arc never reaches apex on screen. */
    private readonly maxLife = 1.6,
  ) {
    this.prevX = x;
    this.prevY = y;
  }

  update({ dt, rng, sink }: UpdateContext): void {
    this.age += dt;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vy += this.gravity * dt;
    // Slight lateral bleed, so the climb is an arc and not a ruler line.
    this.vx *= Math.pow(0.6, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Motor exhaust. Emitted at a fixed rate along the path actually
    // covered this frame rather than once per frame at the current
    // position — a shell moving 40px between frames would otherwise lay
    // down a row of evenly spaced beads instead of a plume.
    const interval = 0.006;
    this.spawnClock += dt;
    while (this.spawnClock >= interval) {
      this.spawnClock -= interval;
      const back = this.spawnClock / dt;
      sink.addSpark(
        new Spark({
          x: this.x + (this.prevX - this.x) * back,
          y: this.y + (this.prevY - this.y) * back,
          z: this.z,
          vx: -this.vx * 0.08 + rng.spread(30),
          vy: -this.vy * 0.05 + rng.spread(30),
          vz: rng.spread(18),
          life: rng.range(0.14, 0.34),
          color: rng.chance(0.4) ? PALETTE.crystal : this.color,
          size: rng.range(0.5, 1),
          generation: 0,
          trailStrength: 0.5,
          gravity: 240,
        }),
      );
    }

    // Apex, or the fuse burning out. Either way, this is the detonation.
    if (this.vy >= -this.gravity * 0.04 || this.age >= this.maxLife) {
      this.dead = true;
      sink.burst({ ...this.payload, x: this.x, y: this.y, z: this.z });
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const p = camera.project(this.x, this.y, this.z);
    const previous = camera.project(this.prevX, this.prevY, this.z);
    const radius = 3.4 * p.scale;
    // The exhaust column: light laid down over the ground the shell
    // covered this frame, which the persistence buffer then fades into a
    // continuous ribbon behind it.
    drawSegment(ctx, atlas.glow(this.color), previous, p, radius * 4.2, 0.55);
    const sprite = atlas.ember(PALETTE.crystal);
    const head = radius * 2.6;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(sprite, p.x - head, p.y - head, head * 2, head * 2);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Spiral — dust orbiting the stage
// ---------------------------------------------------------------------------

/**
 * A mote travelling a rising helix around a vertical axis.
 *
 * Because the orbit is computed in world space and then projected, the
 * mote genuinely passes behind and in front of the axis — growing as it
 * swings towards the lens and shrinking as it goes round the back. A
 * column of these is unmistakably three-dimensional in a way no amount
 * of two-dimensional swirling can fake, and it gives the money effects a
 * shape of their own.
 */
export class Spiral implements Particle {
  readonly trail = true;
  dead = false;
  z: number;
  private age = 0;
  private prevX: number;
  private prevY: number;
  private prevZ: number;

  constructor(
    /** Axis position in world space. */
    private readonly originX: number,
    private y: number,
    private readonly originZ: number,
    private angle: number,
    private radius: number,
    private readonly angularVelocity: number,
    /** Radial growth per second. Negative pulls the helix inwards. */
    private readonly radialVelocity: number,
    private readonly rise: number,
    private readonly life: number,
    private readonly size: number,
    private readonly color: string,
  ) {
    this.z = originZ + Math.sin(angle) * radius;
    this.prevX = originX + Math.cos(angle) * radius;
    this.prevY = y;
    this.prevZ = this.z;
  }

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }
    this.prevX = this.originX + Math.cos(this.angle) * this.radius;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.angle += this.angularVelocity * dt;
    this.radius = Math.max(0, this.radius + this.radialVelocity * dt);
    this.y += this.rise * dt;
    this.z = this.originZ + Math.sin(this.angle) * this.radius;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    const fade = t < 0.12 ? t / 0.12 : t > 0.72 ? (1 - t) / 0.28 : 1;
    if (fade <= 0.01) return;

    const x = this.originX + Math.cos(this.angle) * this.radius;
    const p = camera.project(x, this.y, this.z);
    const previous = camera.project(this.prevX, this.prevY, this.prevZ);
    const radius = this.size * p.scale * 3.2;
    // Orbital speed is high, so the arc has to be drawn as travelled
    // distance or the helix breaks up into beads.
    drawSegment(ctx, atlas.glow(this.color), previous, p, radius * 1.5, fade * 0.4);
    ctx.globalAlpha = fade * 0.6;
    ctx.drawImage(atlas.ember(this.color), p.x - radius, p.y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// LightPillar — a shaft of light standing on the stage
// ---------------------------------------------------------------------------

/**
 * A vertical column of light rising behind the subject.
 *
 * Unlike the ambient shafts, this one is an event: it snaps up, holds,
 * and drains. It reads as a beam that has been switched on for the
 * announcement, which is why it belongs to the reveal effects rather
 * than to the general celebration.
 */
export class LightPillar implements Particle {
  dead = false;
  private age = 0;

  constructor(
    private readonly x: number,
    public z: number,
    private readonly width: number,
    private readonly color: string,
    private readonly life = 2.2,
  ) {}

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const t = this.age / this.life;
    // Snap up over ~180ms, hold, then drain away.
    const rise = Math.min(1, t / 0.08);
    const fade = t > 0.45 ? Math.pow(1 - (t - 0.45) / 0.55, 2) : 1;
    const alpha = rise * fade;
    if (alpha <= 0.01) return;

    const p = camera.project(this.x, 0, this.z);
    const halfWidth = this.width * p.scale * 0.5;
    const top = camera.height * (0.5 - 0.62 * rise);
    const bottom = camera.height * 1.02;

    const canFilter = "filter" in ctx;
    if (canFilter) ctx.filter = `blur(${Math.max(10, halfWidth * 0.5)}px)`;

    const gradient = ctx.createLinearGradient(0, bottom, 0, top);
    gradient.addColorStop(0, hexToRgba(this.color, 0.34 * alpha));
    gradient.addColorStop(0.45, hexToRgba(this.color, 0.16 * alpha));
    gradient.addColorStop(1, hexToRgba(this.color, 0));
    ctx.fillStyle = gradient;
    // Slightly wider at the top: a real beam spreads as it travels.
    ctx.beginPath();
    ctx.moveTo(p.x - halfWidth, bottom);
    ctx.lineTo(p.x + halfWidth, bottom);
    ctx.lineTo(p.x + halfWidth * 1.5, top);
    ctx.lineTo(p.x - halfWidth * 1.5, top);
    ctx.closePath();
    ctx.fill();

    if (canFilter) ctx.filter = "none";
  }
}

// ---------------------------------------------------------------------------
// GodraySweep — a beam crossing the frame
// ---------------------------------------------------------------------------

/**
 * A wide, soft shaft that sweeps across the whole frame once.
 *
 * A single slow pass of light is the calmest way to signal "something is
 * happening" and it is the only major gesture in the quieter effects,
 * which is what keeps those from feeling like a thinned-out version of
 * the fireworks.
 */
export class GodraySweep implements Particle {
  dead = false;
  z = 1600;
  private age = 0;

  constructor(
    private readonly life = 1.8,
    private readonly color: string = PALETTE.champagne,
    private readonly tilt = -0.42,
    private readonly peak = 0.16,
  ) {}

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const t = this.age / this.life;
    // Fades in and out across the pass so it never appears or vanishes
    // while it is on screen.
    const alpha = Math.sin(Math.PI * t) * this.peak;
    if (alpha <= 0.004) return;

    const { width, height } = camera;
    const span = width * 1.6;
    const centreX = -width * 0.3 + span * t;
    const halfWidth = width * 0.11;
    const length = Math.hypot(width, height) * 1.6;

    const canFilter = "filter" in ctx;
    if (canFilter) ctx.filter = `blur(${Math.max(24, width * 0.035)}px)`;

    const gradient = ctx.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, hexToRgba(this.color, alpha));
    gradient.addColorStop(0.55, hexToRgba(this.color, alpha * 0.5));
    gradient.addColorStop(1, hexToRgba(this.color, 0));

    ctx.save();
    ctx.translate(centreX, -height * 0.3);
    ctx.rotate(this.tilt);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(-halfWidth * 0.5, 0);
    ctx.lineTo(halfWidth * 0.5, 0);
    ctx.lineTo(halfWidth * 1.8, length);
    ctx.lineTo(-halfWidth * 1.8, length);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (canFilter) ctx.filter = "none";
  }
}

// ---------------------------------------------------------------------------
// Ignition — the flash and haze at the heart of an explosion
// ---------------------------------------------------------------------------

/**
 * The bloom at the origin of a burst, plus the warm haze it leaves behind.
 * Modelled separately from the sparks because the flash is what sells the
 * energy, and it has a completely different (much shorter) time constant.
 */
export class Ignition implements Particle {
  dead = false;
  private age = 0;

  constructor(
    private x: number,
    private y: number,
    public z: number,
    private radius: number,
    private color: string,
    private life = 0.9,
    /** Anamorphic lens streak — reserved for the biggest shells. */
    private withFlare = false,
  ) {}

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    const p = camera.project(this.x, this.y, this.z);

    // Two overlapping envelopes: a hard flash over the first ~120ms, then
    // a slow warm haze that lingers where the shell burned.
    const flash = Math.pow(1 - Math.min(1, t / 0.14), 2.2);
    const haze = Math.pow(1 - t, 2.6) * 0.28;

    if (haze > 0.004) {
      const r = this.radius * p.scale * (1 + t * 1.9);
      ctx.globalAlpha = haze;
      ctx.drawImage(atlas.glow(this.color), p.x - r, p.y - r, r * 2, r * 2);
    }

    if (flash > 0.01) {
      const r = this.radius * p.scale * (0.5 + flash * 0.8);
      ctx.globalAlpha = flash;
      ctx.drawImage(atlas.glow(PALETTE.crystal), p.x - r, p.y - r, r * 2, r * 2);

      if (this.withFlare) {
        const width = this.radius * p.scale * 7;
        const height = this.radius * p.scale * 0.55;
        ctx.globalAlpha = flash * 0.75;
        ctx.drawImage(atlas.flare(), p.x - width / 2, p.y - height / 2, width, height);
      }
    }

    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Confetti — metallic foil with a real surface
// ---------------------------------------------------------------------------

/**
 * A rectangle of metallic foil, rotated in three dimensions and shaded by
 * its own surface normal.
 *
 * This is the piece that most separates the effect from a confetti
 * library. The quad's four corners are rotated in world space and
 * projected individually, so the shape genuinely foreshortens: seen
 * edge-on it collapses to a bright sliver, and the face brightness tracks
 * the angle between its normal and the key light. That is what produces
 * the flicker of real foil tumbling under studio lamps.
 */
export class Confetti implements Particle {
  readonly opaque = true;
  dead = false;
  private age = 0;

  private rx: number;
  private ry: number;
  private rz: number;

  constructor(
    private x: number,
    private y: number,
    public z: number,
    private vx: number,
    private vy: number,
    private vz: number,
    private readonly halfW: number,
    private readonly halfH: number,
    private readonly color: string,
    private readonly life: number,
    private readonly spinX: number,
    private readonly spinY: number,
    private readonly spinZ: number,
    /** Flutter amplitude — how much the piece rocks as it falls. */
    private readonly flutter: number,
    private readonly flutterRate: number,
    /** Terminal velocity; lighter pieces hang in the air longer. */
    private readonly terminal: number,
    /**
     * How much the piece is bowed across its long axis. Foil is never
     * flat, and the curl is what lets one half catch the light while the
     * other is in shadow.
     */
    private readonly curl: number,
    /**
     * Struck metal disc rather than a sheet of foil. Same tumbling
     * physics, completely different read — this is what turns a confetti
     * shower into a shower of coins for the money effects.
     */
    private readonly round = false,
  ) {
    this.rx = spinX;
    this.ry = spinY;
    this.rz = spinZ;
  }

  static spawn(
    rng: Rng,
    camera: Camera,
    opts: {
      x?: number;
      y?: number;
      z?: number;
      vx?: number;
      vy?: number;
      vz?: number;
      scale?: number;
      life?: number;
      round?: boolean;
    } = {},
  ): Confetti {
    const z = opts.z ?? rng.range(-30, 900);
    const spanX = camera.halfWidth * (1 + z / camera.focal);
    const spanY = camera.halfHeight * (1 + z / camera.focal);
    const scale = opts.scale ?? 1;
    const round = opts.round ?? false;
    // Foil comes in a few stock cuts: squares, long ribbons, thin
    // slivers. Coins are struck round, so they are always square in plan.
    const aspect = round ? 1 : rng.pick([1, 1, 0.45, 0.3, 2.2]);
    const base = rng.range(7, 15) * scale;

    return new Confetti(
      opts.x ?? rng.spread(spanX),
      opts.y ?? -spanY * rng.range(1.0, 1.6),
      z,
      opts.vx ?? rng.spread(90),
      opts.vy ?? rng.range(-40, 40),
      opts.vz ?? rng.spread(50),
      base,
      base * aspect,
      rng.pick(CONFETTI_COLORS),
      opts.life ?? rng.range(3.2, 6.5),
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2),
      rng.range(0, Math.PI * 2),
      rng.range(0.5, 1.6),
      rng.range(1.6, 4.2),
      // Coins are heavier: they punch down through the air rather than
      // planing on it.
      round ? rng.range(230, 400) : rng.range(110, 240),
      rng.range(0.22, 0.55),
      round,
    );
  }

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      return;
    }

    // Tumble. Three independent rates plus a rocking term keeps any two
    // pieces from ever looking synchronised.
    this.rx += (this.spinX * 0.9 + Math.sin(this.age * this.flutterRate) * this.flutter) * dt;
    this.ry += this.spinY * 0.8 * dt;
    this.rz += this.spinZ * 0.5 * dt;

    // Air resistance is strong sideways and asymptotic vertically, so
    // pieces settle to a terminal velocity instead of accelerating away.
    const drag = Math.pow(0.55, dt);
    this.vx *= drag;
    this.vz *= drag;
    this.vy += (this.terminal - this.vy) * Math.min(1, dt * 1.6);

    // Sideways drift as the piece planes on the air it is rocking against.
    this.x += (this.vx + Math.sin(this.age * this.flutterRate + this.ry) * 46) * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const t = this.age / this.life;
    const fade = t < 0.06 ? t / 0.06 : t > 0.82 ? (1 - t) / 0.18 : 1;
    if (fade <= 0.01) return;

    const cosX = Math.cos(this.rx);
    const sinX = Math.sin(this.rx);
    const cosY = Math.cos(this.ry);
    const sinY = Math.sin(this.ry);
    const cosZ = Math.cos(this.rz);
    const sinZ = Math.sin(this.rz);

    // Rotate a local point by Z, then Y, then X.
    const rotate = (lx: number, ly: number): [number, number, number] => {
      const x1 = lx * cosZ - ly * sinZ;
      const y1 = lx * sinZ + ly * cosZ;
      const x2 = x1 * cosY;
      const z2 = -x1 * sinY;
      const y3 = y1 * cosX - z2 * sinX;
      const z3 = y1 * sinX + z2 * cosX;
      return [x2, y3, z3];
    };

    const corner = (lx: number, ly: number): { x: number; y: number } => {
      const [wx, wy, wz] = rotate(lx, ly);
      return camera.project(this.x + wx, this.y + wy, this.z + wz);
    };
    const screen = [
      corner(-this.halfW, -this.halfH),
      corner(this.halfW, -this.halfH),
      corner(this.halfW, this.halfH),
      corner(-this.halfW, this.halfH),
    ] as const;
    // Midpoints of the short edges, so the piece can be shaded as two
    // halves either side of its crease.
    const midTop = { x: (screen[0].x + screen[1].x) / 2, y: (screen[0].y + screen[1].y) / 2 };
    const midBottom = { x: (screen[2].x + screen[3].x) / 2, y: (screen[2].y + screen[3].y) / 2 };

    // How square-on the piece is to the camera. Pushing the local normal
    // (0, 0, 1) through the same Z→Y→X rotation leaves a depth component
    // of cos(ry)·cos(rx), so its magnitude is the facing ratio: 1 flat to
    // the lens, 0 exactly edge-on. The key light sits with the camera, so
    // this doubles as the diffuse term.
    const facing = Math.abs(cosX * cosY);

    // The curl means the two halves of the piece present slightly
    // different angles to the light, so each gets its own diffuse term.
    // A single flat fill is what makes web confetti read as a coloured
    // rectangle; the split is what makes this read as bent metal.
    const facingA = Math.abs(cosX * Math.cos(this.ry + this.curl));
    const facingB = Math.abs(cosX * Math.cos(this.ry - this.curl));

    // Foil in a lit studio never goes black: the shadowed face still
    // picks up bounce, so the diffuse term sits on a warm floor rather
    // than running to zero. Anything darker reads as ash or torn paper.
    const surfaceFor = (value: number): string => {
      const shade = 0.4 + value * 0.6;
      // Near the specular angle the metal blows out towards white. This
      // is the flash you see when real foil flips through a studio lamp.
      const highlight = Math.pow(value, 7);
      return mixHex(mixHex(PALETTE.deepGold, this.color, shade), PALETTE.crystal, highlight * 0.7);
    };

    ctx.globalAlpha = fade;

    if (this.round) {
      // A disc is convex, so it has one shaded face and a bright rim
      // rather than a crease. The projected corners already carry the
      // foreshortening, so the ellipse axes come straight out of them.
      const cx = (screen[0].x + screen[2].x) / 2;
      const cy = (screen[0].y + screen[2].y) / 2;
      const ax = (screen[1].x - screen[0].x) / 2;
      const ay = (screen[1].y - screen[0].y) / 2;
      const bx = (screen[3].x - screen[0].x) / 2;
      const by = (screen[3].y - screen[0].y) / 2;
      const rx = Math.hypot(ax, ay);
      const ry = Math.hypot(bx, by);
      if (rx >= 0.4 && ry >= 0.2) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, Math.atan2(ay, ax), 0, Math.PI * 2);
        ctx.fillStyle = surfaceFor(facing);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(PALETTE.crystal, (0.3 + facing * 0.45) * fade);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    const half = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      c: { x: number; y: number },
      d: { x: number; y: number },
      fill: string,
    ): void => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    half(screen[0], midTop, midBottom, screen[3], surfaceFor(facingA));
    half(midTop, screen[1], screen[2], midBottom, surfaceFor(facingB));

    // Specular edge. As a piece turns towards edge-on its projected area
    // collapses, so the highlight concentrates into a bright sliver —
    // that flash as foil flips through the light is the single most
    // recognisable thing about real metallic confetti, and it is why the
    // stroke gets *brighter* as the fill gets smaller.
    const glint = Math.pow(1 - facing, 3);
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    ctx.lineTo(screen[1].x, screen[1].y);
    ctx.lineTo(screen[2].x, screen[2].y);
    ctx.lineTo(screen[3].x, screen[3].y);
    ctx.closePath();
    ctx.strokeStyle = hexToRgba(PALETTE.crystal, (0.14 + glint * 0.6) * fade);
    ctx.lineWidth = 1 + glint * 1.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Shockwave — the hero moment
// ---------------------------------------------------------------------------

/**
 * An expanding wave front of golden energy.
 *
 * Two decisions keep it from becoming the neon donut that gives away
 * every browser celebration effect. It is drawn as an *ellipse*, so it
 * reads as a ring lying in the stage plane seen from the audience rather
 * than as a circle painted on the glass. And it is thin and translucent,
 * with the alpha dropping much faster than the radius grows, so the eye
 * registers a pulse of energy leaving the stage instead of a solid shape
 * parked over the video.
 */
export class Shockwave implements Particle {
  dead = false;
  private age = 0;

  constructor(
    private readonly x: number,
    private readonly y: number,
    public z: number,
    private readonly maxRadius: number,
    private readonly life: number,
    private readonly color: string = PALETTE.gold,
    private readonly thickness = 26,
    /** Vertical squash. 1 is a flat-on circle, lower tilts it into depth. */
    private readonly flatten = 0.42,
  ) {}

  update({ dt }: UpdateContext): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, atlas: SpriteAtlas): void {
    const t = this.age / this.life;
    // Fast out of the gate, then easing hard — energy dissipating.
    const eased = 1 - Math.pow(1 - t, 3);
    const alpha = Math.pow(1 - t, 2.4);
    if (alpha <= 0.01) return;

    const p = camera.project(this.x, this.y, this.z);
    const radius = this.maxRadius * eased * p.scale;
    if (radius < 1) return;
    const rx = radius;
    const ry = radius * this.flatten;
    // The front thins as it stretches, the way a real expanding shell of
    // light loses surface brightness with area.
    const width = this.thickness * (1 - t * 0.7) * p.scale;

    const ring = (lineWidth: number, stroke: string, a: number, blur: number): void => {
      if (a <= 0.004 || lineWidth <= 0) return;
      ctx.globalAlpha = a;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      // Blurring the halo is what keeps this reading as light in the air.
      // Stacking crisp concentric strokes instead produces visible bands,
      // and a banded ring looks like a solid metal hoop parked over the
      // video — the exact failure mode this effect has to avoid.
      const canFilter = "filter" in ctx;
      if (canFilter && blur > 0) ctx.filter = `blur(${blur}px)`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (canFilter && blur > 0) ctx.filter = "none";
    };

    // A wide diffuse halo, then one narrow bright front inside it.
    ring(Math.max(2, width * 2.2), hexToRgba(this.color, 1), alpha * 0.3, Math.max(6, width * 0.9));
    // The bright core only belongs on a substantial wave, and even then it
    // gets a touch of blur. A perfectly crisp one-pixel ellipse reads as a
    // vector outline drawn over the video — a HUD ring, not light.
    const coreAlpha = alpha * 0.32 * Math.min(1, this.thickness / 14);
    ring(Math.max(0.9, width * 0.22), hexToRgba(PALETTE.crystal, 1), coreAlpha, 1);

    // A short bloom at the origin, only while the wave is still small
    // enough for the source to be visible inside it.
    if (t < 0.18) {
      const flash = Math.pow(1 - t / 0.18, 2) * 0.3;
      const r = this.maxRadius * 0.22 * p.scale;
      ctx.globalAlpha = flash;
      ctx.drawImage(atlas.glow(this.color), p.x - r, p.y - r, r * 2, r * 2);
    }

    ctx.globalAlpha = 1;
  }
}

/** Layer routing shared by the stage. */
export function layerOf(particle: Particle, camera: Camera): LayerIndex {
  return camera.layerFor(particle.z);
}
