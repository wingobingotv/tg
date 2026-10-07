/**
 * Choreography.
 *
 * A preset is a timeline of cues over the stage's emitters — never over
 * pixels. That separation is the whole point of the registry: adding an
 * effect means writing a new arrangement of the same vocabulary, not new
 * rendering code.
 *
 * Every celebration follows the four-beat shape the brief describes —
 * build, main, hero, finish — but a shared shape is not a shared *look*.
 * Each preset owns a signature mechanic that no other preset uses, so
 * two effects are told apart by what happens in them, not by how long
 * they run:
 *
 *   grand celebration  volleys of rockets climbing into the frame
 *   jackpot            a rising vortex of coins around the stage
 *   mega jackpot       twin vortices, a beam, and a double climax
 *   big win            two stage cannons and one crown shell
 *   winner reveal      dust implodes to a point, then a beam stands up
 *   golden rain        palm shells raining light trails, no bursts
 *   fireworks          a programmed display: patterns, no foil at all
 *   confetti blast     side cannons firing foil across the frame
 *   countdown          three accelerating pulses and a release
 *   lucky number       convergence to a single point of light
 *   announcement       one slow sweep of light and nothing else
 */

import { PALETTE } from "./sprites";
import type { CinematicStage } from "./stage";
import type { CinematicEffectId, CinematicIntensity } from "./types";

export interface CueContext {
  stage: CinematicStage;
  /** Scales every count. Driven by the event's `intensity`. */
  power: number;
}

export interface Cue {
  /** Milliseconds from the start of the sequence. */
  at: number;
  /** Repeat until this timestamp. Requires `every`. */
  until?: number;
  /** Repeat interval in ms. */
  every?: number;
  run(ctx: CueContext, iteration: number): void;
}

export interface EffectPreset {
  id: CinematicEffectId;
  label: string;
  /** Length of the choreography itself. */
  durationMs: number;
  /**
   * Extra time after the last cue during which particles are allowed to
   * finish. The overlay stays mounted, but nothing new is emitted — this
   * is what stops the effect ending on a cut.
   */
  tailMs: number;
  cues: Cue[];
}

const INTENSITY_POWER: Record<CinematicIntensity, number> = {
  subtle: 0.55,
  standard: 1,
  epic: 1.5,
};

export function powerFor(intensity: CinematicIntensity | undefined): number {
  return INTENSITY_POWER[intensity ?? "standard"];
}

// ---------------------------------------------------------------------------
// Shared phrases
// ---------------------------------------------------------------------------

/**
 * Phase 1. The room reacts before anything explodes: motes lift into
 * frame, light streaks cross the background, and the edge glow rises. By
 * the end of it the viewer knows something is coming.
 */
function buildUp(
  from: number,
  to: number,
  opts: { peak?: number; glimmers?: boolean } = {},
): Cue[] {
  const peak = opts.peak ?? 0.8;
  const span = to - from;
  const cues: Cue[] = [
    {
      at: from,
      run: ({ stage, power }) => {
        stage.setAtmosphere(peak * 0.5);
        stage.emitEmbers(Math.round(36 * power), { fromBottom: true });
      },
    },
    {
      at: from + 40,
      every: 110,
      until: to,
      run: ({ stage, power }) => stage.emitEmbers(Math.round(7 * power), { fromBottom: true }),
    },
    {
      at: from + span * 0.12,
      every: 170,
      until: to,
      run: ({ stage, power }) => stage.emitStreaks(Math.round(2 * power)),
    },
    { at: from + span * 0.5, run: ({ stage }) => stage.setAtmosphere(peak * 0.75) },
    { at: from + span * 0.85, run: ({ stage }) => stage.setAtmosphere(peak) },
  ];

  if (opts.glimmers !== false) {
    cues.push({
      // Distant glimmers just before the first shell. They give the
      // build-up somewhere to arrive: without them the phase reads as
      // dead air rather than as anticipation.
      at: from + span * 0.62,
      every: Math.max(120, span * 0.16),
      until: to,
      run: ({ stage, power }, iteration) => {
        const spot = stage.pickBurstPosition(
          stage.random.range(1700, 2600),
          iteration % 2 === 0 ? -1 : 1,
        );
        stage.burst({
          ...spot,
          count: Math.round(26 * power),
          power: 280,
          flashRadius: 34,
          life: 1.1,
          fragment: false,
        });
      },
    });
  }

  return cues;
}

/** Gold dust running underneath everything else. */
function dustBed(from: number, to: number, rate = 220): Cue {
  return {
    at: from,
    every: rate,
    until: to,
    run: ({ stage, power }) => stage.emitEmbers(Math.round(5 * power)),
  };
}

