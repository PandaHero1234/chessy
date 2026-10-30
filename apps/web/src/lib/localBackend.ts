import type { Account, GameSnapshot } from "@chessy/shared";
import { GameService, ApiError as ServiceError } from "../../../server/src/game/service.ts";
import type { GameStore, StoredUser } from "../../../server/src/game/ports.ts";
import { BrowserEngine } from "./browserEngine.ts";
import { live } from "./live.ts";
import type { Api, ChessComGame, ChessComPlayer, ChessComStats } from "./api.ts";
import { ApiError } from "./api.ts";

/**
 * Statische Demo (GitHub Pages): Derselbe GameService wie auf dem Server läuft im Browser,
 * Partien werden in localStorage gehalten, Stockfish läuft als Web Worker.
 */

const USERS_KEY = "chessy.demo.users";
const GAMES_KEY = "chessy.demo.games";
const TOKEN_KEY = "chessy.demo.token";
const MAX_GAMES = 40;

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privater Modus: nur im Speicher */
  }
}

class LocalStore implements GameStore {
  private users: StoredUser[] = read(USERS_KEY, []);
  private games: GameSnapshot[] = read(GAMES_KEY, []);

  createUser(u: StoredUser) {
    this.users.push(u);
    write(USERS_KEY, this.users);
  }
  userByToken(token: string) {
    return this.users.find((u) => u.token === token);
  }
  userById(id: string) {
    return this.users.find((u) => u.id === id);
  }
  usernameTaken(username: string) {
    return this.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
  }
  saveGame(g: GameSnapshot) {
    this.games = [g, ...this.games.filter((x) => x.id !== g.id)].slice(0, MAX_GAMES);
    write(GAMES_KEY, this.games);
  }
  loadGame(id: string) {
    return this.games.find((g) => g.id === id);
  }
  activeGames() {
    return this.games.filter((g) => g.status === "started" || g.status === "waiting");
  }
  gamesOf(userId: string, limit = 50) {
    return this.games.filter((g) => g.white.id === userId || g.black.id === userId).slice(0, limit);
  }
  close() {}
}

let service: GameService | null = null;
let engine: BrowserEngine | null = null;
let user: StoredUser | null = null;

function boot() {
  if (!service) {
    engine = new BrowserEngine();
    service = new GameService(new LocalStore(), engine);
  }
  return service;
}

const toAccount = (u: StoredUser): Account => ({ id: u.id, username: u.username, kind: u.kind, created_at: u.created_at });

async function call<T>(fn: (s: GameService, u: StoredUser) => T): Promise<T> {
  const s = boot();
  if (!user) await ensureLocalAccount();
  try {
    return fn(s, user!);
  } catch (e) {
    if (e instanceof ServiceError) throw new ApiError(e.statusCode, e.code, e.message);
    throw e;
  }
}

const needsServer = async (): Promise<never> => {
  throw new ApiError(501, "needs_server", "Diese Funktion braucht den Chessy-Server (npm start). Die Pages-Demo läuft nur im Browser.");
};

export async function ensureLocalAccount(): Promise<Account> {
  const s = boot();
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* ignorieren */
  }
  user = s.authenticate(token ?? undefined) ?? null;
  if (!user) {
    user = s.createAccount("guest");
    try {
      localStorage.setItem(TOKEN_KEY, user.token);
    } catch {
      /* ignorieren */
    }
  }
  live.useLocal(s.events, user.id);
  return toAccount(user);
}

export async function renameLocal(username: string): Promise<Account> {
  const s = boot();
  const next = s.createAccount("guest", username);
  user = next;
  try {
    localStorage.setItem(TOKEN_KEY, next.token);
  } catch {
    /* ignorieren */
  }
  live.useLocal(s.events, next.id);
  return toAccount(next);
}

/** chess.com erlaubt CORS: In der Demo fragt der Browser direkt bei api.chess.com an. */
async function chessCom<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.chess.com/pub${path}`);
  } catch {
    throw new ApiError(502, "chesscom_unreachable", "chess.com ist nicht erreichbar");
  }
  if (res.status === 404) throw new ApiError(404, "chesscom_not_found", "Bei chess.com nicht gefunden");
  if (!res.ok) throw new ApiError(502, "chesscom_error", `chess.com antwortete mit ${res.status}`);
  return (await res.json()) as T;
}
const ccUser = (u: string) => encodeURIComponent(u.toLowerCase());

export const localApi: Api = {
  createGame: (opponent, time_control, color) =>
    call((s, u) => s.createGame(u, { opponent: opponent as Parameters<GameService["createGame"]>[1]["opponent"], time_control, color })),
  game: (id) => call((s) => s.getSnapshot(id)),
  myGames: () => call((s, u) => s.listGames(u)),
  join: needsServer,
  move: (id, uci) => call((s, u) => s.move(u, id, uci)),
  resign: (id) => call((s, u) => s.resign(u, id)),
  abort: (id) => call((s, u) => s.abort(u, id)),
  draw: (id, action) => call((s, u) => s.draw(u, id, action)),
  takeback: (id, action) => call((s, u) => s.takeback(u, id, action)),
  chat: (id, text) => call((s, u) => s.sendChat(u, id, text)),
  importPgn: (pgn) => call((s, u) => s.importPgn(u, pgn)),
  seeks: async () => [],
  seek: needsServer,
  cancelSeek: needsServer,
  analysis: async (fen, depth = 14) => {
    boot();
    return engine!.analyse(fen, Math.min(depth, 16));
  },
  createToken: needsServer,
  chesscom: {
    player: (u) => chessCom<ChessComPlayer>(`/player/${ccUser(u)}`),
    stats: (u) => chessCom<ChessComStats>(`/player/${ccUser(u)}/stats`),
    archives: (u) => chessCom<{ archives: string[] }>(`/player/${ccUser(u)}/games/archives`),
    month: (u, y, m) => chessCom<{ games: ChessComGame[] }>(`/player/${ccUser(u)}/games/${y}/${m}`),
  },
};
