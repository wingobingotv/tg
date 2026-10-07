/**
 * The reveal without WebGL.
 *
 * This exists for devices that cannot give us a GL context at all, for
 * ones where the context is lost mid-show, and for the weakest tier where
 * a physically based ball is not worth the frame budget. It is not a
 * degraded placeholder: it runs the same four beats, uses the same
 * palette and the same numeral artwork, and keeps the same composition —
 * a gold disc inside light rings with the number standing proud of it.
 * A viewer on a cheap phone should recognise the moment, not notice a
 * different feature.
 *
 * Everything here is a gradient or a transform, so it holds 60fps on
 * hardware that cannot run a shader.
 */

import { PALETTE, hexToRgba, mixHex } from "../cinematic-fx";
import { drawCaption, drawNumeral } from "./textures";
import {
  clamp,
  damped,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  phaseAt,
  progress,
  type Timeline,
} from "./timeline";

interface Mote {
  angle: number;
  radius: number;
  orbit: number;
  size: number;
  depth: number;
  bob: number;
}

interface Spark {
  vx: number;
  vy: number;
  size: number;
  crystal: boolean;
}

export class LuckyNumberFallback {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private numeral: HTMLCanvasElement | null = null;
  private silhouette: HTMLCanvasElement | null = null;
  private caption: { canvas: HTMLCanvasElement; aspect: number; glyphHeightRatio: number } | null =
    null;
  private numeralAspect = 1;
  private glyphHeightRatio = 1;

  private readonly motes: Mote[] = [];
  private readonly sparks: Spark[] = [];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private text = "";
  private label: string | undefined;
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly reducedMotion: boolean,
    moteCount = 130,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d", { alpha: true });

