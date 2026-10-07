/**
 * Cinematic FX Engine — public surface.
 *
 * Host code only ever does three things: create a player over a container
 * element, hand it events that arrived on the LiveKit data channel, and
 * destroy it on unmount. Everything else — device tiering, choreography,
 * particle lifetimes, the frame loop — is internal.
 *
 * The engine is deliberately free of any framework import so the same
 * code can drive the website overlay and, later, the Streaming Hub's
 * egress overlay page.
 */

import { Choreographer, getPreset, powerFor } from "./effects";
import { CinematicStage, type StageOptions } from "./stage";
import { type CinematicFxEvent } from "./types";

export { CINEMATIC_EFFECT_IDS, isCinematicFxEvent } from "./types";
export type {
  CinematicEffectId,
  CinematicFxEvent,
  CinematicIntensity,
  QualityTier,
  SafeZone,
} from "./types";
export { listPresets, getPreset } from "./effects";
export { PALETTE, hexToRgba, mixHex } from "./sprites";
export { detectQualityTier, prefersReducedMotion, profileFor } from "./quality";

/** Guard rails around an operator-supplied duration. */
const MIN_DURATION_MS = 2000;
const MAX_DURATION_MS = 20000;

export interface PlayerOptions extends StageOptions {
  /** Fired when the sequence and all of its particles have finished. */
  onFinished?: () => void;
}

export class CinematicFxPlayer {
  private readonly stage: CinematicStage;
  private choreographer: Choreographer | null = null;
  private readonly onFinished?: () => void;

  constructor(root: HTMLElement, options: PlayerOptions = {}) {
    this.onFinished = options.onFinished;
    this.stage = new CinematicStage(root, {
      ...options,
      onIdle: () => {
        options.onIdle?.();
        this.onFinished?.();
      },
    });
    this.stage.onTick = (dtMs) => this.tick(dtMs);
  }

  /**
   * Start a celebration. Calling this while one is already running
   * replaces the choreography but leaves existing particles in flight, so
   * two events in quick succession blend instead of cutting.
   */
  play(event: CinematicFxEvent): void {
    const preset = getPreset(event.effect);

    // Deterministic across viewers: same seed, same show. Falling back to
    // the effect name keeps repeat plays of an un-seeded event visually
    // distinct rather than identical.
    const seed = event.seed ?? hashString(`${event.effect}:${event.commandId ?? ""}`);
    this.stage.setSeed(seed);

    // A viewer whose tab woke up late, or who opened the stream
    // mid-celebration, joins the timeline where it actually is.
    const offset = event.startAt ? clampOffset(Date.now() - event.startAt, preset.durationMs) : 0;
    if (offset === null) return;

    const requested = event.durationMs;
    const scale =
      requested && Number.isFinite(requested)
        ? clamp(requested, MIN_DURATION_MS, MAX_DURATION_MS) / preset.durationMs
        : 1;

    const scaled =
      scale === 1
        ? preset
        : {
            ...preset,
            durationMs: preset.durationMs * scale,
            cues: preset.cues.map((cue) => ({
              ...cue,
              at: cue.at * scale,
              until: cue.until === undefined ? undefined : cue.until * scale,
            })),
          };

    this.choreographer = new Choreographer(
      scaled,
      { stage: this.stage, power: powerFor(event.intensity) },
      offset,
    );
    this.stage.holding = true;
    this.stage.start();
  }

  /** Stop immediately and drop every particle. */
  cancel(): void {
    this.choreographer = null;
    this.stage.holding = false;
    this.stage.clear();
    this.stage.stop();
  }

  destroy(): void {
    this.choreographer = null;
    this.stage.onTick = null;
    this.stage.destroy();
  }

  private tick(dtMs: number): void {
    if (!this.choreographer) return;
    if (!this.choreographer.advance(dtMs)) {
      this.choreographer = null;
      // Release the loop: it now runs only until the last particle dies,
      // which is what gives the sequence its unhurried finish.
      this.stage.holding = false;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Late joiners. Small lags are absorbed; if most of the sequence is
 * already over we skip it entirely rather than showing a stub of a
 * celebration with no build-up.
 */
function clampOffset(elapsed: number, durationMs: number): number | null {
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  if (elapsed > durationMs * 0.75) return null;
  return elapsed;
}

/** FNV-1a. Stable across clients, which is the only property we need. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
