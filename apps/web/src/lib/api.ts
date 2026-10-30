import type { Account, AnalysisResult, GameSnapshot, Seek, TimeControl } from "@chessy/shared";
import { STATIC } from "./paths.ts";
import { ensureLocalAccount, localApi, renameLocal } from "./localBackend.ts";

const BASE = "/api/v1";
const TOKEN_KEY = "chessy.token";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const storage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* privater Modus */
    }
  },
};

export const getToken = () => storage.get(TOKEN_KEY);

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (isJson ? data : {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? "error", d.message ?? `Fehler ${res.status}`);
  }
  return data as T;
}

/** Stellt sicher, dass ein Gast-Account existiert (Token im Browser gespeichert). */
export async function ensureAccount(): Promise<Account> {
  if (STATIC) return ensureLocalAccount();
  if (getToken()) {
    try {
      return await request<Account>("GET", "/account");
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
    }
  }
  const r = await request<{ account: Account; token: string }>("POST", "/auth/guest", {}, false);
  storage.set(TOKEN_KEY, r.token);
  return r.account;
}

export async function renameByNewGuest(username: string): Promise<Account> {
  if (STATIC) return renameLocal(username);
  const r = await request<{ account: Account; token: string }>("POST", "/auth/guest", { username }, false);
  storage.set(TOKEN_KEY, r.token);
  return r.account;
}

export type OpponentInput = { type: "ai"; level: number } | { type: "local" } | { type: "friend" };

const remoteApi = {
  createGame: (opponent: OpponentInput, time_control: string | TimeControl, color: "white" | "black" | "random") =>
    request<GameSnapshot>("POST", "/games", { opponent, time_control, color }),
  game: (id: string) => request<GameSnapshot>("GET", `/games/${id}`),
  myGames: () => request<GameSnapshot[]>("GET", "/games"),
  join: (id: string) => request<GameSnapshot>("POST", `/games/${id}/join`),
  move: (id: string, uci: string, lag = 0) => request<GameSnapshot>("POST", `/games/${id}/move/${uci}?lag=${Math.round(lag)}`),
  resign: (id: string) => request<GameSnapshot>("POST", `/games/${id}/resign`),
  abort: (id: string) => request<GameSnapshot>("POST", `/games/${id}/abort`),
  draw: (id: string, action: "offer" | "accept" | "decline") => request<GameSnapshot>("POST", `/games/${id}/draw/${action}`),
  takeback: (id: string, action: "offer" | "accept" | "decline") => request<GameSnapshot>("POST", `/games/${id}/takeback/${action}`),
  chat: (id: string, text: string) => request<void>("POST", `/games/${id}/chat`, { text }),
  importPgn: (pgn: string) => request<GameSnapshot>("POST", "/games/import", { pgn }),
  seeks: () => request<Seek[]>("GET", "/seeks"),
  seek: (time_control: string, color: "white" | "black" | "random" = "random") =>
    request<{ seek?: Seek; game?: GameSnapshot }>("POST", "/seeks", { time_control, color }),
  cancelSeek: (id: string) => request<void>("DELETE", `/seeks/${id}`),
  analysis: (fen: string, depth = 14) => request<AnalysisResult>("GET", `/analysis?fen=${encodeURIComponent(fen)}&depth=${depth}`, undefined, false),
  createToken: (kind: "bot" | "board", username?: string) =>
    request<{ account: Account; token: string }>("POST", `/auth/${kind}`, username ? { username } : {}, false),
  chesscom: {
    player: (u: string) => request<ChessComPlayer>("GET", `/chesscom/player/${u}`, undefined, false),
    stats: (u: string) => request<ChessComStats>("GET", `/chesscom/player/${u}/stats`, undefined, false),
    archives: (u: string) => request<{ archives: string[] }>("GET", `/chesscom/player/${u}/games/archives`, undefined, false),
    month: (u: string, y: string, m: string) => request<{ games: ChessComGame[] }>("GET", `/chesscom/player/${u}/games/${y}/${m}`, undefined, false),
  },
};

export type Api = typeof remoteApi;

/** Mit Server: REST-API. Statische Demo: dieselbe Spiellogik im Browser. */
export const api: Api = STATIC ? localApi : remoteApi;

export interface ChessComPlayer {
  username: string;
  name?: string;
  title?: string;
  avatar?: string;
  country?: string;
  followers?: number;
  joined?: number;
  last_online?: number;
  status?: string;
  url?: string;
}

interface ChessComRating {
  last?: { rating: number; date: number };
  best?: { rating: number; date: number; game?: string };
  record?: { win: number; loss: number; draw: number };
}
export type ChessComStats = Partial<Record<"chess_rapid" | "chess_blitz" | "chess_bullet" | "chess_daily", ChessComRating>> & {
  tactics?: { highest?: { rating: number } };
};

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  time_class: string;
  end_time: number;
  rated: boolean;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}