    for (let i = 0; i < moteCount; i += 1) {
      this.motes.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.62 + Math.random() * 0.9,
        orbit: (Math.random() > 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.22),
        size: 1 + Math.random() * 2.6,
        depth: 0.5 + Math.random() * 0.9,
        bob: Math.random() * Math.PI * 2,
      });
    }
    for (let i = 0; i < Math.round(moteCount * 1.6); i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      this.sparks.push({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random() * 2.2,
        crystal: Math.random() > 0.7,
      });
    }
  }

  setNumber(text: string, label?: string): void {
    this.text = text;
    this.label = label;
    this.rasterise();
  }

  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.rasterise();
  }

  private rasterise(): void {
    if (!this.text) return;
    const pixelHeight = clamp(Math.min(this.width, this.height) * 0.26, 72, 340);
    const art = drawNumeral(this.text, pixelHeight);
    this.numeral = art.face;
    this.silhouette = art.silhouette;
    this.numeralAspect = art.aspect;
    this.glyphHeightRatio = art.glyphHeightRatio;
    this.caption = this.label ? drawCaption(this.label, pixelHeight * 0.17) : null;
  }

  render(elapsed: number, timeline: Timeline): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;

    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const phase = phaseAt(timeline, elapsed);
    if (phase === "done") return;

    const gather = progress(elapsed, 0, timeline.gatherEnd);
    const sinceImpact = (elapsed - timeline.gatherEnd) / 1000;
    const release = progress(elapsed, timeline.holdEnd, timeline.totalMs);
    const fadeIn = progress(elapsed, 0, 320);
    const overall = fadeIn * (1 - easeInCubic(release));
    const calm = this.reducedMotion ? 0.35 : 1;
    const seconds = elapsed / 1000;

    const cx = width / 2;
    const cy = height / 2;
    // The disc is sized from the short edge so portrait phones and
    // widescreen desktops get the same proportions.
    const unit = Math.min(Math.min(width, height) * (height > width ? 0.21 : 0.16), width * 0.24);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    this.drawBeams(ctx, cx, cy, unit, gather, phase, overall, calm, seconds);
    this.drawMotes(ctx, cx, cy, unit, gather, phase, overall, calm, seconds);
    if (phase !== "gather") {
      this.drawShockwave(ctx, cx, cy, unit, sinceImpact, overall);
      this.drawSparks(ctx, cx, cy, unit, sinceImpact, overall);
    }
    ctx.restore();

    this.drawBall(ctx, cx, cy, unit, phase, elapsed, timeline, sinceImpact, overall, calm, seconds);
  }

  private drawBeams(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    gather: number,
    phase: string,
    overall: number,
    calm: number,
    seconds: number,
  ): void {
    const level = (phase === "gather" ? easeOutCubic(gather) : 0.7) * overall;
    if (level <= 0.01) return;

    const count = 7;
    const length = unit * 4.2;
    const canFilter = "filter" in ctx;
    if (canFilter) ctx.filter = `blur(${Math.max(10, unit * 0.14)}px)`;

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + seconds * 0.11 * calm;
      const flicker = 0.8 + Math.sin(seconds * 1.6 + i * 2.1) * 0.2;
      const gradient = ctx.createLinearGradient(cx, cy, cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      gradient.addColorStop(0, hexToRgba(PALETTE.crystal, 0.22 * level * flicker));
      gradient.addColorStop(0.4, hexToRgba(PALETTE.gold, 0.1 * level * flicker));
      gradient.addColorStop(1, hexToRgba(PALETTE.gold, 0));
      ctx.fillStyle = gradient;

      const spread = unit * 0.26;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle + 0.02) * unit * 0.6, cy + Math.sin(angle + 0.02) * unit * 0.6);
      ctx.lineTo(
        cx + Math.cos(angle) * length - Math.sin(angle) * spread,
        cy + Math.sin(angle) * length + Math.cos(angle) * spread,
      );
      ctx.lineTo(
        cx + Math.cos(angle) * length + Math.sin(angle) * spread,
        cy + Math.sin(angle) * length - Math.cos(angle) * spread,
      );
      ctx.closePath();
      ctx.fill();
    }
    if (canFilter) ctx.filter = "none";
  }

  private drawMotes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    gather: number,
    phase: string,
    overall: number,
    calm: number,
    seconds: number,
  ): void {
    const converge = easeOutCubic(gather);
    const presence = (phase === "gather" ? 0.4 + gather * 0.5 : 0.5) * overall;
    if (presence <= 0.01) return;

    for (const mote of this.motes) {
      const angle = mote.angle + seconds * mote.orbit * calm;
      // Same idea as the 3D cloud: start far out, settle onto a shell
      // that is always clear of the numeral.
      const restRadius = unit * (1.25 + mote.radius * 0.9);
      const radius = restRadius * (1 + (1 - converge) * 4.2);
      const x = cx + Math.cos(angle) * radius;
      const y =
        cy + Math.sin(angle) * radius * 0.82 + Math.sin(seconds * 0.9 + mote.bob) * unit * 0.05 * calm;
      const size = mote.size * mote.depth * (unit / 120);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
      gradient.addColorStop(0, hexToRgba(PALETTE.crystal, 0.9 * presence));
      gradient.addColorStop(0.4, hexToRgba(PALETTE.gold, 0.4 * presence));
      gradient.addColorStop(1, hexToRgba(PALETTE.gold, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
    }
  }

  private drawShockwave(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    sinceImpact: number,
    overall: number,
  ): void {
    const life = 1.5;
    if (sinceImpact >= life) return;
    const t = sinceImpact / life;

    const ring = (speed: number, color: string, peak: number, thickness: number): void => {
      const p = Math.min(1, t * speed);
      const radius = unit * (0.9 + easeOutExpo(p) * 7);
      const alpha = Math.pow(1 - p, 2.2) * peak * overall;
      if (alpha <= 0.01) return;
      ctx.strokeStyle = hexToRgba(color, alpha);
      ctx.lineWidth = thickness * (1 - p * 0.7);
      ctx.beginPath();
      // Flattened: a circle drawn on the screen plane looks like a
      // sticker, an ellipse reads as a wave crossing the stage.
      ctx.ellipse(cx, cy, radius, radius * 0.46, 0, 0, Math.PI * 2);
      ctx.stroke();
    };

    const canFilter = "filter" in ctx;
    if (canFilter) ctx.filter = `blur(${unit * 0.06}px)`;
    ring(1, PALETTE.gold, 0.55, unit * 0.1);
    if (canFilter) ctx.filter = "none";
    ring(1.35, PALETTE.crystal, 0.5, unit * 0.02);
  }

  private drawSparks(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    sinceImpact: number,
    overall: number,
  ): void {
    const life = 2.2;
    if (sinceImpact >= life) return;
    const t = sinceImpact / life;
    const travel = ((1 - Math.exp(-sinceImpact * 2.2)) / 2.2) * unit * 5.5;
    const fall = sinceImpact * sinceImpact * unit * 0.7;
    const alpha = Math.pow(1 - t, 1.7) * overall;
    if (alpha <= 0.01) return;

    for (const spark of this.sparks) {
      const x = cx + spark.vx * travel;
      const y = cy + spark.vy * travel + fall;
      const size = spark.size * (unit / 130);
      const color = spark.crystal ? PALETTE.crystal : PALETTE.gold;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
      gradient.addColorStop(0, hexToRgba(color, alpha));
      gradient.addColorStop(0.35, hexToRgba(color, alpha * 0.45));
      gradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
    }
  }

  private drawBall(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    phase: string,
    elapsed: number,
    timeline: Timeline,
    sinceImpact: number,
    overall: number,
    calm: number,
    seconds: number,
  ): void {
    let scale: number;
    let alpha: number;
    if (phase === "gather") {
      const bloomIn = progress(elapsed, timeline.gatherEnd - 260, timeline.gatherEnd);
      scale = 0.08 + bloomIn * 0.16;
      alpha = bloomIn * 0.4;
    } else {
      const arrive = clamp(sinceImpact / 0.42, 0, 1);
      scale = 0.24 + 0.76 * easeOutBack(arrive, 1.9);
      scale += damped(clamp(sinceImpact / 0.9, 0, 1), 2.5, 7) * 0.035 * calm;
      alpha = clamp(sinceImpact / 0.06, 0, 1);
    }
    alpha *= overall;
    if (alpha <= 0.01) return;

    const float = Math.sin(seconds * 0.62) * unit * 0.05 * calm;
    const radius = unit * scale;

    ctx.save();
    ctx.translate(cx, cy + float);
    ctx.globalAlpha = alpha;

    // Rings, drawn as flattened ellipses on independent tilts so the
    // assembly reads as three-dimensional even without a camera.
    ctx.globalCompositeOperation = "lighter";
    const ringSpecs = [
      { r: 1.34, tilt: 0.34, speed: 0.42, color: PALETTE.gold, a: 0.5 },
      { r: 1.54, tilt: -0.62, speed: -0.3, color: PALETTE.champagne, a: 0.32 },
      { r: 1.7, tilt: 1.18, speed: 0.22, color: PALETTE.electric, a: 0.2 },
    ];
    const canFilterRings = "filter" in ctx;
    for (const spec of ringSpecs) {
      ctx.save();
      ctx.rotate(spec.tilt + seconds * spec.speed * 0.2 * calm);
      // The vertical squash oscillates, which is what a ring tumbling in
      // 3D looks like projected onto a screen.
      const squash = 0.3 + Math.abs(Math.sin(seconds * spec.speed * 0.6 + spec.tilt)) * 0.42;
      const ry = radius * spec.r * squash;
      // Drawn twice: a wide blurred pass for the glow, then a fine core.
      // A single hairline stroke reads as an orbit diagram rather than
      // light.
      if (canFilterRings) {
        ctx.filter = `blur(${Math.max(2, radius * 0.06)}px)`;
        ctx.strokeStyle = hexToRgba(spec.color, spec.a * 0.8);
        ctx.lineWidth = Math.max(2, radius * 0.09);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * spec.r, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.filter = "none";
      }
      ctx.strokeStyle = hexToRgba(PALETTE.crystal, spec.a * 0.55);
      ctx.lineWidth = Math.max(1, radius * 0.014);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * spec.r, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Ball: a metal sphere is a gradient offset towards the key light,
    // plus a rim to separate it from the video behind.
    ctx.globalCompositeOperation = "source-over";
    const body = ctx.createRadialGradient(
      -radius * 0.34,
      -radius * 0.42,
      radius * 0.06,
      0,
      0,
      radius,
    );
    body.addColorStop(0, PALETTE.crystal);
    body.addColorStop(0.22, PALETTE.champagne);
    body.addColorStop(0.55, mixHex(PALETTE.gold, PALETTE.deepGold, 0.5));
    body.addColorStop(0.85, mixHex(PALETTE.deepGold, PALETTE.bronze, 0.5));
    body.addColorStop(1, "#2A1A08");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexToRgba(PALETTE.electric, 0.34);
    ctx.lineWidth = Math.max(1, radius * 0.025);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.99, Math.PI * 0.55, Math.PI * 1.7);
    ctx.stroke();

    // Medallion face and bezel.
    ctx.globalCompositeOperation = "source-over";
    const faceRadius = radius * 0.78;
    const face = ctx.createRadialGradient(0, -faceRadius * 0.4, 0, 0, 0, faceRadius);
    face.addColorStop(0, PALETTE.champagne);
    face.addColorStop(0.55, mixHex(PALETTE.gold, PALETTE.deepGold, 0.4));
    face.addColorStop(1, mixHex(PALETTE.deepGold, PALETTE.bronze, 0.5));
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, faceRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hexToRgba(PALETTE.crystal, 0.75);
    ctx.lineWidth = Math.max(1.2, radius * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, faceRadius, 0, Math.PI * 2);
    ctx.stroke();

    // The numeral: silhouettes offset up-left for extrusion, then the lit
    // face on top. Same artwork the 3D path uses, so the two renderers
    // are typographically identical.
    if (this.numeral && this.silhouette) {
      const glyphHeight = Math.min(faceRadius * 1.34, (faceRadius * 1.7) / this.numeralAspect);
      const targetHeight = glyphHeight / this.glyphHeightRatio;
      const targetWidth = targetHeight * this.numeralAspect;
      const step = Math.max(1, radius * 0.016);

      ctx.globalCompositeOperation = "source-over";
      for (let i = 3; i >= 1; i -= 1) {
        ctx.globalAlpha = alpha * 0.3;
        ctx.drawImage(
          this.silhouette,
          -targetWidth / 2 + step * i * 0.35,
          -targetHeight / 2 + step * i,
          targetWidth,
          targetHeight,
        );
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.numeral, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);

      if (this.caption) {
        const captionIn = phase === "gather" ? 0 : clamp((sinceImpact - 0.22) / 0.34, 0, 1);
        if (captionIn > 0.01) {
          const captionHeight = (faceRadius * 0.34) / this.caption.glyphHeightRatio;
          const captionWidth = captionHeight * this.caption.aspect;
          ctx.globalAlpha = alpha * captionIn;
          // Solid, for the same reason as the 3D caption.
          ctx.globalCompositeOperation = "source-over";
          ctx.drawImage(
            this.caption.canvas,
            -captionWidth / 2,
            -radius * 1.1 - captionHeight * 0.9,
            captionWidth,
            captionHeight,
          );
        }
      }
    }

    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
  }
}
