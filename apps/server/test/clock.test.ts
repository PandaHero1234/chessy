import { describe, expect, it } from "vitest";
import { Clock, MAX_LAG_COMPENSATION_MS } from "../src/game/clock.ts";

describe("Clock", () => {
  it("zieht verbrauchte Zeit ab und addiert Inkrement", () => {
    const c = new Clock({ type: "realtime", initial: 60, increment: 2 });
    c.start(0);
    expect(c.press("white", 5000)).toBe(true);
    expect(c.remaining.white).toBe(60_000 - 5000 + 2000);
    expect(c.turn).toBe("black");
    expect(c.timeLeft("black", 8000)).toBe(57_000);
  });

  it("begrenzt die Lag-Kompensation", () => {
    const c = new Clock({ type: "realtime", initial: 60, increment: 0 });
    c.start(0);
    c.press("white", 1000, 5000);
    expect(c.remaining.white).toBe(60_000 - (1000 - MAX_LAG_COMPENSATION_MS));
  });

  it("meldet Zeitüberschreitung", () => {
    const c = new Clock({ type: "realtime", initial: 15, increment: 0 });
    c.start(0);
    expect(c.flagged(14_999)).toBeNull();
    expect(c.flagged(15_000)).toBe("white");
    expect(c.press("white", 15_001)).toBe(false);
  });

  it("Daily setzt die Frist nach jedem Zug zurück", () => {
    const c = new Clock({ type: "daily", daysPerMove: 1 });
    c.start(0);
    c.press("white", 3_600_000);
    expect(c.remaining.white).toBe(86_400_000);
    expect(c.timeLeft("black", 3_600_000 + 1000)).toBe(86_399_000);
  });

  it("läuft vor dem Start nicht", () => {
    const c = new Clock({ type: "realtime", initial: 60, increment: 5 });
    c.press("white", 10_000);
    expect(c.remaining.white).toBe(60_000);
    expect(c.flagged(1e9)).toBeNull();
  });
});
