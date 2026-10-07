/**
 * Shared vocabulary for the Cinematic FX engine.
 *
 * The engine is a client-side renderer: the Cinematic Admin sends a small
 * JSON event over the existing LiveKit data channel and every viewer
 * generates the whole celebration locally. Nothing here describes pixels,
 * frames or geometry — only *which* choreography to play and how hard.
 */

/**
 * Catalogue of choreographies. Each one owns its own timeline, duration and
 * visual identity while sharing the renderer, the particle vocabulary and
 * the transport.
 */
export type CinematicEffectId =
  | "grand-celebration"
  | "winner-reveal"
  | "jackpot"
  | "mega-jackpot"
  | "golden-rain"
  | "fireworks"
  | "confetti-blast"
  | "big-win"
  | "countdown"
  | "lucky-number-reveal"
  | "special-announcement";

export const CINEMATIC_EFFECT_IDS: CinematicEffectId[] = [
  "grand-celebration",
  "winner-reveal",
  "jackpot",
  "mega-jackpot",
  "golden-rain",
  "fireworks",
  "confetti-blast",
  "big-win",
  "countdown",
  "lucky-number-reveal",
  "special-announcement",
];

/** How much of the frame the choreography is allowed to occupy. */
export type CinematicIntensity = "subtle" | "standard" | "epic";

/**
 * The wire format. Kept deliberately tiny — this travels on the same
 * reliable data channel as `show-awards` and `admin-set-drawing-machine`.
 */
export interface CinematicFxEvent {
  type: "cinematic-fx";
  effect: CinematicEffectId;
  intensity?: CinematicIntensity;
  /**
   * Seeds the deterministic PRNG. Every viewer that receives the same event
   * renders the same explosions in the same places, which matters when the
   * show is watched on two screens side by side.
   */
  seed?: number;
  /** Overrides the preset length. The engine clamps it to a sane range. */
  durationMs?: number;
  /**
   * Wall-clock ms of when the celebration began. A client that joins or
   * mounts mid-sequence skips ahead instead of replaying from zero, so a
   * late viewer never sees a finale start from the build-up.
   */
  startAt?: number;
  commandId?: string;
}

/**
 * Rendering budget. Chosen once from device capability, then lowered at
 * runtime by the frame governor if we cannot hold the frame budget. The art
 * direction is identical at every tier; only density and the expensive
 * lighting passes change.
 */
export type QualityTier = "high" | "medium" | "low";

export interface QualityProfile {
  tier: QualityTier;
  /** Multiplier applied to every spawn count. */
  density: number;
  /** Separable bloom pass over the mid layer. */
  bloom: boolean;
  /** CSS depth-of-field blur on the far/near layers. */
  depthOfField: boolean;
  /** Multiplier on motion-blur streak length. 0 = round sparks, no smear. */
  trailStrength: number;
  /** How many near-camera elements may be in flight at once. */
  maxForegroundCrossings: number;
  /** Upper bound on the backing-store scale. */
  maxPixelRatio: number;
  /**
   * Upper bound on the backing store of one full-resolution plate, in device
   * pixels. maxPixelRatio alone is not a budget: a 1600px-wide desktop player
   * at ratio 2 is 4.6M pixels per plate, and the cost of the blur and bloom
   * passes scales with exactly this number. The effective ratio is lowered
   * until a plate fits.
   */
  maxCanvasPixels: number;
}

/** A rectangle, in normalised 0..1 screen space, that must stay readable. */
export interface SafeZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isCinematicFxEvent(value: unknown): value is CinematicFxEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CinematicFxEvent>;
  return (
    candidate.type === "cinematic-fx" &&
    typeof candidate.effect === "string" &&
    (CINEMATIC_EFFECT_IDS as string[]).includes(candidate.effect)
  );
}
