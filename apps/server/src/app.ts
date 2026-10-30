import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { AccountEvent, GameStreamEvent } from "@chessy/shared";
import { ApiError, GameService } from "./game/service.ts";
import { Store, type StoredUser } from "./db/store.ts";
import { StockfishPool, type Engine } from "./ai/stockfish.ts";
import { ChessComClient } from "./chesscom/client.ts";
import { schemas, ref, errorResponses, timeControlInput } from "./routes/schemas.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: StoredUser;
  }
}

export interface AppOptions {
  dbPath?: string;
  engine?: Engine;
  chessCom?: ChessComClient;
  logger?: boolean;
  /** Pfad zum gebauten Web-Frontend (apps/web/dist); wird ausgeliefert, falls vorhanden. */
  webDist?: string | null;
  keepAliveMs?: number;
}

const API = "/api/v1";
const here = dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; service: GameService }> {
  const app = Fastify({ logger: opts.logger ?? false });
  const store = new Store(opts.dbPath ?? ":memory:");
  const engine = opts.engine ?? new StockfishPool();
  const service = new GameService(store, engine);
  const chessCom = opts.chessCom ?? new ChessComClient();
  const keepAliveMs = opts.keepAliveMs ?? 7000;

  for (const s of schemas) app.addSchema(s);

  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Chessy API",
        version: "1.0.0",
        description:
          "API-first Schachserver. Alle Clients (Web-UI, Bots, E-Boards) nutzen dieselbe API.\n\n" +
          "**Auth:** `POST /api/v1/auth/guest` liefert ein Token. Senden als `Authorization: Bearer <token>` " +
          "(Streams/WebSocket alternativ `?token=`).\n\n" +
          "**Streams:** `GET /games/{id}/stream` und `GET /stream/events` liefern NDJSON (ein JSON-Objekt pro Zeile, " +
          "leere Zeilen = Keep-alive) im Stil der Lichess Board API. `GET /ws` liefert dieselben Events per WebSocket.\n\n" +
          "**Datenformat:** Feldnamen wie in der chess.com Public API (`time_control`, `time_class`, `fen`, `pgn`, Ergebniscodes).",
      },
      tags: [
        { name: "account", description: "Accounts & Tokens" },
        { name: "games", description: "Partien erstellen und spielen" },
        { name: "lobby", description: "Matchmaking" },
        { name: "streams", description: "Echtzeit-Events" },
        { name: "analysis", description: "Engine-Analyse" },
        { name: "chesscom", description: "chess.com Public API (Proxy, nur lesend)" },
      ],
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearer: [] }],
    },
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => (json.$id as string) ?? `def-${i}` },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err.validation) return reply.code(400).send({ error: "invalid_request", message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: "bad_request", message: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Interner Fehler" });
  });

  const tokenOf = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) return h.slice(7).trim();
    return (req.query as Record<string, string> | undefined)?.token;
  };
  const auth = async (req: FastifyRequest) => {
    const user = service.authenticate(tokenOf(req));
    if (!user) throw new ApiError(401, "unauthorized", "Gültiges Token erforderlich (POST /api/v1/auth/guest)");
    req.user = user;
  };
  const idParam = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
  const account = (u: StoredUser) => ({ id: u.id, username: u.username, kind: u.kind, created_at: u.created_at });

  // ------------------------------------------------------------ Account
  app.post(
    `${API}/auth/:kind`,
    {
      schema: {
        tags: ["account"],
        summary: "Account anlegen (guest, bot oder board) und Token erhalten",
        security: [],
        params: { type: "object", properties: { kind: { type: "string", enum: ["guest", "bot", "board"] } }, required: ["kind"] },
        body: { type: ["object", "null"], properties: { username: { type: "string", minLength: 3, maxLength: 20 } } },
        response: {
          201: { type: "object", properties: { account: ref("Account"), token: { type: "string" } }, required: ["account", "token"] },
          ...errorResponses,
        },
      },
    },
    async (req, reply) => {
      const { kind } = req.params as { kind: StoredUser["kind"] };
      const user = service.createAccount(kind, (req.body as { username?: string } | null)?.username);
      return reply.code(201).send({ account: account(user), token: user.token });
    },
  );

  app.get(
    `${API}/account`,
    { preHandler: auth, schema: { tags: ["account"], summary: "Eigener Account", response: { 200: ref("Account"), ...errorResponses } } },
    async (req) => account(req.user),
  );

  // ------------------------------------------------------------ Partien
  app.post(
    `${API}/games`,
    {
      preHandler: auth,
      schema: {
        tags: ["games"],
        summary: "Partie erstellen: gegen Computer, lokal (beide Seiten an einem Gerät) oder per Einladungslink",
        body: {
          type: "object",
          properties: {
            opponent: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["ai", "local", "friend"] },
                level: { type: "integer", minimum: 1, maximum: 8 },
              },
              required: ["type"],
            },
            time_control: timeControlInput,
            color: { type: "string", enum: ["white", "black", "random"] },
            fen: { type: "string", description: "Optionale Startstellung" },
          },
          required: ["opponent", "time_control"],
        },
        response: { 201: ref("Game"), ...errorResponses },
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<GameService["createGame"]>[1];
      if (body.opponent.type === "ai" && body.opponent.level === undefined) body.opponent.level = 4 as never;
      return reply.code(201).send(service.createGame(req.user, body));
    },
  );

  app.post(
    `${API}/games/import`,
    {
      preHandler: auth,
      schema: {
        tags: ["games"],
        summary: "PGN importieren (z. B. von chess.com) – ergibt eine nachspielbare Partie",
        body: { type: "object", properties: { pgn: { type: "string", minLength: 1 } }, required: ["pgn"] },
        response: { 201: ref("Game"), ...errorResponses },
      },
    },
    async (req, reply) => reply.code(201).send(service.importPgn(req.user, (req.body as { pgn: string }).pgn)),
  );

  app.get(
    `${API}/games`,
    {
      preHandler: auth,
      schema: { tags: ["games"], summary: "Eigene Partien (neueste zuerst)", response: { 200: { type: "array", items: ref("Game") }, ...errorResponses } },
    },
    async (req) => service.listGames(req.user),
  );

  app.get(
    `${API}/games/:id`,
    { schema: { tags: ["games"], summary: "Partie-Snapshot", security: [], params: idParam, response: { 200: ref("Game"), ...errorResponses } } },
    async (req) => service.getSnapshot((req.params as { id: string }).id),
  );

  app.get(
    `${API}/games/:id/pgn`,
    {
      schema: {
        tags: ["games"],
        summary: "Partie als PGN",
        security: [],
        params: idParam,
        produces: ["application/x-chess-pgn"],
        response: { 200: { type: "string" }, ...errorResponses },
      },
    },
    async (req, reply) => reply.type("application/x-chess-pgn; charset=utf-8").send(service.getSnapshot((req.params as { id: string }).id).pgn),
  );

  app.post(
    `${API}/games/:id/join`,
    { preHandler: auth, schema: { tags: ["games"], summary: "Einladung annehmen", params: idParam, response: { 200: ref("Game"), ...errorResponses } } },
    async (req) => service.joinGame(req.user, (req.params as { id: string }).id),
  );

  app.post(
    `${API}/games/:id/move/:move`,
    {
      preHandler: auth,
      schema: {
        tags: ["games"],
        summary: "Zug ausführen (UCI wie e2e4 / e7e8q, alternativ SAN wie Nf3)",
        params: { type: "object", properties: { id: { type: "string" }, move: { type: "string" } }, required: ["id", "move"] },
        querystring: { type: "object", properties: { lag: { type: "integer", minimum: 0, description: "Gemessene Client-Latenz in ms" } } },
        response: { 200: ref("Game"), ...errorResponses },
      },
    },
    async (req) => {
      const { id, move } = req.params as { id: string; move: string };
      return service.move(req.user, id, move, (req.query as { lag?: number }).lag ?? 0);
    },
  );

  for (const action of ["resign", "abort"] as const) {
    app.post(
      `${API}/games/:id/${action}`,
      {
        preHandler: auth,
        schema: { tags: ["games"], summary: action === "resign" ? "Aufgeben" : "Abbrechen (nur vor dem ersten Zug)", params: idParam, response: { 200: ref("Game"), ...errorResponses } },
      },
      async (req) => service[action](req.user, (req.params as { id: string }).id),
    );
  }

  for (const kind of ["draw", "takeback"] as const) {
    app.post(
      `${API}/games/:id/${kind}/:action`,
      {
        preHandler: auth,
        schema: {
          tags: ["games"],
          summary: kind === "draw" ? "Remis anbieten / annehmen / ablehnen" : "Zugrücknahme anbieten / annehmen / ablehnen",
          params: {
            type: "object",
            properties: { id: { type: "string" }, action: { type: "string", enum: ["offer", "accept", "decline"] } },
            required: ["id", "action"],
          },
          response: { 200: ref("Game"), ...errorResponses },
        },
      },
      async (req) => {
        const { id, action } = req.params as { id: string; action: "offer" | "accept" | "decline" };
        return service[kind](req.user, id, action);
      },
    );
  }

  app.get(
    `${API}/games/:id/chat`,
    {
      schema: {
        tags: ["games"],
        summary: "Chatverlauf",
        security: [],
        params: idParam,
        response: { 200: { type: "array", items: { type: "object", properties: { username: { type: "string" }, text: { type: "string" }, at: { type: "integer" } } } } },
      },
    },
    async (req) => service.chat((req.params as { id: string }).id),
  );

  app.post(
    `${API}/games/:id/chat`,
    {
      preHandler: auth,
      schema: {
        tags: ["games"],
        summary: "Chatnachricht senden",
        params: idParam,
        body: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 300 } }, required: ["text"] },
        response: { 204: { type: "null" }, ...errorResponses },
      },
    },
    async (req, reply) => {
      service.sendChat(req.user, (req.params as { id: string }).id, (req.body as { text: string }).text);
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------ Lobby
  app.get(
    `${API}/seeks`,
    { schema: { tags: ["lobby"], summary: "Offene Gesuche", security: [], response: { 200: { type: "array", items: ref("Seek") } } } },
    async () => service.listSeeks(),
  );

  app.post(
    `${API}/seeks`,
    {
      preHandler: auth,
      schema: {
        tags: ["lobby"],
        summary: "Gegner suchen. Passt ein offenes Gesuch, startet sofort eine Partie (`game`), sonst wird ein Gesuch angelegt (`seek`); der Start kommt dann über /stream/events.",
        body: {
          type: "object",
          properties: { time_control: timeControlInput, color: { type: "string", enum: ["white", "black", "random"] } },
          required: ["time_control"],
        },
        response: { 200: { type: "object", properties: { seek: ref("Seek"), game: ref("Game") } }, ...errorResponses },
      },
    },
    async (req) => {
      const b = req.body as { time_control: string; color?: "white" | "black" | "random" };
      return service.seek(req.user, b.time_control, b.color);
    },
  );

  app.delete(
    `${API}/seeks/:id`,
    { preHandler: auth, schema: { tags: ["lobby"], summary: "Gesuch zurückziehen", params: idParam, response: { 204: { type: "null" }, ...errorResponses } } },
    async (req, reply) => {
      service.cancelSeek(req.user, (req.params as { id: string }).id);
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------ Streams (NDJSON)
  const ndjson = (req: FastifyRequest, reply: FastifyReply, channel: string, first: unknown[]) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    const write = (e: unknown) => res.write(JSON.stringify(e) + "\n");
    for (const e of first) write(e);
    service.events.on(channel, write);
    const ping = setInterval(() => res.write("\n"), keepAliveMs);
    const close = () => {
      clearInterval(ping);
      service.events.off(channel, write);
    };
    req.raw.on("close", close);
    res.on("close", close);
  };

  app.get(
    `${API}/games/:id/stream`,
    {
      schema: {
        tags: ["streams"],
        summary: "NDJSON-Stream einer Partie: zuerst `gameFull`, danach `gameState`, `chatLine`, …",
        security: [],
        params: idParam,
        produces: ["application/x-ndjson"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const snap = service.getSnapshot(id);
      ndjson(req, reply, `game:${id}`, [{ type: "gameFull", game: snap } satisfies GameStreamEvent]);
    },
  );

  app.get(
    `${API}/stream/events`,
    {
      preHandler: auth,
      schema: {
        tags: ["streams"],
        summary: "NDJSON-Stream des Accounts: `gameStart`, `gameFinish`, `seekRemoved`. Laufende Partien werden beim Verbinden als `gameStart` gemeldet.",
        produces: ["application/x-ndjson"],
      },
    },
    async (req, reply) => {
      const running = service
        .listGames(req.user)
        .filter((g) => g.status === "started" || g.status === "waiting")
        .map((g): AccountEvent => {
          const color = g.white.id === req.user.id ? "white" : "black";
          return { type: "gameStart", game: { id: g.id, color, opponent: g[color === "white" ? "black" : "white"].username, time_control: g.time_control } };
        });
      ndjson(req, reply, `user:${req.user.id}`, running);
    },
  );

  // ------------------------------------------------------------ WebSocket
  app.get(
    `${API}/ws`,
    {
      websocket: true,
      schema: {
        tags: ["streams"],
        summary:
          'WebSocket mit denselben Events. Client sendet {"type":"subscribe","game_id":"…"} bzw. "unsubscribe" oder {"type":"lobby"}. Server-Nachrichten haben zusätzlich `channel` ("game:<id>", "user", "lobby").',
        querystring: { type: "object", properties: { token: { type: "string" } } },
      },
    },
    (socket, req) => {
      const user = service.authenticate(tokenOf(req));
      const subs = new Map<string, (e: unknown) => void>();
      const send = (channel: string) => (e: unknown) => socket.readyState === 1 && socket.send(JSON.stringify({ channel, ...(e as object) }));
      const sub = (ch: string, label: string) => {
        if (subs.has(ch)) return;
        const fn = send(label);
        subs.set(ch, fn);
        service.events.on(ch, fn);
      };
      if (user) sub(`user:${user.id}`, "user");
      socket.on("message", (raw: Buffer) => {
        let msg: { type?: string; game_id?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "subscribe" && msg.game_id) {
          try {
            const snap = service.getSnapshot(msg.game_id);
            sub(`game:${msg.game_id}`, `game:${msg.game_id}`);
            send(`game:${msg.game_id}`)({ type: "gameFull", game: snap });
            for (const line of service.chat(msg.game_id)) send(`game:${msg.game_id}`)({ type: "chatLine", line });
          } catch {
            socket.send(JSON.stringify({ type: "error", message: "Partie nicht gefunden" }));
          }
        } else if (msg.type === "unsubscribe" && msg.game_id) {
          const ch = `game:${msg.game_id}`;
          const fn = subs.get(ch);
          if (fn) service.events.off(ch, fn);
          subs.delete(ch);
        } else if (msg.type === "lobby") {
          sub("lobby", "lobby");
        } else if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
        }
      });
      socket.on("close", () => {
        for (const [ch, fn] of subs) service.events.off(ch, fn);
      });
    },
  );

  // ------------------------------------------------------------ Analyse
  app.get(
    `${API}/analysis`,
    {
      schema: {
        tags: ["analysis"],
        summary: "Stockfish-Bewertung einer Stellung",
        security: [],
        querystring: {
          type: "object",
          properties: { fen: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: 18, default: 12 } },
          required: ["fen"],
        },
        response: { 200: ref("Analysis"), ...errorResponses },
      },
    },
    async (req) => {
      const { fen, depth } = req.query as { fen: string; depth: number };
      const { Chess } = await import("chess.js");
      try {
        new Chess(fen);
      } catch {
        throw new ApiError(400, "invalid_fen", "Ungültige FEN");
      }
      return engine.analyse(fen, depth);
    },
  );

  // ------------------------------------------------------------ chess.com
  const ccUser = { type: "object", properties: { username: { type: "string" } }, required: ["username"] };
  const ccRoute = (path: string, summary: string, params: object, fn: (p: Record<string, string>) => Promise<unknown>) =>
    app.get(`${API}/chesscom${path}`, { schema: { tags: ["chesscom"], summary, security: [], params } }, async (req) => fn(req.params as Record<string, string>));
  ccRoute("/player/:username", "Spielerprofil", ccUser, (p) => chessCom.player(p.username!));
  ccRoute("/player/:username/stats", "Ratings & Statistiken", ccUser, (p) => chessCom.stats(p.username!));
  ccRoute("/player/:username/games/archives", "Liste der Monatsarchive", ccUser, (p) => chessCom.archives(p.username!));
  ccRoute(
    "/player/:username/games/:year/:month",
    "Partien eines Monats",
    { type: "object", properties: { username: { type: "string" }, year: { type: "string" }, month: { type: "string" } }, required: ["username", "year", "month"] },
    (p) => chessCom.monthlyGames(p.username!, p.year!, p.month!),
  );

  app.get(`${API}`, { schema: { hide: true } }, async () => ({ name: "chessy", version: "1.0.0", docs: "/docs", openapi: "/docs/json" }));

  // ------------------------------------------------------------ Web-Frontend
  const webDist = opts.webDist === undefined ? join(here, "../../web/dist") : opts.webDist;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found", message: "Unbekannter Endpunkt" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    service.shutdown();
    engine.close();
    store.close();
  });

  return { app, service };
}
