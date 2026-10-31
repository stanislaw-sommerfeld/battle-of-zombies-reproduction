// Pure combat rules: damage resolution and status interactions.
// Kept free of entities/rendering so they can be unit tested and reused by any actor.
import type { Element, StatusId } from "../data/types.js";

export type Statuses = Partial<Record<StatusId, number>>; // remaining seconds

export const STATUS_DURATION: Record<StatusId, number> = {
  burning: 4,
  wet: 6,
  oiled: 10,
  chilled: 3,
  frozen: 1.8,
  inked: 4,
  stunned: 0.6,
};

export type StatusOutcome = "applied" | "fizzled" | "froze" | "flared" | "thawed" | "immune" | "refreshed";

/**
 * Applies a status following the elemental rules:
 * - fire on a wet target fizzles into steam and dries it
 * - fire on an oiled target flares: double duration, oil consumed
 * - fire thaws frozen / chilled targets
 * - water extinguishes burning
 * - cold on a wet target freezes it solid
 */
export function applyStatus(s: Statuses, id: StatusId, duration = STATUS_DURATION[id], immune: StatusId[] = []): StatusOutcome {
  if (immune.includes(id)) return "immune";
  switch (id) {
    case "burning":
      if (s.wet) {
        delete s.wet;
        return "fizzled";
      }
      if (s.frozen || s.chilled) {
        delete s.frozen;
        delete s.chilled;
        return "thawed";
      }
      if (s.oiled) {
        delete s.oiled;
        s.burning = Math.max(s.burning ?? 0, duration * 2);
        return "flared";
      }
      break;
    case "wet":
      delete s.burning;
      break;
    case "chilled":
      if (s.wet && !immune.includes("frozen")) {
        delete s.wet;
        delete s.chilled;
        s.frozen = STATUS_DURATION.frozen;
        return "froze";
      }
      delete s.burning;
      break;
    case "frozen":
      delete s.burning;
      break;
  }
  const had = (s[id] ?? 0) > 0;
  s[id] = Math.max(s[id] ?? 0, duration);
  return had ? "refreshed" : "applied";
}

export function tickStatuses(s: Statuses, dt: number): void {
  for (const k in s) {
    const id = k as StatusId;
    const v = (s[id] ?? 0) - dt;
    if (v <= 0) delete s[id];
    else s[id] = v;
  }
}

export interface DamageInput {
  base: number;
  element: Element;
  resist?: Partial<Record<Element, number>>;
  targetStatuses?: Statuses;
  /** Multiplier from perks, insights, edicts, fray, etc. */
  multiplier?: number;
  /** Heavy attacks shatter frozen targets. */
  heavy?: boolean;
  crit?: boolean;
}

export interface DamageResult {
  amount: number;
  shattered: boolean;
  crit: boolean;
}

export function computeDamage(d: DamageInput): DamageResult {
  let amount = d.base * (d.multiplier ?? 1);
  const resist = d.resist?.[d.element] ?? 0;
  amount *= 1 - resist;
  const st = d.targetStatuses;
  let shattered = false;
  if (st) {
    if (d.element === "fire" && st.oiled) amount *= 1.5;
    if (d.element === "physical" && st.frozen && d.heavy) {
      amount *= 2;
      shattered = true;
    }
    if (st.inked && d.element === "fire") amount *= 1.25;
  }
  if (d.crit) amount *= 1.75;
  return { amount: Math.max(0, Math.round(amount)), shattered, crit: !!d.crit };
}

/** Movement multiplier from statuses. */
export function statusSpeed(s: Statuses): number {
  if (s.frozen || s.stunned) return 0;
  let m = 1;
  if (s.chilled) m *= 0.6;
  if (s.inked) m *= 0.7;
  return m;
}
