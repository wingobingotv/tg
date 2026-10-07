/**
 * Rendering budget: what the device can afford, and what it turns out it
 * can afford once we are actually drawing.
 *
 * The rule the art direction imposes is that the *composition* never
 * changes between tiers — a phone still gets the build-up, the bursts, the
 * hero shockwave and the slow finish. What changes is particle density, the
 * expensive lighting passes and how many elements are allowed to fly past
 * the camera. A cheaper tier should read as the same celebration shot with
 * a smaller crew, not as a different effect.
 */

import type { QualityProfile, QualityTier } from "./types";

const PROFILES: Record<QualityTier, QualityProfile> = {
  high: {
    tier: "high",
    density: 1,
    bloom: true,
    depthOfField: true,
    trailStrength: 1,
    maxForegroundCrossings: 3,
    maxPixelRatio: 2,
    // ~1080p worth of pixels per plate. Beyond this the per-frame blur and
    // bloom passes stop fitting in a 16ms budget on desktop GPUs, and a big
    // desktop player at ratio 2 goes well beyond it.
    maxCanvasPixels: 2_100_000,
  },
  medium: {
    tier: "medium",
    density: 0.6,
    bloom: true,
    depthOfField: true,
    trailStrength: 0.75,
    maxForegroundCrossings: 2,
    maxPixelRatio: 1.75,
    maxCanvasPixels: 1_500_000,
  },
  low: {
    tier: "low",
    density: 0.32,
    bloom: false,
    depthOfField: false,
    trailStrength: 0.4,
    maxForegroundCrossings: 1,
    maxPixelRatio: 1.25,
    maxCanvasPixels: 1_100_000,
  },
};

export function profileFor(tier: QualityTier): QualityProfile {
  return { ...PROFILES[tier] };
}

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
}

/**
 * Best guess before the first frame. We are conservative on touch devices:
 * a mid-range phone that starts at "high" and stutters for a second costs
 * more credibility than one that starts at "medium" and stays smooth.
 */
export function detectQualityTier(): QualityTier {
  if (typeof window === "undefined") return "medium";

  const nav = window.navigator as NavigatorWithHints;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const shortEdge = Math.min(window.screen?.width ?? 1280, window.screen?.height ?? 720);

  if (coarsePointer) {
    // Phones and tablets are held at "low", which is the only tier with the
    // depth-of-field CSS-blur plates and the bloom pass switched off. Those
    // full-frame, GPU-promoted blur layers are what starve the live <video>
    // of compositor time on a shared mobile GPU and freeze the stream during
    // a celebration. A flagship can render "medium" in isolation, but not
    // while also decoding and compositing the video, so mobile stays on the
    // same composition at a lower density instead.
    void shortEdge;
    return "low";
  }

  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 4 && memory >= 4) return "medium";
  return "low";
}

/** Viewers who asked for less motion get the calm cut of the same sequence. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Watches real frame times and steps the tier down when we cannot keep up.
 *
 * It only ever moves downwards. Oscillating between tiers mid-celebration
 * would be more visible than simply running one notch lighter, and the
 * whole sequence is over in a few seconds anyway.
 */
export class FrameGovernor {
  /** ~45fps. Below this the celebration starts to read as stutter. */
  private static readonly BUDGET_MS = 22;
  /**
   * A frame this slow is not a hiccup, it is the wrong tier. Act on the
   * first one rather than waiting for corroboration.
   */
  private static readonly PANIC_MS = 55;
  /**
   * Sustained time over budget before we act, so one GC pause is ignored.
   *
   * This used to be a count of 24 consecutive slow frames, which is only a
   * sensible amount of patience while frames are roughly on time. Once a
   * device is down at 4fps, 24 frames is six seconds — longer than the whole
   * celebration — so the tier that caused the stutter was never lowered and
   * the viewer watched the entire effect at single-digit fps. Measuring
   * elapsed slow time instead makes the reaction independent of how bad
   * things have got.
   */
  private static readonly PATIENCE_MS = 220;

  private slowMs = 0;
  private downgrades = 0;

  constructor(private profile: QualityProfile) {}

  get current(): QualityProfile {
    return this.profile;
  }

  /** Returns true when the profile changed and emitters should re-read it. */
  sample(frameMs: number): boolean {
    if (frameMs <= FrameGovernor.BUDGET_MS) {
      this.slowMs = 0;
      return false;
    }

    this.slowMs += frameMs - FrameGovernor.BUDGET_MS;
    if (frameMs < FrameGovernor.PANIC_MS && this.slowMs < FrameGovernor.PATIENCE_MS) {
      return false;
    }
    this.slowMs = 0;

    // Two steps available: high -> medium -> low. After that we thin the
    // density further rather than dropping the composition.
    if (this.profile.tier === "high") {
      this.profile = profileFor("medium");
    } else if (this.profile.tier === "low") {
      if (this.downgrades > 2) return false;
      this.profile = { ...this.profile, density: this.profile.density * 0.7 };
    } else {
      this.profile = profileFor("low");
    }

    this.downgrades += 1;
    return true;
  }
}
