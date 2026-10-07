/**
 * Everything the reveal is made of is drawn at runtime.
 *
 * No image assets: an overlay that has to appear within milliseconds of a
 * data packet cannot wait on a network fetch, and a broadcast feature
 * cannot fail because a CDN was slow. Canvases are cheap, they scale to
 * the device's pixel ratio, and they let the numeral be re-rendered at
 * whatever size the player happens to be.
 */

import { PALETTE, hexToRgba, mixHex } from "../cinematic-fx";
import { LUCKY_NUMBER_MAX_DIGITS } from "./types";

const FONT_STACK =
  '"Arial Black", "Archivo Black", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// ---------------------------------------------------------------------------
// The numeral
// ---------------------------------------------------------------------------

export interface NumeralArt {
  /** Lit front face, carrying the metal gradient and the bevel. */
  face: HTMLCanvasElement;
  /** Flat silhouette, stacked behind the face to give real extrusion. */
  silhouette: HTMLCanvasElement;
  /** width / height of both canvases. */
  aspect: number;
  /**
   * How much of the canvas the glyphs themselves occupy. The canvas is
   * padded so the halo has somewhere to live, and without these the
   * caller would size the padding to fit the medallion and leave the
   * number far smaller than intended.
   */
  glyphWidthRatio: number;
  glyphHeightRatio: number;
}

/**
 * Renders the digits twice: once as struck metal and once as a plain
 * silhouette.
 *
 * The scene stacks several silhouettes behind the lit face at increasing
 * depth, which produces a genuinely extruded numeral that still has one
 * perfectly flat, perfectly legible front surface. Extruding real
 * geometry would need a font file and would curve the face; this keeps
 * the readability guarantee absolute while still being a 3D object.
 */