/** Foil falling from above, entering from the sides as well as the top. */
function foilShower(from: number, to: number, opts: { round?: boolean } = {}): Cue[] {
  return [
    {
      at: from,
      run: ({ stage, power }) =>
        stage.emitConfetti(Math.round(60 * power), { round: opts.round }),
    },
    {
      at: from + 280,
      every: 320,
      until: to,
      run: ({ stage, power }) =>
        stage.emitConfetti(Math.round(20 * power), { round: opts.round }),
    },
    {
      at: from + 600,
      every: 900,
      until: to,
      run: ({ stage }) => stage.emitForegroundConfetti(1),
    },
  ];
}

/**
 * Phase 4. Energy leaves the scene in the order it arrived: the shells
 * stop first, then the foil thins, then the glow drains, and the last
 * motes are still drifting when the overlay finally unmounts.
 */
function settle(from: number, to: number, opts: { shells?: boolean } = {}): Cue[] {
  const span = to - from;
  const cues: Cue[] = [
    { at: from, run: ({ stage }) => stage.setAtmosphere(0.55) },
    {
      at: from + span * 0.2,
      run: ({ stage, power }) => stage.emitConfetti(Math.round(22 * power)),
    },
    {
      at: from + span * 0.15,
      every: 300,
      until: to,
      run: ({ stage, power }) => stage.emitEmbers(Math.round(3 * power)),
    },
    { at: from + span * 0.45, run: ({ stage }) => stage.setAtmosphere(0.3) },
    { at: from + span * 0.75, run: ({ stage }) => stage.setAtmosphere(0.12) },
    { at: to, run: ({ stage }) => stage.setAtmosphere(0) },
  ];

  if (opts.shells !== false) {
    cues.push({
      at: from + span * 0.12,
      run: ({ stage, power }) => {
        const spot = stage.pickBurstPosition(stage.random.range(1300, 2100));
        stage.burst({
          ...spot,
          count: Math.round(60 * power),
          power: 480,
          flashRadius: 52,
          life: 1.6,
          fragment: false,
        });
      },
    });
  }

  return cues;
}

/**
 * The climax common to the big effects: a wave front leaves stage level
 * and crosses the frame while shells fire behind it. Presets vary it by
 * accent, by whether foil is involved and by whether it happens twice.
 */
