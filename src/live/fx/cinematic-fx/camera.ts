/**
 * The virtual camera.
 *
 * Everything in the engine lives in a right-handed world where the origin
 * is the centre of the frame, `+y` is down and `+z` runs *away* from the
 * viewer. A single perspective divide turns that into screen pixels, which
 * is what buys the brief's depth: an element at `z = 1400` is small, slow
 * and hazy; the same element at `z = -200` is huge, fast and out of focus.
 */

import type { SafeZone } from "./types";

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale factor. 1 at the focal plane. */
  scale: number;
}

/** Elements further than this belong to the background plate. */
export const LAYER_BACK_Z = 520;
/** Elements nearer than this are "past" the camera's focal plane. */
export const LAYER_FRONT_Z = -70;

export type LayerIndex = 0 | 1 | 2;
export const LAYER_BACK: LayerIndex = 0;
export const LAYER_MID: LayerIndex = 1;
export const LAYER_FRONT: LayerIndex = 2;

export class Camera {
  /** CSS pixels. */
  width = 0;
  height = 0;
  /** Screen-space centre. */
  cx = 0;
  cy = 0;
  /**
   * Focal length in world units. Larger flattens the perspective; this
   * value gives a noticeable but not fish-eyed rush as elements approach.
   */
  focal = 820;

  /**
   * Region the celebration must not bury: the host, the winner panel and
   * the important UI. Normalised so it survives a resize.
   */
  safeZone: SafeZone = { x: 0.22, y: 0.14, width: 0.56, height: 0.66 };

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    // Keep the field of view consistent across aspect ratios; a phone in
    // portrait would otherwise get a much wider apparent lens than a
    // desktop and the depth cues would stop matching.
    this.focal = Math.max(520, Math.min(width, height) * 1.15);
  }

  project(x: number, y: number, z: number): Projected {
    const denominator = this.focal + z;
    const scale = this.focal / denominator;
    return { x: this.cx + x * scale, y: this.cy + y * scale, scale };
  }

  /** Behind the lens, or so far back it is a single pixel. */
  isCulled(z: number): boolean {
    return z <= -this.focal + 40 || z > 4200;
  }

  layerFor(z: number): LayerIndex {
    if (z > LAYER_BACK_Z) return LAYER_BACK;
    if (z < LAYER_FRONT_Z) return LAYER_FRONT;
    return LAYER_MID;
  }

  /** Half-extents of the frame at the focal plane, in world units. */
  get halfWidth(): number {
    return this.width / 2;
  }

  get halfHeight(): number {
    return this.height / 2;
  }

  /**
   * True when a projected point lands inside the protected rectangle. Used
   * to steer burst centres and slow-moving elements away from the host.
   */
  isInsideSafeZone(screenX: number, screenY: number, margin = 0): boolean {
    const left = (this.safeZone.x - margin) * this.width;
    const top = (this.safeZone.y - margin) * this.height;
    const right = (this.safeZone.x + this.safeZone.width + margin) * this.width;
    const bottom = (this.safeZone.y + this.safeZone.height + margin) * this.height;
    return screenX > left && screenX < right && screenY > top && screenY < bottom;
  }
}
