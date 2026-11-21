import { describe, expect, it } from "vitest";
import type { MultiPvResult, PvLine, SearchLimit } from "@chessy/shared";
import {
  MemoryPuzzleStore,
  PuzzleService,
  checkMoves,
  detectThemes,
  discoveryDepth,
  estimateRating,
  expectedScore,
  isUnique,
  puzzleId,
  solveFrom,
  toPublic,
  updateRatings,
  DEFAULT_MINING,
  type Analyzer,
  type Puzzle,
} from "../src/index.ts";

const line = (multipv: number, move: string, score: PvLine["score"], depth = 10): PvLine => ({ multipv, move, pv: [move], score, depth });

// Weiß verlässt mit Ta1-a7?? die Grundreihe, Schwarz setzt mit Td8-d1 matt.
const BACK_RANK: Puzzle = {
  id: "backrank",
  fen: "3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30",
  moves: ["a1a7", "d8d1"],
  rating: 800,
  themes: [],
  source: "test",
};

describe("checkMoves", () => {
  const p: Puzzle = {
    id: "fork",
    // Schwarz zieht ...Dd8-d5?? und Weiß gewinnt mit Sc3xd5 die Dame (Lösung: 1 Zug).
    fen: "r1bqk2r/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 b kq - 0 10",
    moves: ["d8d5", "c3d5"],
    rating: 900,
    themes: [],
    source: "test",
  };

  it("erkennt richtige und falsche Lösungszüge", () => {
    expect(checkMoves(p, ["c3d5"])).toEqual({ status: "solved" });
    expect(checkMoves(p, ["d1d5"])).toEqual({ status: "wrong", expected_index: 0 });
  });

  it("liefert die Antwort des Gegners bei mehrzügigen Lösungen", () => {
    const long: Puzzle = { ...p, moves: ["a1b1", "a2a3", "b1a1", "a3a4"] };
    // Unsinniges, aber legales Beispiel: zwei Lösungszüge mit einer Antwort dazwischen
    const fen = "4k3/8/8/8/8/8/P7/R3K3 w - - 0 1";
    const two: Puzzle = { ...long, fen, moves: ["a1b1", "e8d8", "a2a3", "d8e8", "a3a4"] };
    const lp: Puzzle = { ...two, fen: "4k3/8/8/8/8/8/P7/R3K3 b - - 0 1", moves: ["e8d8", "a2a3", "d8e8", "a3a4"] };
    expect(checkMoves(lp, ["a2a3"])).toEqual({ status: "correct", reply: "d8e8", next_index: 1 });
    expect(checkMoves(lp, ["a2a3", "a3a4"])).toEqual({ status: "solved" });
  });

  it("akzeptiert im letzten Zug jedes Matt", () => {
    // Zwei Matts möglich: Dd8# und Td8#
    const p2: Puzzle = { id: "m", fen: "6k1/5ppp/8/8/8/8/1Q3PPP/3R2K1 b - - 0 1", moves: ["g8h8", "d1d8"], rating: 600, themes: [], source: "t" };
    expect(checkMoves(p2, ["d1d8"]).status).toBe("solved");
    expect(checkMoves(p2, ["b2b8"]).status).toBe("solved");
    expect(checkMoves(p2, ["b2b7"]).status).toBe("wrong");
  });

  it("öffentliche Ansicht verrät die Lösung nicht", () => {
    const pub = toPublic(p);
    expect(pub).toMatchObject({ id: "fork", initial_move: "d8d5", color: "white", solver_moves: 1 });
    expect(JSON.stringify(pub)).not.toContain("c3d5");
  });
});

