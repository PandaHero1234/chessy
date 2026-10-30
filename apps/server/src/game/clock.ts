import type { Color, ClockSnapshot, TimeControl } from "@chessy/shared";
import { DAY_SECONDS } from "@chessy/shared";

/** Maximal gutgeschriebene Netzwerkverzögerung pro Zug. */
export const MAX_LAG_COMPENSATION_MS = 300;

/**
 * Serverautoritative Schachuhr.
 * Realtime: Die Uhr läuft erst ab dem zweiten Zug von Weiß (wie Lichess), damit Partien abgebrochen werden können.
 * Daily: Jeder Zug hat eine feste Frist; die Restzeit wird nach jedem Zug zurückgesetzt.
 */
export class Clock {
  remaining: Record<Color, number>;
  turn: Color = "white";
  running = false;
  /** Zeitpunkt (ms), seit dem die Uhr von `turn` läuft. */
  turnStartedAt: number | null = null;
  readonly increment: number;
  readonly perMove: number | null;

  constructor(readonly tc: Exclude<TimeControl, { type: "unlimited" }>) {
    if (tc.type === "realtime") {
      this.remaining = { white: tc.initial * 1000, black: tc.initial * 1000 };
      this.increment = tc.increment * 1000;
      this.perMove = null;
    } else {
      this.perMove = tc.daysPerMove * DAY_SECONDS * 1000;
      this.remaining = { white: this.perMove, black: this.perMove };
      this.increment = 0;
    }
  }

  static restore(tc: Exclude<TimeControl, { type: "unlimited" }>, s: ClockSnapshot, turn: Color, now: number): Clock {
    const c = new Clock(tc);
    c.remaining = { white: s.white, black: s.black };
    c.turn = turn;
    c.running = s.running;
    // Nach einem Neustart läuft die Uhr ab jetzt weiter; Ausfallzeit wird keinem Spieler angerechnet.
    c.turnStartedAt = s.running ? now : null;
    return c;
  }

  timeLeft(color: Color, now: number): number {
    if (this.running && this.turnStartedAt !== null && color === this.turn) {
      return Math.max(0, this.remaining[color] - (now - this.turnStartedAt));
    }
    return this.remaining[color];
  }

  /** Startet die Uhr für die Seite am Zug. */
  start(now: number) {
    this.running = true;
    this.turnStartedAt = now;
  }

  stop(now: number) {
    if (this.running) this.remaining[this.turn] = this.timeLeft(this.turn, now);
    this.running = false;
    this.turnStartedAt = null;
  }

  /**
   * Zug wurde von `color` ausgeführt. `lagMs` ist die vom Client gemeldete Verzögerung.
   * Gibt `false` zurück, wenn die Zeit bereits abgelaufen war.
   */
  press(color: Color, now: number, lagMs = 0): boolean {
    if (this.running && this.turnStartedAt !== null) {
      const lag = Math.min(Math.max(lagMs, 0), MAX_LAG_COMPENSATION_MS);
      const used = Math.max(0, now - this.turnStartedAt - lag);
      const left = this.remaining[color] - used;
      if (left <= 0) {
        this.remaining[color] = 0;
        return false;
      }
      this.remaining[color] = this.perMove ?? left + this.increment;
    } else if (this.perMove !== null) {
      this.remaining[color] = this.perMove;
    }
    this.turn = color === "white" ? "black" : "white";
    if (this.running) this.turnStartedAt = now;
    return true;
  }

  flagged(now: number): Color | null {
    if (!this.running) return null;
    return this.timeLeft(this.turn, now) <= 0 ? this.turn : null;
  }

  snapshot(now: number): ClockSnapshot {
    return {
      white: this.timeLeft("white", now),
      black: this.timeLeft("black", now),
      increment: this.increment,
      running: this.running,
      at: now,
      ...(this.perMove !== null ? { per_move: this.perMove } : {}),
    };
  }
}