export function drawNumeral(text: string, pixelHeight: number): NumeralArt {
  const digits = text.slice(0, LUCKY_NUMBER_MAX_DIGITS);
  const size = Math.max(64, Math.min(512, Math.round(pixelHeight)));
  const font = `900 ${size}px ${FONT_STACK}`;

  // Measure first so the canvas is a tight fit. A loose canvas would make
  // the numeral plane larger than the glyphs and throw the composition
  // out when the digit count changes.
  const probe = createCanvas(8, 8).getContext("2d");
  let textWidth = size * 0.62 * digits.length;
  if (probe) {
    probe.font = font;
    const metrics = probe.measureText(digits);
    if (metrics.width > 0) textWidth = metrics.width;
  }

  // Cap height of a digit is close to 0.72em in these faces; that, not
  // the em box, is what has to fill the medallion.
  const glyphHeight = size * 0.72;
  const padX = size * 0.17;
  const padY = size * 0.19;
  const width = Math.ceil(textWidth + padX * 2);
  const height = Math.ceil(glyphHeight + padY * 2);
  const cx = width / 2;
  const baseline = height / 2 + glyphHeight * 0.5;

  const face = createCanvas(width, height);
  const fctx = face.getContext("2d");
  const silhouette = createCanvas(width, height);
  const sctx = silhouette.getContext("2d");

  if (fctx) {
    fctx.textAlign = "center";
    fctx.textBaseline = "alphabetic";
    fctx.font = font;

    const top = baseline - glyphHeight;
    const bottom = baseline;

    const canFilter = "filter" in fctx;

    // Contact shadow first: a tight dark spread under the glyphs.
    //
    // This is the single thing that makes the readability guarantee hold.
    // The numeral is bright metal, and for a few frames at the moment of
    // impact the plate behind it is also near-white from the celebration
    // flash — without a dark edge the number briefly vanishes into its
    // own highlight. On a dark plate the shadow is invisible.
    if (canFilter) fctx.filter = `blur(${size * 0.035}px)`;
    fctx.fillStyle = "rgba(24,12,2,0.72)";
    fctx.lineWidth = size * 0.06;
    fctx.strokeStyle = "rgba(24,12,2,0.72)";
    fctx.strokeText(digits, cx, baseline);
    fctx.fillText(digits, cx, baseline);

    // Halo. Kept well outside the glyphs so it never eats into the
    // strokes — glow around the number, never over it.
    if (canFilter) fctx.filter = `blur(${size * 0.07}px)`;
    fctx.fillStyle = hexToRgba(PALETTE.gold, 0.45);
    fctx.fillText(digits, cx, baseline);
    if (canFilter) fctx.filter = "none";

    // Struck metal: dark at the base, a hard specular band across the
    // upper third, champagne at the crown. A single flat gradient is what
    // makes gold look like paint; the band is what makes it look milled.
    const metal = fctx.createLinearGradient(0, top, 0, bottom);
    metal.addColorStop(0, PALETTE.champagne);
    metal.addColorStop(0.24, PALETTE.crystal);
    metal.addColorStop(0.3, "#FFFFFF");
    metal.addColorStop(0.42, PALETTE.gold);
    metal.addColorStop(0.7, mixHex(PALETTE.gold, PALETTE.deepGold, 0.55));
    metal.addColorStop(0.9, PALETTE.deepGold);
    metal.addColorStop(1, mixHex(PALETTE.deepGold, PALETTE.bronze, 0.6));
    fctx.fillStyle = metal;
    fctx.fillText(digits, cx, baseline);

    // Top bevel: a bright inner edge, clipped to the glyphs so it reads
    // as a chamfer catching the key light rather than an outline.
    fctx.save();
    fctx.globalCompositeOperation = "source-atop";
    const bevel = fctx.createLinearGradient(0, top, 0, top + size * 0.18);
    bevel.addColorStop(0, hexToRgba("#FFFFFF", 0.85));
    bevel.addColorStop(1, hexToRgba("#FFFFFF", 0));
    fctx.fillStyle = bevel;
    fctx.fillRect(0, top, width, size * 0.2);
    // Matching bounce light off the base.
    const bounce = fctx.createLinearGradient(0, bottom - size * 0.12, 0, bottom);
    bounce.addColorStop(0, hexToRgba(PALETTE.gold, 0));
    bounce.addColorStop(1, hexToRgba(PALETTE.champagne, 0.5));
    fctx.fillStyle = bounce;
    fctx.fillRect(0, bottom - size * 0.14, width, size * 0.14);
    fctx.restore();

    // Crisp rim. This is what holds the numeral together against a busy
    // background and is the main reason it stays readable at phone size.
    fctx.lineWidth = Math.max(1.5, size * 0.016);
    fctx.strokeStyle = hexToRgba(PALETTE.crystal, 0.9);
    fctx.strokeText(digits, cx, baseline);
  }

  if (sctx) {
    sctx.textAlign = "center";
    sctx.textBaseline = "alphabetic";
    sctx.font = font;
    sctx.fillStyle = "#FFFFFF";
    sctx.fillText(digits, cx, baseline);
    // Slightly fattened, so the extrusion layers peek out evenly behind
    // the face instead of showing hairline gaps on one side.
    sctx.lineWidth = Math.max(1, size * 0.02);
    sctx.strokeStyle = "#FFFFFF";
    sctx.strokeText(digits, cx, baseline);
  }

  return {
    face,
    silhouette,
    aspect: width / height,
    glyphWidthRatio: textWidth / width,
    glyphHeightRatio: glyphHeight / height,
  };
}

export interface CaptionArt {
  canvas: HTMLCanvasElement;
  aspect: number;
  /** Cap height as a fraction of the canvas, for the same reason as the numeral. */
  glyphHeightRatio: number;
}

