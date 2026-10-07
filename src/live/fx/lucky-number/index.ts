/**
 * Lucky Number reveal — public surface.
 *
 * Host code creates a player over a container, feeds it events off the
 * LiveKit data channel, and destroys it on unmount. Everything a
 * broadcast feature has to survive is handled in here rather than in the
 * component: duplicate delivery, late joins, reconnects, two events
 * arriving together, a lost GL context, and a device that cannot afford
 * the full renderer.
 *
 * No framework import, so the same engine can later drive the Streaming
 * Hub's egress overlay for the restream.
 */

import { detectQualityTier, prefersReducedMotion, type QualityTier } from "../cinematic-fx";
import { LuckyNumberFallback } from "./fallback2d";
import type { LuckyNumberScene } from "./scene3d";
import { buildTimeline, type Timeline } from "./timeline";
import { isLuckyNumberEvent, normaliseLuckyNumber, type LuckyNumberEvent } from "./types";

export { isLuckyNumberEvent, normaliseLuckyNumber, LUCKY_NUMBER_MAX_DIGITS } from "./types";
export type { LuckyNumberEvent } from "./types";
export { DEFAULT_HOLD_MS, MAX_HOLD_MS, MIN_HOLD_MS } from "./timeline";

/** How many command ids we remember. Plenty for one show. */
const SEEN_LIMIT = 64;

/**
 * Deliberately module scope, not per player.
 *
 * A LiveKit reconnect can tear down and rebuild the page's room, which
 * remounts the overlay and would hand a fresh player an empty history —
 * and the redelivered packets that follow a reconnect are exactly the
 * case dedupe exists for. Keeping the ids alongside the module means a
 * remount cannot cause a number to be revealed twice.
 */
const seen = new Set<string>();
const seenOrder: string[] = [];

function alreadyRevealed(key: string): boolean {
  return seen.has(key);
}

function remember(key: string): void {
  seen.add(key);
  seenOrder.push(key);
  while (seenOrder.length > SEEN_LIMIT) {
    const oldest = seenOrder.shift();
    if (oldest) seen.delete(oldest);
  }
}

export interface LuckyNumberPlayerOptions {
  /** Overrides device detection. Used by tests and the harness. */
  tier?: QualityTier;
  /** Forces the 2D renderer, skipping WebGL entirely. */
  forceFallback?: boolean;
  /** Fired when a reveal actually begins (after dedupe and late-join). */
  onRevealStart?: (event: LuckyNumberEvent) => void;
  /** Fired when the overlay has finished and removed itself. */
  onRevealEnd?: () => void;
}

interface ActiveReveal {
  event: LuckyNumberEvent;
  timeline: Timeline;
  /** Elapsed ms into the sequence. Starts non-zero for a late join. */
  elapsed: number;
}

export class LuckyNumberRevealPlayer {
  private readonly tier: QualityTier;
  private readonly reducedMotion: boolean;
  private scene: LuckyNumberScene | null = null;
  private fallback: LuckyNumberFallback | null = null;
  /** Set once we know WebGL is off the table for this session. */
  private webglUnavailable: boolean;

  private active: ActiveReveal | null = null;
  /**
   * At most one reveal waiting. Two lucky numbers in the same second is
   * an operator mistake, but the second one is the one that matters, so
   * we keep the newest and drop anything older.
   */
  private queued: LuckyNumberEvent | null = null;

  private sceneModule: SceneModule | null = null;
  private sceneModuleLoading = false;

