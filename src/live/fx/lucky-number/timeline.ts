/**
 * The shape of the moment.
 *
 * A reveal is not one animation, it is four beats with different jobs,
 * and the beat boundaries have to be shared by the 3D layer, the camera
 * move and the particle celebration or the climax lands in three places
 * at once. Everything reads its timing from here.
 */

/** Energy gathers. The object is not on screen yet. */
export const GATHER_MS = 1500;
/** The object arrives and locks. Deliberately short — impact is brief. */
export const IMPACT_MS = 420;
/** Default readable hold. Long enough to memorise a number and say it. */
export const DEFAULT_HOLD_MS = 4600;
/** The scene lets go. No cuts. */
export const RELEASE_MS = 2000;

export const MIN_HOLD_MS = 2000;
export const MAX_HOLD_MS = 12000;

export type RevealPhase = "gather" | "impact" | "hold" | "release" | "done";

export interface Timeline {
  gatherEnd: number;
  impactEnd: number;
  holdEnd: number;
  totalMs: number;
}

export function buildTimeline(holdMs = DEFAULT_HOLD_MS): Timeline {
  const hold = clamp(holdMs, MIN_HOLD_MS, MAX_HOLD_MS);
  const gatherEnd = GATHER_MS;
  const impactEnd = gatherEnd + IMPACT_MS;
  const holdEnd = impactEnd + hold;
  return { gatherEnd, impactEnd, holdEnd, totalMs: holdEnd + RELEASE_MS };
}

export function phaseAt(timeline: Timeline, elapsed: number): RevealPhase {
  if (elapsed < timeline.gatherEnd) return "gather";
  if (elapsed < timeline.impactEnd) return "impact";
  if (elapsed < timeline.holdEnd) return "hold";
  if (elapsed < timeline.totalMs) return "release";
  return "done";
}

/** 0..1 progress within a span, clamped at both ends. */
export function progress(elapsed: number, from: number, to: number): number {
  if (to <= from) return elapsed >= to ? 1 : 0;
  return clamp((elapsed - from) / (to - from), 0, 1);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Overshoot and settle. This is the "locks into position" feel: the
 * object arrives past its resting place and is pulled back, which is
 * what a physical object does and what a linear scale-up never does.
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const c = overshoot + 1;
  return 1 + c * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

/**
 * A decaying oscillation, used for the settle wobble after impact.
 * Returns 0 at t=0 and t=1, peaking early.
 */
export function damped(t: number, cycles = 3, decay = 6): number {
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(t * Math.PI * 2 * cycles) * Math.exp(-t * decay);
}