function heroWave(
  at: number,
  opts: { accent?: string; confetti?: boolean; pulse?: number } = {},
): Cue[] {
  const accent = opts.accent ?? PALETTE.electric;
  const withConfetti = opts.confetti !== false;
  return [
    {
      at,
      run: ({ stage, power }) => {
        stage.setAtmosphere(1);
        // The wave leaves from stage level rather than from the centre of
        // the frame, so it reads as energy coming off the show instead of
        // a ring drawn on the screen.
        const originY = stage.camera.halfHeight * 0.28;
        stage.shockwave({ y: originY, z: 240, thickness: 20 });
        // A cool front racing just ahead of the gold body. Real
        // high-energy flashes separate by wavelength at the leading edge;
        // borrowing that is how the accent earns its place without
        // becoming a second colour story.
        stage.shockwave({
          y: originY,
          z: 240,
          color: accent,
          thickness: 5,
          life: 0.8,
          maxRadius: Math.max(stage.camera.width, stage.camera.height),
        });
        for (let i = 0; i < 3; i += 1) {
          const spot = stage.pickBurstPosition(stage.random.range(1200, 2000));
          stage.burst({
            ...spot,
            count: Math.round(130 * power),
            power: 820,
            flashRadius: 92,
            flare: i === 0,
            life: 2,
            pulse: i === 0 ? (opts.pulse ?? 0.55) : 0,
          });
        }
      },
    },
    {
      at: at + 120,
      run: ({ stage }) => {
        if (withConfetti) stage.emitForegroundConfetti(2);
      },
    },
    {
      at: at + 200,
      run: ({ stage, power }) => {
        if (withConfetti) stage.emitConfetti(Math.round(70 * power));
      },
    },
    {
      // Palms draping behind the wave: the long, slow light trails are
      // what give the climax a decay instead of a hard stop.
      at: at + 420,
      run: ({ stage, power }) => {
        for (let i = 0; i < 2; i += 1) {
          const spot = stage.pickBurstPosition(stage.random.range(1000, 1800));
          stage.burst({
            ...spot,
            shape: i === 0 ? "palm" : "willow",
            count: Math.round(80 * power),
            power: 540,
            flashRadius: 70,
            color: i === 1 ? accent : undefined,
          });
        }
        if (withConfetti) stage.emitForegroundConfetti(1);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Record<CinematicEffectId, EffectPreset> = {
  /**
   * Signature: **rocket volleys**. Shells are visibly launched from below
   * the frame and climb into it, so the display has a cause and a rhythm
   * rather than appearing out of nowhere.
   */
  "grand-celebration": {
    id: "grand-celebration",
    label: "Grand Celebration",
    durationMs: 7000,
    tailMs: 3600,
    cues: [
      ...buildUp(0, 1500),
      // First volley: three rockets away together, seen climbing.
      {
        at: 1200,
        run: ({ stage, power }) => {
          stage.emitRockets(3, {
            depth: [500, 1500],
            apex: [0.12, 0.3],
            payload: {
              count: Math.round(150 * power),
              power: 780,
              flashRadius: 96,
              flare: true,
              life: 1.9,
              pulse: 0.4,
            },
          });
        },
      },
      // Sustained fire, alternating sides, cycling through shell types.
      {
        at: 1900,
        every: 330,
        until: 3900,
        run: ({ stage, power }, iteration) => {
          const shapes = ["peony", "crackle", "willow", "palm", "crown"] as const;
          stage.emitRockets(1, {
            side: iteration % 2 === 0 ? -1 : 1,
            depth: [350, 1600],
            apex: [0.1, 0.36],
            payload: {
              shape: shapes[iteration % shapes.length],
              count: Math.round(stage.random.range(90, 150) * power),
              power: stage.random.range(500, 800),
              flashRadius: stage.random.range(64, 94),
              life: stage.random.range(1.3, 2),
              color: stage.random.chance(0.1) ? PALETTE.electric : undefined,
            },
          });
        },
      },
      // Background shells that were fired before we cut to this camera.
      {
        at: 2100,
        every: 480,
        until: 4000,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(1500, 2400),
            iteration % 2 === 0 ? 1 : -1,
          );
          stage.burst({
            ...spot,
            count: Math.round(60 * power),
            power: 460,
            flashRadius: 54,
            life: 1.5,
          });
        },
      },
      ...foilShower(1750, 4200),
      dustBed(1500, 4200),
      ...heroWave(4200),
      ...settle(5300, 7000),
    ],
  },

  /**
   * Signature: **a vortex of coins**. Struck metal discs spiral up around
   * the stage on a real 3D helix, passing in front of and behind the
   * subject. Nothing else in the catalogue has that shape.
   */
  jackpot: {
    id: "jackpot",
    label: "Jackpot",
    durationMs: 6200,
    tailMs: 3600,
    cues: [
      ...buildUp(0, 1100, { peak: 0.7, glimmers: false }),
      {
        at: 900,
        run: ({ stage }) => {
          stage.lightPillar({ z: 760, width: stage.camera.width * 0.26, life: 3.4 });
          stage.setAtmosphere(0.85);
        },
      },
      // The vortex spins up, tightening as it climbs.
      {
        at: 1050,
        every: 150,
        until: 3900,
        run: ({ stage, power }) => {
          // The helix orbits *around* the subject rather than through
          // them: the radius stays wide enough that the column frames the
          // host instead of burying them.
          stage.emitVortex(Math.round(5 * power), {
            z: 300,
            radius: [330, 560],
            radialVelocity: -22,
            // Rise fast relative to the orbit, or the helix reads as
            // motes running sideways instead of climbing.
            angularVelocity: 1.6,
            rise: [-420, -260],
          });
        },
      },
      // Coins, not foil: heavier, rounder, and they punch downwards.
      {
        at: 1300,
        run: ({ stage, power }) => stage.emitConfetti(Math.round(70 * power), { round: true }),
      },
      {
        at: 1600,
        every: 280,
        until: 4100,
        run: ({ stage, power }) => stage.emitConfetti(Math.round(26 * power), { round: true }),
      },
      {
        at: 1800,
        every: 850,
        until: 4100,
        run: ({ stage }) => stage.emitForegroundConfetti(1),
      },
      // Crackle shells only — the fast glitter texture reads as money.
      {
        at: 1700,
        every: 340,
        until: 4100,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(700, 1900),
            iteration % 2 === 0 ? -1 : 1,
          );
          stage.burst({
            ...spot,
            shape: "crackle",
            count: Math.round(150 * power),
            power: stage.random.range(420, 620),
            flashRadius: 70,
            life: 2.2,
          });
        },
      },
      dustBed(1100, 4200),
      ...heroWave(4200, { accent: PALETTE.violet, pulse: 0.7 }),
      {
        at: 4300,
        run: ({ stage, power }) => {
          stage.emitVortex(Math.round(60 * power), {
            z: 240,
            radius: [90, 300],
            radialVelocity: 150,
            angularVelocity: 3.4,
            rise: [-320, -180],
            life: [1.4, 2.2],
          });
        },
      },
      ...settle(5000, 6200),
    ],
  },

  /**
   * Signature: **twin counter-rotating vortices, a standing beam and a
   * double climax**, plus a sweep of light across the whole frame. The
   * biggest thing in the catalogue, and it should be obvious which one
   * it is within the first second.
   */
  "mega-jackpot": {
    id: "mega-jackpot",
    label: "Mega Jackpot",
    durationMs: 9000,
    tailMs: 4000,
    cues: [
      ...buildUp(0, 1400, { peak: 0.9 }),
      {
        at: 700,
        run: ({ stage }) => stage.godraySweep({ life: 2.4, peak: 0.2, tilt: -0.5 }),
      },
      {
        at: 1200,
        run: ({ stage }) => {
          stage.lightPillar({
            x: -stage.camera.halfWidth * 0.42,
            z: 900,
            width: stage.camera.width * 0.2,
            life: 4,
          });
          stage.lightPillar({
            x: stage.camera.halfWidth * 0.42,
            z: 900,
            width: stage.camera.width * 0.2,
            life: 4,
          });
        },
      },
      // Two helices turning against each other on either side of frame.
      {
        at: 1400,
        every: 130,
        until: 5200,
        run: ({ stage, power }, iteration) => {
          const side = iteration % 2 === 0 ? -1 : 1;
          stage.emitVortex(Math.round(7 * power), {
            x: side * stage.camera.halfWidth * 0.46,
            z: 380,
            radius: [130, 300],
            radialVelocity: -20,
            angularVelocity: side * 2.8,
            rise: [-260, -130],
          });
        },
      },
      {
        at: 1500,
        every: 280,
        until: 5400,
        run: ({ stage, power }, iteration) => {
          const shapes = ["crackle", "palm", "crown", "peony", "willow"] as const;
          stage.emitRockets(1, {
            side: iteration % 2 === 0 ? 1 : -1,
            depth: [300, 1700],
            apex: [0.08, 0.34],
            payload: {
              shape: shapes[iteration % shapes.length],
              count: Math.round(stage.random.range(110, 180) * power),
              power: stage.random.range(560, 860),
              flashRadius: stage.random.range(72, 104),
              flare: stage.random.chance(0.3),
              life: stage.random.range(1.4, 2.1),
              pulse: 0.25,
              color: stage.random.chance(0.12) ? PALETTE.violet : undefined,
            },
          });
        },
      },
      ...foilShower(1600, 5600, { round: true }),
      dustBed(1400, 5600, 160),
      // First climax.
      ...heroWave(5000, { accent: PALETTE.violet, pulse: 0.8 }),
      { at: 5600, run: ({ stage }) => stage.godraySweep({ life: 2, peak: 0.22, tilt: 0.5 }) },
      // Second, bigger climax — the thing that makes this the mega.
      {
        at: 6100,
        run: ({ stage, power }) => {
          stage.setAtmosphere(1);
          stage.shockwave({ y: stage.camera.halfHeight * 0.28, z: 160, thickness: 26, life: 1.6 });
          for (let i = 0; i < 4; i += 1) {
            const spot = stage.pickBurstPosition(
              stage.random.range(800, 2100),
              i % 2 === 0 ? -1 : 1,
            );
            stage.burst({
              ...spot,
              shape: i === 3 ? "crown" : "peony",
              count: Math.round(150 * power),
              power: 860,
              flashRadius: 100,
              flare: i < 2,
              life: 2.1,
              pulse: i === 0 ? 0.9 : 0,
            });
          }
          stage.emitForegroundConfetti(3);
          stage.emitConfetti(Math.round(110 * power), { round: true });
        },
      },
      {
        at: 6600,
        run: ({ stage, power }) => {
          for (let i = 0; i < 3; i += 1) {
            const spot = stage.pickBurstPosition(stage.random.range(900, 1900));
            stage.burst({
              ...spot,
              shape: "palm",
              count: Math.round(90 * power),
              power: 560,
              flashRadius: 76,
            });
          }
        },
      },
      ...settle(7100, 9000),
    ],
  },

  /**
   * Signature: **stage cannons**. Two bottom-corner blasts and a single
   * crown shell. Short, loud, over — nothing climbs, nothing lingers.
   */
  "big-win": {
    id: "big-win",
    label: "Big Win",
    durationMs: 4200,
    tailMs: 3200,
    cues: [
      ...buildUp(0, 700, { peak: 0.6, glimmers: false }),
      {
        at: 650,
        run: ({ stage, power }) => {
          stage.emitCannon(Math.round(70 * power), { from: "bottom-left", power: 980 });
          stage.emitCannon(Math.round(70 * power), { from: "bottom-right", power: 980 });
          stage.setAtmosphere(0.9);
          stage.emitForegroundConfetti(2);
        },
      },
      {
        at: 800,
        run: ({ stage, power }) => {
          const spot = stage.pickBurstPosition(900);
          stage.burst({
            ...spot,
            shape: "crown",
            count: Math.round(170 * power),
            power: 820,
            flashRadius: 100,
            flare: true,
            life: 1.8,
            pulse: 0.7,
          });
        },
      },
      {
        at: 1100,
        run: ({ stage }) => stage.shockwave({ y: stage.camera.halfHeight * 0.3, z: 260, thickness: 18 }),
      },
      {
        at: 1300,
        every: 420,
        until: 2500,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(1000, 2000),
            iteration % 2 === 0 ? -1 : 1,
          );
          stage.burst({
            ...spot,
            shape: iteration % 2 === 0 ? "crackle" : "peony",
            count: Math.round(100 * power),
            power: 600,
            flashRadius: 70,
          });
        },
      },
      dustBed(700, 2600),
      ...settle(2600, 4200),
    ],
  },

  /**
   * Signature: **implosion into a standing beam**. Dust converges inwards
   * on the subject, snaps, and a column of light stands up behind them.
   * The only preset that moves energy *inwards* before outwards.
   */
  "winner-reveal": {
    id: "winner-reveal",
    label: "Winner Reveal",
    durationMs: 5400,
    tailMs: 3200,
    cues: [
      ...buildUp(0, 1500, { peak: 0.7, glimmers: false }),
      // Convergence: a helix collapsing towards the axis.
      {
        at: 700,
        every: 120,
        until: 1900,
        run: ({ stage, power }) => {
          stage.emitVortex(Math.round(10 * power), {
            z: 320,
            radius: [380, 620],
            radialVelocity: -320,
            angularVelocity: 1.5,
            rise: [-40, 40],
            life: [1.4, 1.9],
            color: PALETTE.champagne,
          });
        },
      },
      // The snap: beam up, wave out.
      {
        at: 1950,
        run: ({ stage, power }) => {
          stage.setAtmosphere(1);
          stage.lightPillar({ z: 640, width: stage.camera.width * 0.34, life: 3.2 });
          stage.shockwave({ y: stage.camera.halfHeight * 0.3, z: 240, thickness: 22, life: 1.4 });
          stage.burst({
            x: 0,
            y: stage.camera.halfHeight * 0.05,
            z: 520,
            shape: "crackle",
            count: Math.round(190 * power),
            power: 620,
            flashRadius: 104,
            flare: true,
            life: 2.4,
            pulse: 0.75,
          });
          stage.emitForegroundConfetti(2);
        },
      },
      { at: 2100, run: ({ stage, power }) => stage.emitConfetti(Math.round(90 * power)) },
      {
        at: 2400,
        every: 520,
        until: 3800,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(1200, 2200),
            iteration % 2 === 0 ? -1 : 1,
          );
          stage.burst({
            ...spot,
            shape: "palm",
            count: Math.round(80 * power),
            power: 520,
            flashRadius: 66,
          });
        },
      },
      {
        at: 2600,
        every: 340,
        until: 3900,
        run: ({ stage, power }) => stage.emitConfetti(Math.round(18 * power)),
      },
      dustBed(1950, 3900),
      ...settle(3900, 5400, { shells: false }),
    ],
  },

  /**
   * Signature: **palm shells raining light trails**. No wave, no
   * cannons, no vortex — a continuous canopy of slow gold drifting down
   * through the persistence buffer for a long hold.
   */
  "golden-rain": {
    id: "golden-rain",
    label: "Golden Rain",
    durationMs: 7000,
    tailMs: 4200,
    cues: [
      ...buildUp(0, 1200, { peak: 0.6, glimmers: false }),
      { at: 1000, run: ({ stage }) => stage.godraySweep({ life: 3, peak: 0.12 }) },
      // High, slow palms whose stars hang and drape.
      {
        at: 1200,
        every: 620,
        until: 5400,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(900, 2000),
            iteration % 2 === 0 ? -1 : 1,
          );
          stage.burst({
            ...spot,
            shape: iteration % 3 === 2 ? "willow" : "palm",
            count: Math.round(110 * power),
            power: stage.random.range(420, 620),
            flashRadius: 62,
            life: 1.8,
            fragment: false,
          });
        },
      },
      {
        at: 1300,
        every: 200,
        until: 5600,
        run: ({ stage, power }) => {
          stage.emitConfetti(Math.round(14 * power));
          stage.emitEmbers(Math.round(9 * power), { fromBottom: false });
        },
      },
      {
        at: 1800,
        every: 1100,
        until: 5600,
        run: ({ stage }) => stage.emitForegroundConfetti(1),
      },
      { at: 2400, run: ({ stage }) => stage.setAtmosphere(0.78) },
      ...settle(5600, 7000, { shells: false }),
    ],
  },

  /**
   * Signature: **a programmed display**. Rockets, patterned shells,
   * staggered barrages and no foil whatsoever — the sky is the subject,
   * so nothing falls through the frame to distract from it.
   */
  fireworks: {
    id: "fireworks",
    label: "Fireworks",
    durationMs: 7600,
    tailMs: 3800,
    cues: [
      ...buildUp(0, 1200, { peak: 0.55 }),
      // Opening single, so the display starts with one clean shell.
      {
        at: 1100,
        run: ({ stage, power }) =>
          stage.emitRockets(1, {
            depth: [900, 1200],
            apex: [0.16, 0.22],
            payload: {
              count: Math.round(160 * power),
              power: 800,
              flashRadius: 98,
              flare: true,
              life: 2,
              pulse: 0.45,
            },
          }),
      },
      // Then barrages of three, cycling the pattern each time.
      {
        at: 2000,
        every: 900,
        until: 5400,
        run: ({ stage, power }, iteration) => {
          const shapes = ["crown", "palm", "crackle", "willow", "peony"] as const;
          const shape = shapes[iteration % shapes.length];
          stage.emitRockets(3, {
            depth: [400, 1900],
            apex: [0.08, 0.34],
            payload: {
              shape,
              count: Math.round(stage.random.range(100, 160) * power),
              power: stage.random.range(520, 840),
              flashRadius: stage.random.range(68, 98),
              life: stage.random.range(1.4, 2.1),
              pulse: 0.3,
              color: stage.random.chance(0.08) ? PALETTE.electric : undefined,
            },
          });
        },
      },
      // Fill between barrages, so the sky is never empty.
      {
        at: 2300,
        every: 400,
        until: 5400,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(1000, 2200),
            iteration % 2 === 0 ? 1 : -1,
          );
          stage.burst({
            ...spot,
            shape: iteration % 3 === 0 ? "willow" : "crackle",
            count: Math.round(100 * power),
            power: 540,
            flashRadius: 62,
            life: 1.9,
          });
        },
      },
      // Finale: everything at once, then done.
      {
        at: 5500,
        run: ({ stage, power }) => {
          stage.setAtmosphere(1);
          for (let i = 0; i < 5; i += 1) {
            const spot = stage.pickBurstPosition(
              stage.random.range(600, 2200),
              i % 2 === 0 ? -1 : 1,
            );
            stage.burst({
              ...spot,
              shape: i === 0 ? "crown" : i === 1 ? "palm" : "peony",
              count: Math.round(150 * power),
              power: 840,
              flashRadius: 96,
              flare: i < 2,
              life: 2.1,
              pulse: i === 0 ? 0.85 : 0,
            });
          }
        },
      },
      dustBed(1200, 6100),
      ...settle(6100, 7600),
    ],
  },

  /**
   * Signature: **side cannons**. Foil is fired horizontally across the
   * frame from off-screen left and right, fast and flat, instead of
   * falling from above.
   */
  "confetti-blast": {
    id: "confetti-blast",
    label: "Confetti Blast",
    durationMs: 5000,
    tailMs: 4000,
    cues: [
      ...buildUp(0, 700, { peak: 0.5, glimmers: false }),
      {
        at: 700,
        run: ({ stage, power }) => {
          stage.emitCannon(Math.round(90 * power), { from: "left", power: 1100 });
          stage.emitCannon(Math.round(90 * power), { from: "right", power: 1100 });
          stage.setAtmosphere(0.85);
          stage.emitForegroundConfetti(2);
          // No wave front here on purpose. Three effects were all
          // resolving to the same gold ellipse, which is precisely how a
          // catalogue starts feeling like one effect with a tempo dial.
          // This one is cannons and nothing else.
        },
      },
      // Alternating volleys, so foil keeps crossing in both directions.
      {
        at: 1200,
        every: 520,
        until: 3400,
        run: ({ stage, power }, iteration) => {
          stage.emitCannon(Math.round(45 * power), {
            from: iteration % 2 === 0 ? "bottom-left" : "bottom-right",
            power: 900,
          });
        },
      },
      {
        at: 1400,
        every: 760,
        until: 3400,
        run: ({ stage }) => stage.emitForegroundConfetti(1),
      },
      {
        at: 1100,
        every: 300,
        until: 3400,
        run: ({ stage, power }) => stage.emitConfetti(Math.round(24 * power)),
      },
      // Just enough light behind the foil to keep it metallic.
      {
        at: 1300,
        every: 620,
        until: 3300,
        run: ({ stage, power }, iteration) => {
          const spot = stage.pickBurstPosition(
            stage.random.range(1100, 2000),
            iteration % 2 === 0 ? -1 : 1,
          );
          stage.burst({
            ...spot,
            shape: "crackle",
            count: Math.round(80 * power),
            power: 500,
            flashRadius: 58,
          });
        },
      },
      dustBed(700, 3400),
      ...settle(3400, 5000, { shells: false }),
    ],
  },

  /**
   * Signature: **three accelerating pulses**. Rhythm carries this one:
   * each ring is tighter, brighter and faster than the last, and the
   * release only lands after the third. Reads as a countdown with no
   * numbers on screen.
   */
  countdown: {
    id: "countdown",
    label: "Countdown",
    durationMs: 5200,
    tailMs: 3000,
    cues: [
      { at: 0, run: ({ stage }) => stage.setAtmosphere(0.3) },
      {
        at: 0,
        every: 900,
        until: 2500,
        run: ({ stage, power }, iteration) => {
          stage.shockwave({
            y: stage.camera.halfHeight * 0.24,
            z: 560 - iteration * 150,
            maxRadius: 380 + iteration * 190,
            life: 0.72,
            thickness: 9 + iteration * 6,
            color: iteration === 2 ? PALETTE.gold : PALETTE.champagne,
          });
          stage.emitEmbers(Math.round((10 + iteration * 8) * power));
          stage.setAtmosphere(0.3 + iteration * 0.2);
          // A short crackle on each beat, growing. Placed above and
          // behind the subject, not on their chest.
          stage.burst({
            x: 0,
            y: -stage.camera.halfHeight * 0.5,
            z: 1000,
            shape: "crackle",
            count: Math.round((40 + iteration * 40) * power),
            power: 300 + iteration * 130,
            flashRadius: 40 + iteration * 22,
            life: 1.1,
            fragment: false,
            pulse: 0.2 + iteration * 0.15,
          });
        },
      },
      // Release.
      {
        at: 2900,
        run: ({ stage, power }) => {
          stage.setAtmosphere(1);
          stage.shockwave({ y: stage.camera.halfHeight * 0.28, z: 200, thickness: 28 });
          stage.emitRockets(3, {
            depth: [500, 1600],
            apex: [0.1, 0.3],
            payload: {
              count: Math.round(150 * power),
              power: 820,
              flashRadius: 98,
              flare: true,
              life: 2,
              pulse: 0.5,
            },
          });
          stage.emitCannon(Math.round(60 * power), { from: "bottom-left", power: 950 });
          stage.emitCannon(Math.round(60 * power), { from: "bottom-right", power: 950 });
          stage.emitForegroundConfetti(2);
        },
      },
      dustBed(2900, 3900),
      ...settle(3700, 5200),
    ],
  },

  /**
   * Signature: **convergence to a single point**. Everything collapses
   * onto one spot behind the subject, flashes, and leaves exactly one
   * ring. The most restrained big moment in the catalogue.
   */
  "lucky-number-reveal": {
    id: "lucky-number-reveal",
    label: "Lucky Number Reveal",
    durationMs: 4600,
    tailMs: 3000,
    cues: [
      ...buildUp(0, 1400, { peak: 0.7, glimmers: false }),
      {
        at: 500,
        every: 100,
        until: 1500,
        run: ({ stage, power }) => {
          stage.emitVortex(Math.round(11 * power), {
            z: 480,
            radius: [420, 700],
            radialVelocity: -430,
            angularVelocity: 2.6,
            rise: [-20, 20],
            life: [1.1, 1.5],
            color: PALETTE.crystal,
          });
        },
      },
      {
        at: 1520,
        run: ({ stage, power }) => {
          stage.setAtmosphere(1);
          stage.burst({
            x: 0,
            y: stage.camera.halfHeight * 0.06,
            z: 480,
            shape: "crackle",
            count: Math.round(210 * power),
            power: 540,
            flashRadius: 112,
            flare: true,
            life: 2.3,
            pulse: 0.85,
          });
          // A ring made of stars rather than a drawn wave front. Winner
          // Reveal owns the wave; this one resolves as a starburst, so
          // the two reveals never read as the same moment.
          stage.burst({
            x: 0,
            y: stage.camera.halfHeight * 0.06,
            z: 480,
            shape: "crown",
            count: Math.round(120 * power),
            power: 900,
            flashRadius: 0,
            life: 1.9,
            fragment: false,
          });
          stage.lightPillar({ z: 700, width: stage.camera.width * 0.22, life: 2.4 });
        },
      },
      {
        at: 1900,
        run: ({ stage, power }) => {
          stage.emitVortex(Math.round(70 * power), {
            z: 300,
            radius: [40, 160],
            radialVelocity: 260,
            angularVelocity: 3.6,
            rise: [-260, -120],
            life: [1.3, 2],
          });
          stage.emitConfetti(Math.round(46 * power));
        },
      },
      dustBed(1520, 3000),
      ...settle(3000, 4600, { shells: false }),
    ],
  },

  /**
   * Signature: **one sweep of light and nothing else**. No shells, no
   * cannons, no wave. Restraint is the point: this plays over a host
   * talking, so the frame must stay calm.
   */
  "special-announcement": {
    id: "special-announcement",
    label: "Special Announcement",
    durationMs: 4400,
    tailMs: 2600,
    cues: [
      ...buildUp(0, 1600, { peak: 0.6, glimmers: false }),
      { at: 600, run: ({ stage }) => stage.godraySweep({ life: 2.6, peak: 0.15, tilt: -0.45 }) },
      {
        at: 1500,
        run: ({ stage, power }) => {
          // A trio of beams standing up behind the subject. One alone
          // barely registers at this depth; three at different widths
          // read as a lit set rather than a stray gradient.
          stage.lightPillar({ z: 820, width: stage.camera.width * 0.46, life: 2.9 });
          stage.lightPillar({
            x: -stage.camera.halfWidth * 0.62,
            z: 1100,
            width: stage.camera.width * 0.26,
            color: PALETTE.champagne,
            life: 2.6,
          });
          stage.lightPillar({
            x: stage.camera.halfWidth * 0.62,
            z: 1100,
            width: stage.camera.width * 0.26,
            color: PALETTE.champagne,
            life: 2.6,
          });
          stage.emitEmbers(Math.round(40 * power));
          stage.setAtmosphere(0.8);
        },
      },
      {
        // Fine glitter high and far back: enough sparkle to make the
        // moment feel produced, far too small to compete with the host.
        at: 1700,
        every: 420,
        until: 2900,
        run: ({ stage, power }, iteration) => {
          stage.burst({
            x: stage.camera.halfWidth * (iteration % 2 === 0 ? -0.5 : 0.5),
            y: -stage.camera.halfHeight * 0.45,
            z: 1800,
            shape: "crackle",
            count: Math.round(70 * power),
            power: 460,
            flashRadius: 44,
            life: 1.7,
            fragment: false,
          });
        },
      },
      {
        at: 1700,
        every: 200,
        until: 3000,
        run: ({ stage, power }) => {
          stage.emitStreaks(Math.round(3 * power));
          stage.emitEmbers(Math.round(5 * power));
        },
      },
      { at: 2000, run: ({ stage, power }) => stage.emitConfetti(Math.round(16 * power)) },
      { at: 2600, run: ({ stage }) => stage.godraySweep({ life: 2.2, peak: 0.1, tilt: 0.45 }) },
      ...settle(3000, 4400, { shells: false }),
    ],
  },
};