describe("detectThemes", () => {
  it("Grundreihenmatt", () => {
    const { themes } = detectThemes(BACK_RANK.fen, BACK_RANK.moves, { mate: 1 });
    expect(themes).toContain("mate");
    expect(themes).toContain("mateIn1");
    expect(themes).toContain("backRankMate");
    expect(themes).toContain("endgame");
  });

  it("Ersticktes Matt", () => {
    // Schwarz: Kh8, Tg8, Bauern g7 h7 – nach ...a6?? folgt Sf7#.
    const { themes } = detectThemes("6rk/p5pp/8/6N1/8/8/8/K7 b - - 0 40", ["a7a6", "g5f7"], { mate: 1 });
    expect(themes).toContain("smotheredMate");
    expect(themes).not.toContain("backRankMate");
  });

  it("Springergabel auf König und Dame", () => {
    // Nach ...h6?? gabelt Sc7+ König e8 und Dame a8, danach Sxa8.
    const fen = "q3k3/7p/8/3N4/8/8/8/4K3 b - - 0 30";
    const { themes } = detectThemes(fen, ["h7h6", "d5c7", "e8e7", "c7a8"], { cp: 900 });
    expect(themes).toContain("fork");
  });

  it("Unterverwandlung", () => {
    const fen = "8/2P5/8/8/8/8/k7/4K3 b - - 0 50";
    const { themes } = detectThemes(fen, ["a2b2", "c7c8n"], { cp: 300 });
    expect(themes).toContain("promotion");
    expect(themes).toContain("underPromotion");
  });
});

describe("Schwierigkeit & Rating", () => {
  const base = {
    solverMoves: 1,
    mate: false,
    discoveryDepth: 2,
    firstMoveCheck: false,
    firstMoveCapture: true,
    firstMoveQuiet: false,
    sacrifices: 0,
    temptations: 2,
    gap: 1,
    underPromotion: false,
    hangingPiece: true,
    finalScore: { cp: 400 },
  };

  it("längere, stillere Lösungen sind schwerer", () => {
    const easy = estimateRating(base);
    const hard = estimateRating({ ...base, solverMoves: 4, discoveryDepth: 12, firstMoveCapture: false, firstMoveQuiet: true, sacrifices: 1, hangingPiece: false });
    expect(easy).toBeLessThan(800);
    expect(hard).toBeGreaterThan(2000);
    expect(hard).toBeLessThanOrEqual(2800);
  });

  it("Elo: Gewinn gegen schweres Puzzle bringt mehr", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
    const a = updateRatings({ rating: 1500, attempts: 50 }, { rating: 1900, plays: 50 }, true);
    const b = updateRatings({ rating: 1500, attempts: 50 }, { rating: 1100, plays: 50 }, true);
    expect(a.delta).toBeGreaterThan(b.delta);
    expect(a.puzzle).toBeLessThan(1900);
  });
});

describe("Eindeutigkeit & Mining", () => {
  it("isUnique", () => {
    expect(isUnique([line(1, "a", { cp: 600 }), line(2, "b", { cp: 50 })])).toBe(true);
    expect(isUnique([line(1, "a", { cp: 600 }), line(2, "b", { cp: 550 })])).toBe(false);
    expect(isUnique([line(1, "a", { cp: 120 }), line(2, "b", { cp: -300 })])).toBe(false);
    expect(isUnique([line(1, "a", { mate: 1 }), line(2, "b", { mate: 1 })])).toBe(true);
    expect(isUnique([line(1, "a", { mate: 2 }), line(2, "b", { mate: 3 })])).toBe(false);
    expect(isUnique([line(1, "a", { mate: 3 }), line(2, "b", { cp: 800 })])).toBe(true);
  });

  it("discoveryDepth", () => {
    const r: MultiPvResult = { lines: [], bestByDepth: [{ depth: 1, move: "x" }, { depth: 2, move: "a" }, { depth: 3, move: "x" }, { depth: 4, move: "x" }] };
    expect(discoveryDepth(r, "x")).toBe(3);
  });

  it("solveFrom baut ein Mattpuzzle mit einem Skript-Analysator", async () => {
    // Analysator, der für die Startstellung Td8# als einzigen Gewinnzug meldet
    const analyzer: Analyzer = {
      async analyseMulti(_fen: string, multipv: number, _limit: SearchLimit): Promise<MultiPvResult> {
        const lines = [line(1, "d8d1", { mate: 1 }), line(2, "g8f8", { cp: -50 })].slice(0, multipv);
        return { lines, bestByDepth: [{ depth: 1, move: "d8d1" }] };
      },
    };
    const p = await solveFrom(analyzer, BACK_RANK.fen, "a1a7", DEFAULT_MINING);
    expect(p).not.toBeNull();
    expect(p!.moves).toEqual(["a1a7", "d8d1"]);
    expect(p!.themes).toContain("backRankMate");
    expect(p!.id).toBe(puzzleId(BACK_RANK.fen, ["a1a7", "d8d1"]));
  });
});

