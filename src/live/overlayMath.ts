import type { Board } from "./drawBoard"

/** Website `LotteryDrumOverlay` geometry and palette (half size). */
export const DRUM_BALL_COUNT = 47
const BOWL_WIDTH = 190
const BOWL_HEIGHT = 120

const BALL_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa", "#00acc1", "#d81b60", "#5e35b1"]

export function drumBallColor(n: number): string {
  return BALL_COLORS[n % BALL_COLORS.length] ?? "#e53935"
}

/** Air-blown motion in the bowl: each ball gets its own pattern from its index. */
export function drumPosition(index: number, time: number, speed: number): { x: number; y: number } {
  const width = BOWL_WIDTH - 60
  const height = BOWL_HEIGHT - 40
  const seed = index * 137.508
  const freqX = 1.2 + (index % 7) * 0.3
  const freqY = 1.5 + (index % 5) * 0.25
  const phaseY = seed * 1.618
  const x = Math.sin(time * freqX * speed + seed) * (width * 0.38) + Math.sin(time * freqX * 2.1 * speed + seed * 0.7) * (width * 0.08)
  const bounce =
    Math.abs(Math.sin(time * freqY * speed + phaseY)) * (height * 0.35) +
    Math.abs(Math.cos(time * freqY * 1.7 * speed + phaseY * 0.5)) * (height * 0.1)
  return { x, y: height * 0.15 + bounce - height * 0.25 }
}

/** Ticker scroll time: 15 s plus 0.1 s per character, at most 40 s (website `NewsAnnouncement`). */
export function newsScrollSeconds(text: string): number {
  return Math.min(Math.max(15 + text.length * 0.1, 15), 40)
}

const STRIP_MAX = 12

/** What the drawn-numbers strip shows: the latest twelve, lucky ball last. */
export function stripBalls(board: Board): Array<{ n: number; lucky: boolean }> {
  const balls = board.mains.map((n) => ({ n, lucky: false }))
  if (board.lucky != null) balls.push({ n: board.lucky, lucky: true })
  return balls.slice(-STRIP_MAX)
}