export function getPreset(id: CinematicEffectId): EffectPreset {
  return PRESETS[id] ?? PRESETS["grand-celebration"];
}

export function listPresets(): EffectPreset[] {
  return Object.values(PRESETS);
}

/**
 * Runs a preset's cues against a stage.
 *
 * Cues are kept sorted and consumed in order, and repeating cues carry
 * their own next-fire clock. A client that joins late starts the clock
 * part-way through: cues already in the past are dropped rather than
 * replayed, so a viewer arriving during the finish sees the finish.
 */
export class Choreographer {
  private readonly schedule: Array<{ cue: Cue; nextAt: number; iteration: number }>;
  private elapsed: number;

  constructor(
    private readonly preset: EffectPreset,
    private readonly ctx: CueContext,
    startOffsetMs = 0,
  ) {
    this.elapsed = startOffsetMs;
    this.schedule = preset.cues
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((cue) => ({ cue, nextAt: cue.at, iteration: 0 }));
  }

  /** True while the timeline still has cues or tail time left. */
  advance(dtMs: number): boolean {
    this.elapsed += dtMs;

    for (const entry of this.schedule) {
      const { cue } = entry;
      const last = cue.every ? (cue.until ?? cue.at) : cue.at;

      while (entry.nextAt <= this.elapsed && entry.nextAt <= last) {
        // Only fire cues we did not skip past on a late join.
        if (entry.nextAt >= this.elapsed - dtMs) {
          cue.run(this.ctx, entry.iteration);
        }
        entry.iteration += 1;
        if (!cue.every) {
          entry.nextAt = Number.POSITIVE_INFINITY;
          break;
        }
        entry.nextAt += cue.every;
      }
    }

    return this.elapsed < this.preset.durationMs + this.preset.tailMs;
  }
}
