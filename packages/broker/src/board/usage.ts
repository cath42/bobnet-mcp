import { BoardError } from "./errors.ts";

// Usage's calendar (ADR 0014 §3): the days of a read in its time zone, and a run spread over the days
// it ran by wall time, so a three-day lead is three days of usage, not one spike on the day it ends.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A read's days, oldest first, `YYYY-MM-DD` in `tz`, and their edges: `edges[i]` starts `days[i]`, the last ends today. */
export interface Calendar {
  tz: string;
  days: string[];
  edges: number[];
}

/** The last `count` days to the one `now` falls in, in `tz`'s calendar. A zone Intl doesn't know is invalid. */
export function calendar(now: number, count: number, tz: string): Calendar {
  const fmt = zoneFormat(tz);
  const today = dayOf(now, fmt);
  const days = Array.from({ length: count }, (_, i) => addDays(today, i - count + 1));
  const edges = [...days, addDays(today, 1)].map((d) => dayStart(d, fmt));
  return { tz, days, edges };
}

export function zoneFormat(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new BoardError("invalid", `${tz} is not a time zone`);
  }
}

/** The wall clock in the zone at `t`, as if it were UTC. */
function wall(t: number, fmt: Intl.DateTimeFormat): number {
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p["year"]), Number(p["month"]) - 1, Number(p["day"]), Number(p["hour"]), Number(p["minute"]), Number(p["second"]));
}

function dayOf(t: number, fmt: Intl.DateTimeFormat): string {
  return new Date(wall(t, fmt)).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The instant a day starts in the zone: its midnight, taking the offset in force then (twice, across a shift). */
function dayStart(day: string, fmt: Intl.DateTimeFormat): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const at = guess - (wall(guess, fmt) - guess);
  return guess - (wall(at, fmt) - at);
}

/**
 * How much of a run is done by each edge, from 0 to 1, by wall time: a run's share of day i is
 * `cum[i + 1] - cum[i]`. A run of no length is all on the day it ended. Parts before the first edge
 * fall outside the read.
 */
export function cumulative(start: number, end: number, edges: number[]): number[] {
  if (end <= start) return edges.map((e) => (e > end ? 1 : 0));
  return edges.map((e) => Math.min(1, Math.max(0, (e - start) / (end - start))));
}

/** A whole count split by a run's shares, rounded so the days' parts add up to what falls in the read. */
export function apportion(total: number, cum: number[]): number[] {
  return cum.slice(1).map((c, i) => Math.round(total * c) - Math.round(total * cum[i]!));
}
