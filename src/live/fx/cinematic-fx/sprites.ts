/**
 * Art direction constants and the pre-rendered sprite atlas.
 *
 * Every glow in this engine is a cached bitmap rather than a gradient built
 * per draw call. Building a `createRadialGradient` for each of a few
 * thousand particles per frame is what makes canvas celebrations stutter;
 * blitting a pre-rendered sprite with `drawImage` is close to free and lets
 * us afford the particle counts the brief asks for.
 */

/**
 * Champagne-and-crystal palette. Deliberately narrow: the luxury read comes
 * from a tight range of warm metals with cool accents used sparingly, not
 * from many hues. No saturated primaries, nothing that reads as party-shop.
 */
export const PALETTE = {
  /** Core highlight — near-white with warmth, used for hot spark cores. */
  crystal: "#FFF6DC",
  /** The signature metal. */
  gold: "#FFD27A",
  /** Lighter, pearlescent gold for confetti faces catching the light. */
  champagne: "#F6E3B0",
  /** Shadowed side of a metallic surface. */
  deepGold: "#C98B2E",
  /** Warm bronze for the darkest confetti faces. */
  bronze: "#8A5A1B",
  /** Cool accents, used on a minority of elements for contrast. */
  electric: "#7FC0FF",
  /**
   * Deep enough that when the shading model lights it up it reads as a
   * cool metal. A paler violet turns pink under the specular term, and
   * pink foil reads as a birthday party.
   */
  violet: "#8E72D8",
} as const;

/** Weighted pools so gold dominates and the accents stay occasional. */
export const SPARK_COLORS = [
  PALETTE.crystal,
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.champagne,
  PALETTE.deepGold,
  PALETTE.electric,
] as const;

/**
 * Shell colours. Heavily weighted to gold: a firework display where every
 * third shell is a different colour reads as a fairground, not as a
 * controlled broadcast moment. The cool accents appear roughly one shell
 * in ten.
 */
export const SHELL_COLORS = [
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.champagne,
  PALETTE.champagne,
  PALETTE.deepGold,
  PALETTE.crystal,
] as const;

/**
 * Foil stock. Overwhelmingly warm metal: one piece in twelve is a cool
 * accent, which is enough to stop the field looking monochrome and few
 * enough that it never reads as multi-coloured party confetti.
 */
export const CONFETTI_COLORS = [
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.gold,
  PALETTE.champagne,
  PALETTE.champagne,
  PALETTE.champagne,
  PALETTE.deepGold,
  PALETTE.deepGold,
  PALETTE.crystal,
  PALETTE.crystal,
  // No violet foil. The specular highlight brightens a piece towards
  // white as it turns edge-on, and violet on that path passes through
  // pink — which is exactly the cheap party-shop look the direction
  // rules out. Violet stays on light: shells, accents and wave fronts.
] as const;

type Canvas = HTMLCanvasElement;

function createCanvas(size: number): Canvas {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Bitmaps shared by every particle. One atlas per stage; sprites are built
 * lazily on first use and then reused for the lifetime of the page.
 */
export class SpriteAtlas {
  private readonly glows = new Map<string, Canvas>();
  private readonly streaks = new Map<string, Canvas>();
  private flareSprite: Canvas | null = null;

  /**
   * Soft omnidirectional glow: a white-hot core fading through the colour
   * to nothing. Additive-blended, this is what produces bloom around
   * sparks without a real post-processing pass.
   */
  glow(color: string): Canvas {
    const cached = this.glows.get(color);
    if (cached) return cached;

    const size = 128;
    const canvas = createCanvas(size);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      // The tight white core is what makes it read as a light source
      // rather than a coloured blob.
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.12, hexToRgba(color, 0.95));
      gradient.addColorStop(0.38, hexToRgba(color, 0.34));
      gradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    this.glows.set(color, canvas);
    return canvas;
  }

  /**
   * A spark's head: a small, much tighter glow. Drawn on top of the trail
   * so the leading edge stays crisp while the tail smears.
   */
  ember(color: string): Canvas {
    const key = `ember:${color}`;
    const cached = this.streaks.get(key);
    if (cached) return cached;

    const size = 64;
    const canvas = createCanvas(size);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.25, hexToRgba(color, 0.8));
      gradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    this.streaks.set(key, canvas);
    return canvas;
  }

  /**
   * Anamorphic flare: the horizontal streak a real lens throws across a
   * bright point. Used only on the largest ignitions and on the hero
   * moment, because it is the single most "broadcast camera" cue we have
   * and it stops reading as one if it appears on every spark.
   */
  flare(): Canvas {
    if (this.flareSprite) return this.flareSprite;

    const width = 512;
    const height = 64;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(255,210,122,0)");
      gradient.addColorStop(0.35, "rgba(255,225,170,0.22)");
      gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
      gradient.addColorStop(0.65, "rgba(255,225,170,0.22)");
      gradient.addColorStop(1, "rgba(255,210,122,0)");
      ctx.fillStyle = gradient;
      // Waisted in the middle so it tapers like a real flare instead of
      // reading as a rectangle.
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.quadraticCurveTo(width / 2, 0, width, height / 2);
      ctx.quadraticCurveTo(width / 2, height, 0, height / 2);
      ctx.fill();
    }

    this.flareSprite = canvas;
    return canvas;
  }
}

/** `#rrggbb` plus an alpha, without pulling in a colour library. */
export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Linear blend between two `#rrggbb` colours, for metallic shading.
 *
 * Returns hex rather than `rgb()` so the result can be fed straight back
 * in as an argument — metallic surfaces are shaded by chaining a diffuse
 * mix into a specular one.
 */
export function mixHex(from: string, to: string, t: number): string {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const a = from.replace("#", "");
  const b = to.replace("#", "");
  const channel = (index: number): string => {
    const start = parseInt(a.slice(index, index + 2), 16);
    const end = parseInt(b.slice(index, index + 2), 16);
    const value = Math.round(start + (end - start) * clamped);
    return (value < 16 ? "0" : "") + value.toString(16);
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}