  private frame: number | null = null;
  private lastFrameAt = 0;
  private slowFrames = 0;
  private observer: ResizeObserver | null = null;
  private width = 0;
  private height = 0;
  private destroyed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: LuckyNumberPlayerOptions = {},
  ) {
    this.tier = options.tier ?? detectQualityTier();
    this.reducedMotion = prefersReducedMotion();
    // Touch devices run the 2D reveal, not WebGL. A high-end phone reports
    // enough cores/memory to land on the "medium" tier and would otherwise
    // build the full three.js scene (PMREM environment, bloom composite)
    // over the decoding video on a shared mobile GPU — the exact load that
    // dropped the stream's framerate. The 2D fallback plays the same
    // choreography at a fraction of the cost.
    this.webglUnavailable =
      options.forceFallback === true ||
      this.tier === "low" ||
      isCoarsePointer() ||
      !hasWebGL();

    this.observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.measure())
        : null;
    this.observer?.observe(this.root);
    this.measure();

    if (this.webglUnavailable) this.ensureRenderer();

    // Fetch the WebGL renderer now, at mount, not at reveal time. Most
    // live sessions never fire a lucky number, so three.js must not be in
    // the page's initial download — but when the packet does arrive there
    // is no time to go to the network, so we warm the chunk during the
    // minutes of stream that precede it.
    if (!this.webglUnavailable) this.loadSceneModule();
  }

  /**
   * Hand it a packet from the data channel.
   *
   * Returns true when this call started or queued a reveal, which lets
   * the host mirror the event to the celebration layer only when the
   * reveal is genuinely new.
   */
  play(raw: unknown): boolean {
    if (this.destroyed) return false;
    if (!isLuckyNumberEvent(raw)) return false;
    const event = raw;

    const digits = normaliseLuckyNumber(event.number);
    if (!digits) return false;

    // Idempotency. A reliable channel still delivers twice across a
    // reconnect, and the Admin API fans the same command out to every
    // room name a game might be using.
    const key = this.identityOf(event);
    if (alreadyRevealed(key)) return false;
    remember(key);

    // Late joiners. Small lags are absorbed by starting part-way in; if
    // the number has already been on screen for most of its hold there is
    // nothing worth showing, and cutting a reveal short would look worse
    // than not playing it.
    const timeline = buildTimeline(event.holdMs);
    let elapsed = 0;
    if (typeof event.startAt === "number" && Number.isFinite(event.startAt)) {
      const age = Date.now() - event.startAt;
      if (age > timeline.holdEnd) return false;
      elapsed = Math.max(0, age);
    }

    if (this.active) {
      // Something is already on screen. Never cut away from a number the
      // audience is still reading — let it finish, then play this one.
      this.queued = { ...event, number: digits, startAt: undefined };
      return true;
    }

    this.begin({ ...event, number: digits }, timeline, elapsed);
    return true;
  }

  /** Stop immediately and clear the overlay. */
  cancel(): void {
    this.active = null;
    this.queued = null;
    this.stopLoop();
    this.renderCurrent(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = null;
    this.queued = null;
    this.stopLoop();
    this.observer?.disconnect();
    this.observer = null;
    this.scene?.dispose();
    this.scene = null;
    this.fallback?.dispose();
    this.fallback = null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The dedupe key. `commandId` when the sender supplied one; otherwise
   * the number plus its trigger time, which still collapses the
   * multi-room fan-out of a single command into one reveal.
   */
  private identityOf(event: LuckyNumberEvent): string {
    if (event.commandId) return `id:${event.commandId}`;
    if (typeof event.startAt === "number") return `at:${event.number}:${event.startAt}`;
    return `n:${event.number}:${Math.floor(Date.now() / 4000)}`;
  }

  private begin(event: LuckyNumberEvent, timeline: Timeline, elapsed: number): void {
    this.active = { event, timeline, elapsed };
    this.ensureRenderer();
    this.scene?.setNumber(event.number, event.label);
    this.fallback?.setNumber(event.number, event.label);
    this.options.onRevealStart?.(event);
    this.startLoop();
  }

  private loadSceneModule(): void {
    if (this.sceneModule || this.sceneModuleLoading) return;
    this.sceneModuleLoading = true;
    import("./scene3d")
      .then((module) => {
        if (this.destroyed) return;
        this.sceneModule = module;
        // Build the renderer now rather than on the first packet. The
        // environment map, its pre-filtered mip chain and the geometry
        // all cost tens of milliseconds, and paying that at the moment
        // of reveal put a visible hitch on exactly the frame that
        // matters most. Paid here it lands in the quiet minutes of
        // stream that always precede a draw.
        this.ensureRenderer();
      })
      .catch(() => {
        this.webglUnavailable = true;
      })
      .finally(() => {
        this.sceneModuleLoading = false;
      });
  }

  /**
   * Picks a renderer for the reveal that is about to start.
   *
   * Only ever called between reveals, so swapping renderers here can
   * never interrupt a number the audience is reading. If the WebGL chunk
   * has not arrived yet this reveal runs on canvas in full rather than
   * starting in one renderer and finishing in another.
   */
  private ensureRenderer(): void {
    if (this.scene || this.fallback) return;

    if (!this.webglUnavailable && this.sceneModule) {
      try {
        this.scene = new this.sceneModule.LuckyNumberScene(this.root, {
          tier: this.tier,
          reducedMotion: this.reducedMotion,
          onContextLost: () => this.handleContextLost(),
        });
        if (this.width && this.height) this.scene.resize(this.width, this.height);
        return;
      } catch {
        // Blocked GL, an exhausted context pool, or a driver that refuses
        // the config. Canvas from here on.
        this.webglUnavailable = true;
        this.scene = null;
      }
    }

    this.fallback = new LuckyNumberFallback(
      this.root,
      this.reducedMotion,
      this.tier === "low" ? 90 : 130,
    );
    if (this.width && this.height) this.fallback.resize(this.width, this.height);
  }

  private handleContextLost(): void {
    this.webglUnavailable = true;
    this.scene?.dispose();
    this.scene = null;
    this.ensureRenderer();
    // Re-issue the artwork so the fallback picks up mid-reveal without a
    // visible gap.
    if (this.active) {
      this.fallback?.setNumber(this.active.event.number, this.active.event.label);
    }
  }

  private measure(): void {
    const rect = this.root.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    // Handles fullscreen toggles, orientation changes and any aspect
    // ratio: the renderers re-frame and re-rasterise the numeral so it is
    // never an upscaled bitmap.
    this.scene?.resize(width, height);
    this.fallback?.resize(width, height);
  }

  private startLoop(): void {
    if (this.frame !== null) return;
    this.lastFrameAt = performance.now();
    this.slowFrames = 0;
    const step = (now: number): void => {
      this.frame = null;
      if (this.destroyed) return;

      // Clamped so a backgrounded tab that wakes up does not jump the
      // whole sequence in one frame.
      const dt = Math.min(64, Math.max(0, now - this.lastFrameAt));
      this.lastFrameAt = now;
      this.governFrame(dt);

      const current = this.active;
      if (!current) return;

      current.elapsed += dt;
      if (current.elapsed >= current.timeline.totalMs) {
        this.finish();
        return;
      }

      this.renderCurrent(current.elapsed);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /**
   * Watches real frame times and sheds the expensive passes once if this
   * device cannot keep up.
   *
   * It only ever steps down, and only once. Oscillating between quality
   * levels during a four-second reveal would be more noticeable than
   * simply running one notch lighter for the rest of it.
   */
  private governFrame(dt: number): void {
    // ~45fps. Below that the float and the rotation start to read as
    // stutter rather than as motion.
    if (dt <= 22) {
      this.slowFrames = 0;
      return;
    }
    this.slowFrames += 1;
    // Enough patience to ignore one garbage collection or one decode.
    if (this.slowFrames < 20) return;
    this.slowFrames = 0;
    this.scene?.reduceQuality();
  }

  private stopLoop(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  private renderCurrent(elapsed: number): void {
    const current = this.active;
    const timeline = current?.timeline ?? buildTimeline();
    // Past the end of the timeline both renderers draw nothing, which is
    // how the overlay clears itself without a separate teardown path.
    const at = current ? elapsed : timeline.totalMs;
    this.scene?.render(at, timeline);
    this.fallback?.render(at, timeline);
  }

  private finish(): void {
    this.active = null;
    this.stopLoop();
    this.renderCurrent(0);
    this.options.onRevealEnd?.();

    const next = this.queued;
    this.queued = null;
    if (next) {
      this.begin(next, buildTimeline(next.holdMs), 0);
    }
  }
}

type SceneModule = typeof import("./scene3d");

/** Phones and tablets: a coarse primary pointer. */
function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
}

let webglSupported: boolean | null = null;

/**
 * Probed once with a throwaway canvas. Cheaper than discovering the
 * answer by constructing the whole scene and catching, and it lets the
 * player decide on the fallback before any reveal is pending.
 */
function hasWebGL(): boolean {
  if (webglSupported !== null) return webglSupported;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    webglSupported = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}
