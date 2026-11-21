import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Puzzle } from "@chessy/puzzles";
import { buildApp } from "../src/app.ts";
import { StockfishPool } from "../src/ai/stockfish.ts";

const puzzles: Puzzle[] = [
  // Grundreihenmatt: nach Ta7?? folgt Td1#
  { id: "backrank", fen: "3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30", moves: ["a1a7", "d8d1"], rating: 900, themes: ["mate", "mateIn1", "backRankMate"], source: "test" },
  // Gabel: nach ...h6?? Sc7+ Ke7 Sxa8
  { id: "fork", fen: "q3k3/7p/8/3N4/8/8/8/4K3 b - - 0 30", moves: ["h7h6", "d5c7", "e8e7", "c7a8"], rating: 1250, themes: ["fork", "short"], source: "test" },
  { id: "hard", fen: "q3k3/7p/8/3N4/8/8/8/4K3 b - - 0 30", moves: ["h7h6", "d5c7", "e8e7", "c7a8"], rating: 2300, themes: ["fork"], source: "test" },
];

let app: FastifyInstance;
let token: string;
const auth = () => ({ authorization: `Bearer ${token}` });
const post = (url: string, payload?: object) => app.inject({ method: "POST", url: `/api/v1${url}`, headers: auth(), payload });
const get = (url: string) => app.inject({ method: "GET", url: `/api/v1${url}`, headers: auth() });

beforeAll(async () => {
  ({ app } = await buildApp({ webDist: null, puzzles, miner: new StockfishPool(1) }));
  token = (await app.inject({ method: "POST", url: "/api/v1/auth/guest", payload: {} })).json().token;
});
afterAll(() => app.close());

describe("Puzzle-API", () => {
  it("Katalog zählt Stufen und Themen", async () => {
    const c = (await app.inject({ method: "GET", url: "/api/v1/puzzles/catalog" })).json();
    expect(c.total).toBe(3);
    expect(c.difficulties).toMatchObject({ beginner: 1, easy: 1, master: 1 });
    expect(c.themes.fork).toBe(2);
    expect(c.levels.master.label).toBe("Meister");
  });

  it("next nach Stufe verrät keine Lösung; check wertet Rating", async () => {
    const p = (await get("/puzzles/next?difficulty=beginner")).json();
    expect(p).toMatchObject({ id: "backrank", initial_move: "a1a7", color: "black", solver_moves: 1 });
    expect(JSON.stringify(p)).not.toContain("d8d1");
    const r = (await post(`/puzzles/${p.id}/check`, { moves: ["d8d1"] })).json();
    expect(r.status).toBe("solved");
    expect(r.rating.delta).toBeGreaterThan(0);
    expect(r.themes).toContain("backRankMate");
  });

  it("mehrzügige Lösung mit Antwort, Fehler wird gewertet", async () => {
    const p = (await get("/puzzles/next?theme=fork&difficulty=easy")).json();
    expect(p.id).toBe("fork");
    expect((await post(`/puzzles/fork/check`, { moves: ["d5c7"] })).json()).toEqual({ status: "correct", reply: "e8e7", next_index: 1 });
    const wrong = (await post(`/puzzles/fork/check`, { moves: ["d5c7", "c7e6"] })).json();
    expect(wrong.status).toBe("wrong");
    expect(wrong.rating.delta).toBeLessThan(0);
    const bad = await post(`/puzzles/fork/check`, { moves: ["zz"] });
    expect(bad.statusCode).toBe(400);
  });

  it("Tipp, Lösung, Statistik, Tagespuzzle, Sturm", async () => {
    expect((await post("/puzzles/hard/hint", { solved: 0 })).json()).toEqual({ square: "d5" });
    const sol = (await post("/puzzles/hard/solution")).json();
    expect(sol.moves).toEqual(["h7h6", "d5c7", "e8e7", "c7a8"]);
    const stats = (await get("/puzzles/stats")).json();
    expect(stats).toMatchObject({ attempts: 3, wins: 1, puzzles_available: 3 });
    expect(stats.history).toHaveLength(3);
    expect(stats.themes.fork.attempts).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/v1/puzzles/daily" })).json().daily).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const storm = (await app.inject({ method: "GET", url: "/api/v1/puzzles/storm?count=5" })).json();
    expect(storm.length).toBeGreaterThan(0);
    expect(storm[0].moves.length).toBeGreaterThan(1);
    expect((await post("/puzzles/storm/result", { score: 7 })).json()).toEqual({ score: 7, best: 7, new_record: true });
    expect((await get("/puzzles/nope")).statusCode).toBe(404);
  });

  it("findet in einer eigenen Partie die verpasste Taktik (echter Stockfish)", async () => {
    // Lokale Partie: 1.e4 e5 2.Lc4 Sc6 3.Dh5 Sf6?? 4.Dxf7# – nach 3...Sf6 gibt es Matt in 1.
    const g = (await post("/games", { opponent: { type: "local" }, time_control: "-" })).json();
    for (const m of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) await post(`/games/${g.id}/move/${m}`);
    expect((await get("/puzzles/next?mine=true")).statusCode).toBe(404);
    const res = await post(`/puzzles/from-game/${g.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.found).toBeGreaterThanOrEqual(1);
    const mine = body.puzzles.find((p: { initial_move: string }) => p.initial_move === "g8f6");
    expect(mine).toBeTruthy();
    const next = (await get("/puzzles/next?mine=true")).json();
    expect(next.source).toBe(`game:${g.id}`);
    const solved = (await post(`/puzzles/${mine.id}/check`, { moves: ["h5f7"] })).json();
    expect(solved.status).toBe("solved");
  }, 60_000);

  it("OpenAPI enthält die Puzzle-Endpunkte", async () => {
    const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/api/v1/puzzles/next", "/api/v1/puzzles/{id}/check", "/api/v1/puzzles/from-game/{id}"]));
  });
});
