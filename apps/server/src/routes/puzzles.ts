import type { FastifyInstance, FastifyRequest } from "fastify";
import { DIFFICULTIES, THEMES, PuzzleError, type Analyzer, type PuzzleService } from "@chessy/puzzles";
import { ApiError, type GameService } from "../game/service.ts";
import { errorResponses, ref } from "./schemas.ts";

const API = "/api/v1/puzzles";
const idParam = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };

/** Puzzle-Endpunkte. Lösungen verlassen den Server erst nach dem Lösen (Ausnahme: ungewerteter Puzzle-Sturm). */
export function registerPuzzleRoutes(
  app: FastifyInstance,
  deps: { puzzles: PuzzleService; games: GameService; miner: Analyzer; auth: (req: FastifyRequest) => Promise<void> },
) {
  const { puzzles, auth } = deps;
  const wrap = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof PuzzleError) throw new ApiError(e.statusCode, e.code, e.message);
      throw e;
    }
  };

  app.get(
    `${API}/catalog`,
    {
      schema: {
        tags: ["puzzles"],
        summary: "Anzahl Puzzles je Schwierigkeitsstufe und Thema",
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              total: { type: "integer" },
              difficulties: { type: "object", additionalProperties: { type: "integer" } },
              themes: { type: "object", additionalProperties: { type: "integer" } },
              levels: { type: "object", additionalProperties: { type: "object", properties: { label: { type: "string" }, min: { type: "integer" }, max: { type: "integer" } } } },
            },
          },
        },
      },
    },
    async () => ({ ...puzzles.catalog(), levels: DIFFICULTIES }),
  );

  app.get(
    `${API}/next`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Nächstes Puzzle. Ohne `difficulty` adaptiv nach dem eigenen Puzzle-Rating.",
        querystring: {
          type: "object",
          properties: {
            difficulty: { type: "string", enum: Object.keys(DIFFICULTIES) },
            theme: { type: "string", enum: [...THEMES] },
            mine: { type: "boolean", description: "Nur Puzzles aus eigenen Partien" },
          },
        },
        response: { 200: ref("PuzzlePublic"), ...errorResponses },
      },
    },
    async (req) => {
      const q = req.query as { difficulty?: keyof typeof DIFFICULTIES; theme?: (typeof THEMES)[number]; mine?: boolean };
      return wrap(() => puzzles.next(req.user.id, q));
    },
  );

  app.get(
    `${API}/daily`,
    { schema: { tags: ["puzzles"], summary: "Tagespuzzle (für alle gleich, wechselt um 0 Uhr UTC)", security: [], response: { 200: ref("PuzzlePublic"), ...errorResponses } } },
    async () => wrap(() => puzzles.daily()),
  );

  app.get(
    `${API}/storm`,
    {
      schema: {
        tags: ["puzzles"],
        summary: "Puzzle-Sturm: Puzzles mit steigender Schwierigkeit, inkl. Lösung (ungewertet, Client prüft selbst)",
        security: [],
        querystring: { type: "object", properties: { count: { type: "integer", minimum: 5, maximum: 100, default: 60 } } },
        response: { 200: { type: "array", items: ref("Puzzle") } },
      },
    },
    async (req) => puzzles.storm((req.query as { count: number }).count),
  );

  app.post(
    `${API}/storm/result`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Ergebnis eines Puzzle-Sturms speichern",
        body: { type: "object", properties: { score: { type: "integer", minimum: 0, maximum: 500 } }, required: ["score"] },
        response: { 200: { type: "object", properties: { score: { type: "integer" }, best: { type: "integer" }, new_record: { type: "boolean" } } }, ...errorResponses },
      },
    },
    async (req) => puzzles.stormResult(req.user.id, (req.body as { score: number }).score),
  );

  app.get(
    `${API}/stats`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Eigenes Puzzle-Rating, Serie, Verlauf und Erfolgsquote je Thema",
        response: {
          200: {
            type: "object",
            properties: {
              rating: { type: "integer" },
              attempts: { type: "integer" },
              wins: { type: "integer" },
              streak: { type: "integer" },
              best_streak: { type: "integer" },
              storm_best: { type: "integer" },
              puzzles_available: { type: "integer" },
              own_puzzles: { type: "integer" },
              history: {
                type: "array",
                items: { type: "object", properties: { puzzle_id: { type: "string" }, win: { type: "boolean" }, rating_after: { type: "integer" }, at: { type: "integer" } } },
              },
              themes: { type: "object", additionalProperties: { type: "object", properties: { attempts: { type: "integer" }, wins: { type: "integer" } } } },
            },
          },
          ...errorResponses,
        },
      },
    },
    async (req) => puzzles.stats(req.user.id),
  );

  app.get(
    `${API}/:id`,
    { preHandler: auth, schema: { tags: ["puzzles"], summary: "Bestimmtes Puzzle öffnen (ohne Lösung)", params: idParam, response: { 200: ref("PuzzlePublic"), ...errorResponses } } },
    async (req) => wrap(() => puzzles.get(req.user.id, (req.params as { id: string }).id)),
  );

  app.post(
    `${API}/:id/check`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Eigene Züge prüfen. `moves` sind alle bisherigen eigenen Züge (UCI). Erster Fehler oder Lösen wird gewertet.",
        params: idParam,
        body: { type: "object", properties: { moves: { type: "array", items: { type: "string", pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$" }, minItems: 1, maxItems: 20 } }, required: ["moves"] },
        response: { 200: ref("PuzzleCheck"), ...errorResponses },
      },
    },
    async (req) => wrap(() => puzzles.check(req.user.id, (req.params as { id: string }).id, (req.body as { moves: string[] }).moves)),
  );

  app.post(
    `${API}/:id/hint`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Tipp: Startfeld des nächsten Lösungszugs, mit `level: 2` zusätzlich das Zielfeld. Mit Tipp gelöst zählt ohne Rating-Änderung.",
        params: idParam,
        body: { type: ["object", "null"], properties: { solved: { type: "integer", minimum: 0, default: 0 }, level: { type: "integer", enum: [1, 2], default: 1 } } },
        response: { 200: { type: "object", properties: { square: { type: ["string", "null"] }, to: { type: ["string", "null"] } } }, ...errorResponses },
      },
    },
    async (req) => {
      const body = req.body as { solved?: number; level?: 1 | 2 } | null;
      return wrap(() => puzzles.hint(req.user.id, (req.params as { id: string }).id, body?.solved ?? 0, body?.level ?? 1));
    },
  );

  app.post(
    `${API}/:id/solution`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Lösung anzeigen (zählt als nicht gelöst)",
        params: idParam,
        response: {
          200: { type: "object", properties: { moves: { type: "array", items: { type: "string" } }, themes: { type: "array", items: { type: "string" } }, rating: ref("PuzzleRatingChange") } },
          ...errorResponses,
        },
      },
    },
    async (req) => wrap(() => puzzles.solution(req.user.id, (req.params as { id: string }).id)),
  );

  const running = new Set<string>();
  app.post(
    `${API}/from-game/:id`,
    {
      preHandler: auth,
      schema: {
        tags: ["puzzles"],
        summary: "Eigene beendete Partie nach Taktiken durchsuchen; gefundene Puzzles landen unter `next?mine=true`",
        params: idParam,
        response: { 200: { type: "object", properties: { found: { type: "integer" }, puzzles: { type: "array", items: ref("PuzzlePublic") } } }, ...errorResponses },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const g = deps.games.getSnapshot(id);
      if (g.white.id !== req.user.id && g.black.id !== req.user.id) throw new ApiError(403, "not_your_game", "Nur eigene Partien können durchsucht werden");
      if (g.status !== "ended" && g.status !== "aborted") throw new ApiError(409, "game_running", "Die Partie läuft noch");
      if (running.has(req.user.id)) throw new ApiError(429, "busy", "Es läuft bereits eine Suche");
      running.add(req.user.id);
      try {
        const found = await puzzles.fromGame(
          req.user.id,
          { id: g.id, initialFen: g.initial_fen, moves: g.moves.split(" ").filter(Boolean) },
          deps.miner,
          { scanNodes: 80_000, solveNodes: 400_000, minPly: 4 },
        );
        return { found: found.length, puzzles: found.map((p) => wrap(() => puzzles.get(req.user.id, p.id))) };
      } finally {
        running.delete(req.user.id);
      }
    },
  );
}