/** The caption above the numeral. */
export function drawCaption(text: string, pixelHeight: number): CaptionArt | null {
  const label = text.trim().toUpperCase();
  if (!label) return null;

  const size = Math.max(18, Math.min(120, Math.round(pixelHeight)));
  const tracking = size * 0.26;
  const font = `700 ${size}px ${FONT_STACK}`;

  const probe = createCanvas(8, 8).getContext("2d");
  let textWidth = size * 0.7 * label.length;
  if (probe) {
    probe.font = font;
    textWidth = 0;
    for (const char of label) textWidth += probe.measureText(char).width + tracking;
  }

  const glyphHeight = size * 0.72;
  const padding = size * 0.5;
  const canvas = createCanvas(textWidth + padding * 2, glyphHeight + size * 0.7);
  const result: CaptionArt = {
    canvas,
    aspect: canvas.width / canvas.height,
    glyphHeightRatio: glyphHeight / canvas.height,
  };
  const ctx = canvas.getContext("2d");
  if (!ctx) return result;

  const baseline = canvas.height / 2 + glyphHeight * 0.5;
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Letter-spaced by hand: wide tracking is most of what separates a
  // broadcast caption from body text, and canvas has no letterSpacing on
  // older Safari.
  let x = padding;
  const gradient = ctx.createLinearGradient(0, baseline - size, 0, baseline);
  gradient.addColorStop(0, PALETTE.crystal);
  gradient.addColorStop(1, PALETTE.gold);

  for (const char of label) {
    if ("filter" in ctx) ctx.filter = `blur(${size * 0.12}px)`;
    ctx.fillStyle = hexToRgba(PALETTE.gold, 0.55);
    ctx.fillText(char, x, baseline);
    if ("filter" in ctx) ctx.filter = "none";
    ctx.fillStyle = gradient;
    ctx.fillText(char, x, baseline);
    x += ctx.measureText(char).width + tracking;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/** Soft round mote, used for the particle cloud and the bursts. */
export function moteTexture(): HTMLCanvasElement {
  const size = 64;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, hexToRgba(PALETTE.crystal, 0.85));
  gradient.addColorStop(0.5, hexToRgba(PALETTE.gold, 0.35));
  gradient.addColorStop(1, hexToRgba(PALETTE.deepGold, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * A light shaft: bright and narrow at the root, spreading and fading
 * outwards. Mapped onto a tapered plane it reads as a volumetric beam.
 */
export function beamTexture(): HTMLCanvasElement {
  const width = 64;
  const height = 256;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const along = ctx.createLinearGradient(0, height, 0, 0);
  along.addColorStop(0, hexToRgba(PALETTE.crystal, 0.85));
  along.addColorStop(0.35, hexToRgba(PALETTE.gold, 0.34));
  along.addColorStop(1, hexToRgba(PALETTE.gold, 0));
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, width, height);

  // Feather the long edges, otherwise the beam has visible sides and
  // stops being light.
  ctx.globalCompositeOperation = "destination-in";
  const across = ctx.createLinearGradient(0, 0, width, 0);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.5, "rgba(0,0,0,1)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** A soft annulus for the holographic rings and the shockwave. */
export function ringTexture(sharpness = 0.16, size = 256): HTMLCanvasElement {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  const edge = 1 - sharpness;
  gradient.addColorStop(0, hexToRgba(PALETTE.gold, 0));
  gradient.addColorStop(Math.max(0, edge - sharpness * 2), hexToRgba(PALETTE.gold, 0));
  gradient.addColorStop(edge - sharpness * 0.5, hexToRgba(PALETTE.gold, 0.55));
  gradient.addColorStop(edge, hexToRgba(PALETTE.crystal, 1));
  gradient.addColorStop(Math.min(1, edge + sharpness * 0.6), hexToRgba(PALETTE.gold, 0.4));
  gradient.addColorStop(1, hexToRgba(PALETTE.gold, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * Anamorphic flare: a wide horizontal streak through a tight core. Held
 * to a low peak alpha — the direction forbids flashing the whole frame,
 * so this is a highlight on the lens, not an exposure event.
 */
export function flareTexture(): HTMLCanvasElement {
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const half = size / 2;

  ctx.globalCompositeOperation = "lighter";

  const core = ctx.createRadialGradient(half, half, 0, half, half, size * 0.16);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(0.4, hexToRgba(PALETTE.crystal, 0.45));
  core.addColorStop(1, hexToRgba(PALETTE.gold, 0));
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  const streak = ctx.createLinearGradient(0, half, size, half);
  streak.addColorStop(0, hexToRgba(PALETTE.gold, 0));
  streak.addColorStop(0.5, hexToRgba(PALETTE.crystal, 0.75));
  streak.addColorStop(1, hexToRgba(PALETTE.gold, 0));
  ctx.fillStyle = streak;
  ctx.save();
  ctx.translate(half, half);
  ctx.scale(1, 0.035);
  ctx.translate(-half, -half);
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // A shorter vertical companion keeps it from looking like a drawn line.
  ctx.fillStyle = streak;
  ctx.save();
  ctx.translate(half, half);
  ctx.rotate(Math.PI / 2);
  ctx.scale(0.45, 0.022);
  ctx.translate(-half, -half);
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  return canvas;
}

/**
 * The environment the metal and glass reflect.
 *
 * This is the single highest-leverage texture in the whole feature.
 * Physically based metal is *only* its reflections — with no environment
 * a gold ball renders as a flat dark disc. A hand-painted equirectangular
 * map of a dark studio with warm overhead sources and cool rim sources is
 * what makes the ball look like a machined object sitting in the show's
 * lighting rig rather than a shaded sphere.
 */
export function environmentTexture(equirectWidth = 1024): HTMLCanvasElement {
  const width = Math.max(128, Math.round(equirectWidth));
  const height = width / 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Deep atmospheric space, brighter towards the horizon.
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#05070E");
  base.addColorStop(0.42, "#0C1020");
  base.addColorStop(0.55, "#1A1724");
  base.addColorStop(1, "#04050A");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = "lighter";

  const blob = (x: number, y: number, radius: number, color: string, alpha: number): void => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, hexToRgba(color, alpha));
    gradient.addColorStop(0.45, hexToRgba(color, alpha * 0.35));
    gradient.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  // Key: a broad warm source overhead, which becomes the long highlight
  // running across the top of the ball.
  blob(width * 0.5, height * 0.08, width * 0.34, PALETTE.champagne, 0.95);
  blob(width * 0.5, height * 0.02, width * 0.14, "#FFFFFF", 0.9);
  // Two warm kickers at three-quarter angles.
  blob(width * 0.16, height * 0.3, width * 0.17, PALETTE.gold, 0.7);
  blob(width * 0.84, height * 0.3, width * 0.17, PALETTE.gold, 0.7);
  // Cool rim sources low and behind, for the electric edge on the bezel.
  blob(width * 0.32, height * 0.72, width * 0.13, PALETTE.electric, 0.34);
  blob(width * 0.7, height * 0.74, width * 0.12, PALETTE.violet, 0.26);
  // A dim horizon band reads as a lit floor and grounds the object.
  const horizon = ctx.createLinearGradient(0, height * 0.5, 0, height * 0.62);
  horizon.addColorStop(0, hexToRgba(PALETTE.deepGold, 0));
  horizon.addColorStop(0.5, hexToRgba(PALETTE.deepGold, 0.3));
  horizon.addColorStop(1, hexToRgba(PALETTE.deepGold, 0));
  ctx.fillStyle = horizon;
  ctx.fillRect(0, height * 0.5, width, height * 0.12);

  return canvas;
}

/** Brushed radial grain for the medallion face. */
export function faceTexture(): HTMLCanvasElement {
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const half = size / 2;

  const base = ctx.createRadialGradient(half, half * 0.7, 0, half, half, half);
  base.addColorStop(0, PALETTE.champagne);
  base.addColorStop(0.5, mixHex(PALETTE.gold, PALETTE.deepGold, 0.35));
  base.addColorStop(1, mixHex(PALETTE.deepGold, PALETTE.bronze, 0.45));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Spun-metal grain: fine radial spokes at very low contrast. Enough to
  // catch the light as the ball turns, not enough to see as a pattern.
  ctx.globalCompositeOperation = "overlay";
  ctx.lineWidth = 1;
  for (let i = 0; i < 220; i += 1) {
    const angle = (i / 220) * Math.PI * 2;
    const alpha = 0.04 + (i % 7) * 0.008;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.lineTo(half + Math.cos(angle) * half, half + Math.sin(angle) * half);
    ctx.stroke();
  }

  return canvas;
}
