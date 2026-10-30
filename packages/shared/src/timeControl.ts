/**
 * Zeitmodi. Die String-Form folgt der chess.com Public API:
 *   "180+2"   → 3 Minuten + 2 Sekunden Inkrement
 *   "1/86400" → Daily, 1 Tag pro Zug
 *   "-"       → unbegrenzt
 */
export type TimeControl =
  | { type: "realtime"; initial: number; increment: number } // Sekunden
  | { type: "daily"; daysPerMove: number }
  | { type: "unlimited" };

export type TimeClass = "bullet" | "blitz" | "rapid" | "classical" | "daily" | "unlimited";

export const DAY_SECONDS = 86_400;

/** Einordnung wie bei Lichess: geschätzte Dauer = Grundzeit + 40 × Inkrement. */
export function timeClassOf(tc: TimeControl): TimeClass {
  if (tc.type === "daily") return "daily";
  if (tc.type === "unlimited") return "unlimited";
  const estimate = tc.initial + 40 * tc.increment;
  if (estimate < 180) return "bullet";
  if (estimate < 480) return "blitz";
  if (estimate < 1500) return "rapid";
  return "classical";
}

export function formatTimeControl(tc: TimeControl): string {
  if (tc.type === "daily") return `1/${tc.daysPerMove * DAY_SECONDS}`;
  if (tc.type === "unlimited") return "-";
  return `${tc.initial}+${tc.increment}`;
}

export function parseTimeControl(input: string | TimeControl): TimeControl {
  if (typeof input !== "string") return validateTimeControl(input);
  const s = input.trim();
  if (s === "-" || s === "unlimited") return { type: "unlimited" };
  const daily = /^1\/(\d+)$/.exec(s);
  if (daily) return validateTimeControl({ type: "daily", daysPerMove: Number(daily[1]) / DAY_SECONDS });
  const rt = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (rt) return validateTimeControl({ type: "realtime", initial: Number(rt[1]), increment: Number(rt[2] ?? 0) });
  throw new Error(`Ungültiger Zeitmodus: ${input}`);
}

function validateTimeControl(tc: TimeControl): TimeControl {
  if (tc.type === "realtime") {
    if (!Number.isInteger(tc.initial) || tc.initial < 15 || tc.initial > 3 * 3600)
      throw new Error("Grundzeit muss zwischen 15 s und 3 h liegen");
    if (!Number.isInteger(tc.increment) || tc.increment < 0 || tc.increment > 180)
      throw new Error("Inkrement muss zwischen 0 und 180 s liegen");
  } else if (tc.type === "daily") {
    if (![1, 2, 3, 5, 7, 14].includes(tc.daysPerMove)) throw new Error("Daily erlaubt 1, 2, 3, 5, 7 oder 14 Tage pro Zug");
  } else if (tc.type !== "unlimited") {
    throw new Error("Unbekannter Zeitmodus");
  }
  return tc;
}

/** Menschlich lesbar, z. B. "3 + 2", "Daily · 3 Tage", "∞". */
export function describeTimeControl(tc: TimeControl): string {
  if (tc.type === "daily") return `Daily · ${tc.daysPerMove} ${tc.daysPerMove === 1 ? "Tag" : "Tage"}`;
  if (tc.type === "unlimited") return "Unbegrenzt";
  const min = tc.initial >= 60 ? `${+(tc.initial / 60).toFixed(2)}` : `${tc.initial}s`;
  return `${min} + ${tc.increment}`;
}

export interface TimeControlPreset {
  id: string;
  label: string;
  timeControl: TimeControl;
}

const rt = (initial: number, increment: number): TimeControl => ({ type: "realtime", initial, increment });

export const TIME_CONTROL_PRESETS: Record<Exclude<TimeClass, "unlimited">, TimeControlPreset[]> & {
  unlimited: TimeControlPreset[];
} = {
  bullet: [
    { id: "60+0", label: "1 min", timeControl: rt(60, 0) },
    { id: "60+1", label: "1 | 1", timeControl: rt(60, 1) },
    { id: "120+1", label: "2 | 1", timeControl: rt(120, 1) },
  ],
  blitz: [
    { id: "180+0", label: "3 min", timeControl: rt(180, 0) },
    { id: "180+2", label: "3 | 2", timeControl: rt(180, 2) },
    { id: "300+0", label: "5 min", timeControl: rt(300, 0) },
    { id: "300+3", label: "5 | 3", timeControl: rt(300, 3) },
  ],
  rapid: [
    { id: "600+0", label: "10 min", timeControl: rt(600, 0) },
    { id: "600+5", label: "10 | 5", timeControl: rt(600, 5) },
    { id: "900+10", label: "15 | 10", timeControl: rt(900, 10) },
  ],
  classical: [
    { id: "1800+0", label: "30 min", timeControl: rt(1800, 0) },
    { id: "1800+20", label: "30 | 20", timeControl: rt(1800, 20) },
  ],
  daily: [
    { id: "1/86400", label: "1 Tag", timeControl: { type: "daily", daysPerMove: 1 } },
    { id: "1/259200", label: "3 Tage", timeControl: { type: "daily", daysPerMove: 3 } },
    { id: "1/604800", label: "7 Tage", timeControl: { type: "daily", daysPerMove: 7 } },
  ],
  unlimited: [{ id: "-", label: "∞", timeControl: { type: "unlimited" } }],
};
