import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Puzzle } from "@chessy/puzzles";
import { buildApp } from "../src/app.ts";
import { hashPassword, verifyPassword } from "../src/auth.ts";
import type { Engine } from "../src/ai/stockfish.ts";

const engine: Engine = {
  bestMove: async () => "e7e5",
  analyse: async (fen) => ({ fen, depth: 1, bestmove: null, eval: { cp: 0 }, pv: [] }),
  analyseMulti: async () => ({ lines: [], bestByDepth: [] }),
  close() {},
};
const puzzles: Puzzle[] = [
  { id: "backrank", fen: "3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30", moves: ["a1a7", "d8d1"], rating: 1200, themes: ["mate"], source: "test" },
];

let app: FastifyInstance;
beforeEach(async () => {
  ({ app } = await buildApp({ engine, webDist: null, puzzles, miner: engine, keepAliveMs: 50 }));
});
afterEach(() => app.close());

const call = (method: "GET" | "POST", url: string, token?: string, payload?: object, ip = "10.0.0.1") =>
  app.inject({ method, url: `/api/v1${url}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload, remoteAddress: ip });
const guest = async () => (await call("POST", "/auth/guest", undefined, {})).json().token as string;

describe("Passwort-Hashing", () => {
  it("speichert nur scrypt-Hashes mit Salz und prüft zeitkonstant", async () => {
    const a = await hashPassword("geheim123");
    const b = await hashPassword("geheim123");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("geheim123");
    expect(await verifyPassword("geheim123", a)).toBe(true);
    expect(await verifyPassword("geheim124", a)).toBe(false);
    expect(await verifyPassword("geheim123", "kaputt")).toBe(false);
  });
});

describe("Optionales Login", () => {
  it("Gast sichert sein Konto: Partien und Puzzle-Fortschritt bleiben, Name wird übernommen", async () => {
    const g = await guest();
    const me = (await call("GET", "/account", g)).json();
    expect(me.kind).toBe("guest");
    const game = (await call("POST", "/games", g, { opponent: { type: "ai", level: 1 }, time_control: "-", color: "white" })).json();
    await call("POST", `/games/${game.id}/resign`, g);
    const p = (await call("GET", "/puzzles/next", g)).json();
    const solved = (await call("POST", `/puzzles/${p.id}/check`, g, { moves: ["d8d1"] })).json();
    expect(solved.status).toBe("solved");

    const reg = await call("POST", "/auth/register", g, { username: "Magnus_Fan", password: "sicheres-pw-1" });
    expect(reg.statusCode).toBe(201);
    const { account, token } = reg.json();
    expect(account).toMatchObject({ id: me.id, username: "Magnus_Fan", kind: "user" });
    expect(token).not.toBe(g);

    // Altes Gast-Token gilt nicht mehr, das neue schon.
    expect((await call("GET", "/account", g)).statusCode).toBe(401);
    expect((await call("GET", "/account", token)).json().username).toBe("Magnus_Fan");
    // Fortschritt ist noch da – und die alte Partie trägt den neuen Namen.
    const games = (await call("GET", "/games", token)).json();
    expect(games).toHaveLength(1);
    expect(games[0].white.username).toBe("Magnus_Fan");
    expect(games[0].pgn).toContain('[White "Magnus_Fan"]');
    const stats = (await call("GET", "/puzzles/stats", token)).json();
    expect(stats).toMatchObject({ attempts: 1, wins: 1 });
    expect(stats.rating).toBe(solved.rating.after);
  });

  it("Anmelden auf einem zweiten Gerät sieht dasselbe Konto; Abmelden betrifft nur dieses Gerät", async () => {
    const { token: a } = (await call("POST", "/auth/register", undefined, { username: "Zweigeraet", password: "passwort-123" })).json();
    const login = await call("POST", "/auth/login", undefined, { username: "zweigeraet", password: "passwort-123" });
    expect(login.statusCode).toBe(200);
    const b = login.json().token;
    expect(b).not.toBe(a);
    expect((await call("GET", "/account", b)).json().username).toBe("Zweigeraet");

    expect((await call("POST", "/auth/logout", b, {})).json()).toEqual({ ended: 1 });
    expect((await call("GET", "/account", b)).statusCode).toBe(401);
    expect((await call("GET", "/account", a)).statusCode).toBe(200);

    const c = (await call("POST", "/auth/login", undefined, { username: "Zweigeraet", password: "passwort-123" })).json().token;
    expect((await call("POST", "/auth/logout", c, { everywhere: true })).json()).toEqual({ ended: 2 });
    expect((await call("GET", "/account", a)).statusCode).toBe(401);
    expect((await call("GET", "/account", c)).statusCode).toBe(401);
  });

  it("falsche Daten: einheitliche Meldung, nach 10 Fehlversuchen kurze Sperre", async () => {
    await call("POST", "/auth/register", undefined, { username: "Anna", password: "richtig-123" });
    const wrong = await call("POST", "/auth/login", undefined, { username: "Anna", password: "falsch-123" });
    const unknown = await call("POST", "/auth/login", undefined, { username: "Niemand", password: "falsch-123" });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);

    for (let i = 0; i < 9; i++) await call("POST", "/auth/login", undefined, { username: "Anna", password: `falsch-${i}` });
    const blocked = await call("POST", "/auth/login", undefined, { username: "Anna", password: "richtig-123" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().message).toMatch(/Minuten?/);
    // Andere IP ist nicht betroffen
    expect((await call("POST", "/auth/login", undefined, { username: "Anna", password: "richtig-123" }, "10.0.0.2")).statusCode).toBe(200);
  });

  it("prüft Benutzernamen und Passwörter", async () => {
    const reg = (username: string, password = "langes-passwort") => call("POST", "/auth/register", undefined, { username, password });
    await reg("Belegt");
    expect((await reg("belegt")).json().error).toBe("username_taken");
    expect((await reg("ab")).json().error).toBe("invalid_username");
    expect((await reg("mit leerzeichen")).json().error).toBe("invalid_username");
    expect((await reg("Gast-1234")).json().error).toBe("invalid_username");
    expect((await reg("System")).json().error).toBe("invalid_username");
    expect((await reg("Kurzpasswort", "1234567")).json().error).toBe("weak_password");
    expect((await reg("Jürgen_42")).statusCode).toBe(201);
  });

  it("nur Gäste können ein Konto anlegen; Gäste können sich nicht abmelden", async () => {
    const { token } = (await call("POST", "/auth/register", undefined, { username: "Schon_da", password: "passwort-123" })).json();
    expect((await call("POST", "/auth/register", token, { username: "Noch_mal", password: "passwort-123" })).json().error).toBe("already_registered");
    const bot = (await call("POST", "/auth/bot", undefined, {})).json().token;
    expect((await call("POST", "/auth/register", bot, { username: "Botkonto", password: "passwort-123" })).statusCode).toBe(403);
    expect((await call("POST", "/auth/logout", await guest(), {})).json().error).toBe("not_logged_in");
    expect((await call("POST", "/auth/register", "chy_ungueltig", { username: "Egal_1", password: "passwort-123" })).statusCode).toBe(401);
  });

  it("Passwort ändern beendet die anderen Sitzungen", async () => {
    const { token: a } = (await call("POST", "/auth/register", undefined, { username: "Wechsel", password: "altes-pw-123" })).json();
    const b = (await call("POST", "/auth/login", undefined, { username: "Wechsel", password: "altes-pw-123" })).json().token;
    expect((await call("POST", "/auth/password", a, { old_password: "falsch", new_password: "neues-pw-123" })).json().error).toBe("wrong_password");
    expect((await call("POST", "/auth/password", a, { old_password: "altes-pw-123", new_password: "kurz" })).json().error).toBe("weak_password");
    expect((await call("POST", "/auth/password", a, { old_password: "altes-pw-123", new_password: "neues-pw-123" })).json()).toEqual({ ended: 1 });
    expect((await call("GET", "/account", a)).statusCode).toBe(200);
    expect((await call("GET", "/account", b)).statusCode).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { username: "Wechsel", password: "altes-pw-123" })).statusCode).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { username: "Wechsel", password: "neues-pw-123" })).statusCode).toBe(200);
  });

  it("WebSocket und Streams akzeptieren Sitzungs-Tokens", async () => {
    const { token } = (await call("POST", "/auth/register", undefined, { username: "Streamer", password: "passwort-123" })).json();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/stream/events?token=${token}`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    ctrl.abort();
  });
});
