import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { THEMES, checkMoves, type Puzzle } from "../src/index.ts";
import data from "../data/puzzles.json" with { type: "json" };

const puzzles = data as Puzzle[];
const play = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** Prüft jedes ausgelieferte Puzzle: legal, eindeutige ID, Lösung endet mit eigenem Zug, gültige Themen und Ratings. */
describe(`Puzzle-Datei (${puzzles.length} Puzzles)`, () => {
  it("enthält Puzzles mit eindeutigen IDs und Stellungen", () => {
    expect(puzzles.length).toBeGreaterThan(0);
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
    expect(new Set(puzzles.map((p) => p.fen.split(" ").slice(0, 4).join(" ") + p.moves[0])).size).toBe(puzzles.length);
  });

  it("jedes Puzzle ist legal, endet mit einem Lösungszug und wird von checkMoves akzeptiert", () => {
    const valid = new Set<string>(THEMES);
    for (const p of puzzles) {
      const c = new Chess(p.fen);
      for (const m of p.moves) expect(() => play(c, m), `${p.id}: ${m}`).not.toThrow();
      expect(p.moves.length % 2, `${p.id}: Lösung muss mit eigenem Zug enden`).toBe(0);
      expect(p.rating).toBeGreaterThanOrEqual(400);
      expect(p.rating).toBeLessThanOrEqual(2800);
      for (const t of p.themes) expect(valid.has(t), `${p.id}: Thema ${t}`).toBe(true);
      if (p.themes.includes("mate")) expect(c.isCheckmate(), `${p.id}: Matt-Thema ohne Matt`).toBe(true);
      const solver = p.moves.filter((_, i) => i % 2 === 1);
      expect(checkMoves(p, solver)).toEqual({ status: "solved" });
      expect(p.features, `${p.id}: Merkmale gehören nicht in die ausgelieferte Datei`).toBeUndefined();
    }
  });
});
