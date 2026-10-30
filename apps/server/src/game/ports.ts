import type { Account, AiLevel, AnalysisResult, GameSnapshot } from "@chessy/shared";

/**
 * Schnittstellen des GameService zur Außenwelt. Sie sind bewusst frei von Node-APIs, damit dieselbe
 * Spiellogik auch im Browser läuft (statische Demo auf GitHub Pages).
 */

export interface StoredUser extends Account {
  token: string;
}

export interface GameStore {
  createUser(u: StoredUser): void;
  userByToken(token: string): StoredUser | undefined;
  userById(id: string): StoredUser | undefined;
  usernameTaken(username: string): boolean;
  saveGame(g: GameSnapshot): void;
  loadGame(id: string): GameSnapshot | undefined;
  activeGames(): GameSnapshot[];
  gamesOf(userId: string, limit?: number): GameSnapshot[];
  close(): void;
}

export interface MoveRequest {
  initialFen: string;
  moves: string[];
  level: AiLevel;
  /** Verbleibende Zeit der KI in ms (null = unbegrenzt). */
  timeLeft: number | null;
  increment: number;
}

export interface Engine {
  bestMove(req: MoveRequest): Promise<string>;
  analyse(fen: string, depth: number): Promise<AnalysisResult>;
  close(): void;
}

type Listener = (payload: never) => void;

/** Minimaler Event-Emitter (Teilmenge von node:events), läuft in Node und im Browser. */
export class Emitter {
  private listeners = new Map<string, Set<Listener>>();

  on<T>(event: string, fn: (payload: T) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener);
  }

  off<T>(event: string, fn: (payload: T) => void) {
    const set = this.listeners.get(event);
    set?.delete(fn as Listener);
    if (set?.size === 0) this.listeners.delete(event);
  }

  emit(event: string, payload: unknown) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) (fn as (p: unknown) => void)(payload);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** Zufallsstring aus `bytes` Zufallsbytes (Web Crypto, in Node ≥ 19 global verfügbar). */
export function randomString(bytes: number, encoding: "base64url" | "hex" = "base64url"): string {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  if (encoding === "hex") return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