describe("PuzzleService", () => {
  const puzzles: Puzzle[] = Array.from({ length: 30 }, (_, i) => ({ ...BACK_RANK, id: `p${i}`, rating: 600 + i * 70 }));

  it("adaptiv: wählt Puzzles nahe am eigenen Rating, aktualisiert Rating und Serie", () => {
    const s = new PuzzleService(puzzles, new MemoryPuzzleStore());
    const first = s.next("u1");
    expect(Math.abs(first.rating - 1200)).toBeLessThanOrEqual(260);
    const r = s.check("u1", first.id, ["d8d1"]);
    expect(r.status).toBe("solved");
    expect(r.rating!.delta).toBeGreaterThan(0);
    expect(r.solution).toEqual(["a1a7", "d8d1"]);
    expect(s.stats("u1")).toMatchObject({ attempts: 1, wins: 1, streak: 1 });
  });

  it("Fehlversuch zählt einmal, Lösung anzeigen zählt als verloren", () => {
    const s = new PuzzleService(puzzles, new MemoryPuzzleStore());
    const p = s.next("u2", { difficulty: "easy" });
    expect(p.rating).toBeGreaterThanOrEqual(1000);
    expect(p.rating).toBeLessThan(1400);
    const wrong = s.check("u2", p.id, ["d8d2"]);
    expect(wrong.status).toBe("wrong");
    expect(wrong.rating!.delta).toBeLessThan(0);
    // zweiter Versuch: gelöst, aber nicht mehr gewertet
    const again = s.check("u2", p.id, ["d8d1"]);
    expect(again.status).toBe("solved");
    expect(again.rating).toBeUndefined();
    expect(s.stats("u2")).toMatchObject({ attempts: 1, wins: 0, streak: 0 });

    const q = s.next("u2");
    expect(q.id).not.toBe(p.id);
    expect(s.solution("u2", q.id).rating!.delta).toBeLessThan(0);
  });

  it("mit Tipp gelöst verändert das Rating nicht", () => {
    const s = new PuzzleService(puzzles, new MemoryPuzzleStore());
    const p = s.next("u3");
    expect(s.hint("u3", p.id, 0)).toEqual({ square: "d8" });
    expect(s.check("u3", p.id, ["d8d1"]).rating!.delta).toBe(0);
  });

  it("Tagespuzzle ist für alle gleich, Sturm steigt im Rating", () => {
    const s = new PuzzleService(puzzles, new MemoryPuzzleStore(), () => Date.UTC(2026, 10, 21));
    expect(s.daily().id).toBe(new PuzzleService(puzzles, new MemoryPuzzleStore(), () => Date.UTC(2026, 10, 21)).daily().id);
    const storm = s.storm(20);
    expect(storm.length).toBe(20);
    expect(storm[0]!.rating).toBeLessThan(storm[19]!.rating);
    expect(s.stormResult("u", 12)).toEqual({ score: 12, best: 12, new_record: true });
    expect(s.stormResult("u", 5).new_record).toBe(false);
  });

  it("Filter ohne Treffer liefert eine verständliche Fehlermeldung", () => {
    const s = new PuzzleService(puzzles, new MemoryPuzzleStore());
    expect(() => s.next("u", { theme: "smotheredMate" })).toThrow(/Keine Puzzles/);
    expect(() => s.next("u", { mine: true })).toThrow(/deinen Partien/);
  });
});
