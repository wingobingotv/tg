/**
 * Shared vocabulary for the Lucky Number reveal.
 *
 * The wire format carries the *number and nothing else that matters* —
 * no geometry, no frames, no rendered content. Every viewer builds the
 * whole reveal locally from this, exactly as the Cinematic FX engine
 * does, so the LiveKit audio/video tracks are never touched.
 */

/** Lottery numbers are short by nature; this is a sanity bound. */
export const LUCKY_NUMBER_MAX_DIGITS = 3;

export interface LuckyNumberEvent {
  type: "lucky-number";
  /**
   * Kept as a string rather than a number so an operator can send "07"
   * and have the leading zero survive — broadcast graphics care about
   * that and `Number("07")` does not.
   */
  number: string;
  /** Caption above the numeral. Defaults to a neutral label. */
  label?: string;
  /** Seeds the deterministic particle show, so every viewer matches. */
  seed?: number;
  /**
   * Wall-clock ms of when the reveal was triggered. A viewer who joins
   * mid-sequence jumps to where it actually is instead of replaying the
   * build-up, and one who joins near the end skips it entirely.
   */
  startAt?: number;
  /**
   * Idempotency key. The data channel is reliable but not
   * exactly-once — reconnects and multi-room fan-out can both deliver
   * the same command twice, and a lucky number must never be revealed
   * twice.
   */
  commandId?: string;
  /** How long the number stays readable after locking in. Clamped. */
  holdMs?: number;
}

export function isLuckyNumberEvent(value: unknown): value is LuckyNumberEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LuckyNumberEvent>;
  if (candidate.type !== "lucky-number") return false;
  return normaliseLuckyNumber(candidate.number) !== null;
}

/**
 * Accepts what an upstream service might realistically send — a number,
 * a numeric string, a padded string — and returns the digits to display,
 * or null if there is nothing sensible to reveal.
 */
export function normaliseLuckyNumber(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const digits = String(Math.trunc(Math.abs(raw)));
    return digits.length <= LUCKY_NUMBER_MAX_DIGITS ? digits : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return trimmed;
}
