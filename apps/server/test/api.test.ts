import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { GameStreamEvent } from "@chessy/shared";
import { buildApp } from "../src/app.ts";
import { ChessComClient } from "../src/chesscom/client.ts";
import type { Engine } from "../src/ai/stockfish.ts";

/** Deterministische Test-Engine: spielt immer den ersten legalen Zug. */
const fakeEngine: Engine = {
  async bestMove(req) {
    const { Chess } = await import("chess.js");
    const c = new Chess(req.initialFen);
    for (const m of req.moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    const m = c.moves({ verbose: true })[0]!;
    return m.from + m.to + (m.promotion ?? "");
  },
  async analyse(fen) {
    return { fen, depth: 1, bestmove: "e2e4", eval: { cp: 20 }, pv: ["e2e4"] };
  },
  close() {},
};

const fakeChessCom = new ChessComClient(async (url) => {
  const u = String(url);
  if (u.endsWith("/player/hikaru")) return new Response(JSON.stringify({ username: "hikaru", title: "GM" }), { status: 200 });
  return new Response("{}", { status: 404 });
});

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildApp({ engine: fakeEngine, chessCom: fakeChessCom, webDist: null, keepAliveMs: 50 }));
});
afterEach(async () => {
  await app.close();
});

async function guest(name: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/guest", payload: { username: name } });
  expect(r.statusCode).toBe(201);
  return r.json().token as string;
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (url: string, token: string, payload?: object) => app.inject({ method: "POST", url: `/api/v1${url}`, headers: authed(token), payload });

describe("API", () => {
  it("verlangt ein Token", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/games", payload: { opponent: { type: "ai" }, time_control: "300+0" } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("unauthorized");
  });

  it("Partie gegen Computer: KI antwortet auf den ersten Zug", async () => {
    const t = await guest("Alice");
    const g = (await post("/games", t, { opponent: { type: "ai", level: 2 }, time_control: "180+2", color: "white" })).json();
    expect(g.time_class).toBe("blitz");
    expect(g.black.kind).toBe("ai");
    expect((await post(`/games/${g.id}/move/e2e4`, t)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    const after = (await app.inject({ method: "GET", url: `/api/v1/games/${g.id}` })).json();
    expect(after.moves.split(" ")).toHaveLength(2);
    expect(after.clock.running).toBe(true);
  });

  it("Einladung: zwei Spieler spielen eine Partie bis zur Aufgabe", async () => {
    const a = await guest("Anna");
    const b = await guest("Bernd");
    const g = (await post("/games", a, { opponent: { type: "friend" }, time_control: "600+5", color: "white" })).json();
    expect(g.status).toBe("waiting");
    const joined = (await post(`/games/${g.id}/join`, b)).json();
    expect(joined.status).toBe("started");
    expect(joined.black.username).toBe("Bernd");

    const wrong = await post(`/games/${g.id}/move/e7e5`, b);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error).toBe("not_your_turn");
    expect((await post(`/games/${g.id}/move/e2e5`, a)).statusCode).toBe(400);

    await post(`/games/${g.id}/move/e2e4`, a);
    await post(`/games/${g.id}/move/e5`, b); // SAN
    const res = (await post(`/games/${g.id}/resign`, b)).json();
    expect(res.result).toBe("1-0");
    expect(res.black.result).toBe("resigned");

    const pgn = await app.inject({ method: "GET", url: `/api/v1/games/${g.id}/pgn` });
    expect(pgn.headers["content-type"]).toContain("application/x-chess-pgn");
    expect(pgn.body).toContain("1. e4 e5");
  });

  it("Remis per Angebot und Annahme, Zugrücknahme", async () => {
    const a = await guest("Carla");
    const b = await guest("Dirk");
    const g = (await post("/games", a, { opponent: { type: "friend" }, time_control: "-", color: "white" })).json();
    await post(`/games/${g.id}/join`, b);
    await post(`/games/${g.id}/move/d2d4`, a);
    expect((await post(`/games/${g.id}/takeback/offer`, a)).json().takeback_offer).toBe("white");
    expect((await post(`/games/${g.id}/takeback/accept`, b)).json().moves).toBe("");
    await post(`/games/${g.id}/move/e2e4`, a);
    expect((await post(`/games/${g.id}/draw/offer`, b)).json().draw_offer).toBe("black");
    const drawn = (await post(`/games/${g.id}/draw/accept`, a)).json();
    expect(drawn.result).toBe("1/2-1/2");
    expect(drawn.termination).toBe("agreement");
  });

  it("Lobby paart passende Gesuche", async () => {
    const a = await guest("Emil");
    const b = await guest("Frida");
    const s = (await post("/seeks", a, { time_control: "300+3" })).json();
    expect(s.seek.time_class).toBe("blitz");
    expect((await app.inject({ method: "GET", url: "/api/v1/seeks" })).json()).toHaveLength(1);
    const m = (await post("/seeks", b, { time_control: { type: "realtime", initial: 300, increment: 3 } })).json();
    expect(m.game.status).toBe("started");
    expect((await app.inject({ method: "GET", url: "/api/v1/seeks" })).json()).toHaveLength(0);
  });

  it("lokale Partie: ein Account steuert beide Seiten", async () => {
    const a = await guest("Gerd");
    const g = (await post("/games", a, { opponent: { type: "local" }, time_control: "60+0" })).json();
    for (const m of ["f2f3", "e7e5", "g2g4", "d8h4"]) expect((await post(`/games/${g.id}/move/${m}`, a)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/games/${g.id}` })).json().termination).toBe("checkmate");
  });

  it("importiert PGN", async () => {
    const a = await guest("Hanna");
    const pgn =
      '[Event "Live Chess"]\n[Site "Chess.com"]\n[White "hikaru"]\n[Black "magnus"]\n[Result "1-0"]\n[TimeControl "180+2"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
    const g = (await post("/games/import", a, { pgn })).json();
    expect(g.source).toBe("import");
    expect(g.white.username).toBe("hikaru");
    expect(g.san).toHaveLength(7);
    expect(g.result).toBe("1-0");
  });

  it("chess.com-Proxy", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/chesscom/player/hikaru" })).json().title).toBe("GM");
    expect((await app.inject({ method: "GET", url: "/api/v1/chesscom/player/unknown_x" })).statusCode).toBe(404);
  });

  it("OpenAPI-Spezifikation enthält die Spiel-Endpunkte", async () => {
    const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/api/v1/games/{id}/move/{move}");
    expect(Object.keys(spec.paths)).toContain("/api/v1/games/{id}/stream");
  });

  it("NDJSON-Stream liefert gameFull und gameState", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api/v1`;
    const a = await guest("Ida");
    const g = (await post("/games", a, { opponent: { type: "local" }, time_control: "-" })).json();

    const ctrl = new AbortController();
    const res = await fetch(`${base}/games/${g.id}/stream`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const reader = res.body!.getReader();
    const events: GameStreamEvent[] = [];
    let buf = "";
    const readUntil = async (n: number) => {
      while (events.length < n) {
        const { value } = await reader.read();
        buf += new TextDecoder().decode(value);
        const parts = buf.split("\n");
        buf = parts.pop()!;
        for (const p of parts) if (p.trim()) events.push(JSON.parse(p));
      }
    };
    await readUntil(1);
    expect(events[0]!.type).toBe("gameFull");
    await fetch(`${base}/games/${g.id}/move/e2e4`, { method: "POST", headers: authed(a) });
    await readUntil(2);
    expect(events[1]).toMatchObject({ type: "gameState", moves: "e2e4", last_san: "e4" });
    ctrl.abort();
  });
});
