import { describe, expect, it } from "vitest";
import { Game, MoveRejected } from "../src/game/game.ts";

const players = () => ({
  white: { id: "w", username: "Weiß", kind: "human" as const },
  black: { id: "b", username: "Schwarz", kind: "human" as const },
});

const play = (g: Game, moves: string, t = 0) => moves.split(" ").forEach((m, i) => g.move(g.turn, m, t + i));

describe("Game", () => {
  it("erkennt Schachmatt (Narrenmatt) mit chess.com-Ergebniscodes", () => {
    const g = new Game("g", players(), { type: "unlimited" }, 0);
    play(g, "f2f3 e7e5 g2g4 d8h4");
    expect(g.status).toBe("ended");
    expect(g.termination).toBe("checkmate");
    expect(g.result).toBe("0-1");
    expect(g.players.white.result).toBe("checkmated");
    expect(g.players.black.result).toBe("win");
  });

  it("akzeptiert SAN und UCI inkl. Umwandlung", () => {
    const g = new Game("g", players(), { type: "unlimited" }, 0, "8/P6k/8/8/8/8/8/K7 w - - 0 1");
    g.move("white", "a7a8q", 0);
    expect(g.chess.fen().startsWith("Q7/7k")).toBe(true);
    g.move("black", "Kg6", 1);
    expect(g.uci).toEqual(["a7a8q", "h7g6"]);
  });

  it("lehnt Züge der falschen Seite und illegale Züge ab", () => {
    const g = new Game("g", players(), { type: "unlimited" }, 0);
    expect(() => g.move("black", "e7e5", 0)).toThrow(MoveRejected);
    expect(() => g.move("white", "e2e5", 0)).toThrow(/Ungültiger Zug/);
  });

  it("Zeitüberschreitung: Sieg mit Mattmaterial, sonst Remis", () => {
    // Schwarz (nur König) lässt die Zeit ablaufen, Weiß hat einen Turm → Sieg Weiß
    const g = new Game("g", players(), { type: "realtime", initial: 15, increment: 0 }, 0, "8/8/8/8/8/8/k7/4K2R b - - 0 1");
    g.move("black", "a2b2", 0);
    g.move("white", "h1h2", 1);
    expect(g.checkFlag(20_000)).toBe(true);
    expect(g.termination).toBe("timeout");
    expect(g.winner).toBe("white");

    // Weiß fällt, Schwarz hat nur noch den König → Remis
    const r = new Game("r", players(), { type: "realtime", initial: 15, increment: 0 }, 0, "8/8/8/8/8/8/k7/4K2R b - - 0 1");
    r.move("black", "a2b2", 0);
    r.move("white", "h1h3", 1);
    r.move("black", "b2c2", 2);
    expect(r.checkFlag(30_000)).toBe(true);
    expect(r.termination).toBe("timevsinsufficient");
    expect(r.result).toBe("1/2-1/2");
  });

  it("erzeugt PGN mit Headern", () => {
    const g = new Game("g", players(), { type: "realtime", initial: 180, increment: 2 }, Date.UTC(2026, 9, 30));
    play(g, "e2e4 e7e5 g1f3");
    const pgn = g.pgn("https://chessy.example");
    expect(pgn).toContain('[White "Weiß"]');
    expect(pgn).toContain('[TimeControl "180+2"]');
    expect(pgn).toContain('[Date "2026.10.30"]');
    expect(pgn).toContain("1. e4 e5 2. Nf3");
  });

  it("Zugrücknahme stellt Stellung wieder her", () => {
    const g = new Game("g", players(), { type: "unlimited" }, 0);
    play(g, "e2e4 e7e5");
    g.undo(2);
    expect(g.uci).toEqual([]);
    expect(g.turn).toBe("white");
  });
});
