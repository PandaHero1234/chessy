import type { Puzzle, PuzzlePublic, PuzzleTheme, Difficulty } from "./types.ts";
import { DIFFICULTIES, THEMES } from "./types.ts";
import { checkMoves, hintSquare, solverMoveCount, toPublic, type CheckResult } from "./check.ts";
import { START_RATING, updateRatings } from "./rating.ts";
import { mineGame, type Analyzer, type MiningOptions } from "./mining.ts";

export interface PuzzleUserState {
  user_id: string;
  rating: number;
  attempts: number;
  wins: number;
  streak: number;
  best_streak: number;
  storm_best: number;
  /** Letzte Versuche, neueste zuerst. */
  history: { puzzle_id: string; win: boolean; rating_after: number; at: number }[];
  themes: Partial<Record<PuzzleTheme, { attempts: number; wins: number }>>;
}

export interface PuzzleStat {
  rating: number;
  plays: number;
  wins: number;
}

/** Persistenz – SQLite auf dem Server, localStorage in der Pages-Demo. */
export interface PuzzleStore {
  getUser(userId: string): PuzzleUserState | undefined;
  saveUser(state: PuzzleUserState): void;
  getStat(puzzleId: string): PuzzleStat | undefined;
  saveStat(puzzleId: string, stat: PuzzleStat): void;
  attemptedIds(userId: string): Set<string>;
  userPuzzles(userId: string): Puzzle[];
  addUserPuzzles(userId: string, puzzles: Puzzle[]): void;
}

export class PuzzleError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface NextFilter {
  difficulty?: Difficulty;
  theme?: PuzzleTheme;
  /** Nur Puzzles aus eigenen Partien. */
  mine?: boolean;
}

export type CheckResponse = CheckResult & {
  rating?: { before: number; after: number; delta: number };
  /** Nach dem Lösen: Themen und vollständige Lösung. */
  themes?: PuzzleTheme[];
  solution?: string[];
};

interface Session {
  failed: boolean;
  hinted: boolean;
  recorded: boolean;
}

const HISTORY = 50;

/**
 * Puzzle-Logik für Server und Browser: Auswahl (Stufe, adaptiv, Thema), Prüfen, Tipps, Ratings,
 * Tagespuzzle, Puzzle-Sturm und Puzzles aus eigenen Partien.
 */
export class PuzzleService {
  private byId: Map<string, Puzzle>;
  private sessions = new Map<string, Session>();

  constructor(
    private readonly puzzles: Puzzle[],
    private readonly store: PuzzleStore,
    private readonly now: () => number = Date.now,
  ) {
    this.byId = new Map(puzzles.map((p) => [p.id, p]));
  }

  get count() {
    return this.puzzles.length;
  }

  private find(userId: string, id: string): Puzzle {
    const p = this.byId.get(id) ?? this.store.userPuzzles(userId).find((x) => x.id === id);
    if (!p) throw new PuzzleError(404, "puzzle_not_found", "Puzzle nicht gefunden");
    return p;
  }

  private rated(p: Puzzle): Puzzle {
    const s = this.store.getStat(p.id);
    return s ? { ...p, rating: s.rating } : p;
  }

  user(userId: string): PuzzleUserState {
    return (
      this.store.getUser(userId) ?? {
        user_id: userId,
        rating: START_RATING,
        attempts: 0,
        wins: 0,
        streak: 0,
        best_streak: 0,
        storm_best: 0,
        history: [],
        themes: {},
      }
    );
  }

  /** Nächstes Puzzle: nach Stufe, sonst adaptiv um das eigene Rating. */
  next(userId: string, filter: NextFilter = {}): PuzzlePublic {
    let pool = filter.mine ? this.store.userPuzzles(userId) : this.puzzles;
    if (filter.theme) pool = pool.filter((p) => p.themes.includes(filter.theme!));
    if (!pool.length) throw new PuzzleError(404, "no_puzzles", filter.mine ? "Noch keine Puzzles aus deinen Partien" : "Keine Puzzles für diesen Filter");
    const seen = this.store.attemptedIds(userId);
    const fresh = pool.filter((p) => !seen.has(p.id));
    const base = (fresh.length ? fresh : pool).map((p) => this.rated(p));
    let candidates: Puzzle[];
    if (filter.difficulty) {
      const d = DIFFICULTIES[filter.difficulty];
      candidates = base.filter((p) => p.rating >= d.min && p.rating < d.max);
      if (!candidates.length) throw new PuzzleError(404, "no_puzzles", `Keine Puzzles der Stufe ${d.label} für diesen Filter`);
    } else {
      const target = this.user(userId).rating;
      let window = 100;
      do {
        candidates = base.filter((p) => Math.abs(p.rating - target) <= window);
        window *= 1.6;
      } while (candidates.length < 5 && window < 3000);
      if (!candidates.length) candidates = base;
    }
    const p = candidates[Math.floor(Math.random() * candidates.length)]!;
    this.sessions.set(`${userId}:${p.id}`, { failed: false, hinted: false, recorded: false });
    return toPublic(p);
  }

  get(userId: string, id: string): PuzzlePublic {
    const p = this.rated(this.find(userId, id));
    if (!this.sessions.has(`${userId}:${id}`)) this.sessions.set(`${userId}:${id}`, { failed: false, hinted: false, recorded: false });
    return toPublic(p);
  }

  /** Tagespuzzle: für alle gleich, wechselt um Mitternacht UTC. */
  daily(date = new Date(this.now())): PuzzlePublic {
    const day = date.toISOString().slice(0, 10);
    const pool = this.puzzles.filter((p) => p.rating >= 1300 && p.rating <= 2100 && solverMoveCount(p) >= 2);
    const list = (pool.length ? pool : this.puzzles).slice().sort((a, b) => a.id.localeCompare(b.id));
    if (!list.length) throw new PuzzleError(404, "no_puzzles", "Keine Puzzles vorhanden");
    let h = 0;
    for (const ch of day) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    return { ...toPublic(this.rated(list[h % list.length]!)), daily: day } as PuzzlePublic & { daily: string };
  }

  check(userId: string, id: string, moves: string[]): CheckResponse {
    const p = this.find(userId, id);
    const key = `${userId}:${id}`;
    const session = this.sessions.get(key) ?? { failed: false, hinted: false, recorded: false };
    this.sessions.set(key, session);
    const result: CheckResponse = checkMoves(p, moves);
    if (result.status === "wrong") {
      session.failed = true;
      result.rating = this.record(userId, p, false, session);
    } else if (result.status === "solved") {
      result.rating = this.record(userId, p, !session.failed, session);
      result.themes = p.themes;
      result.solution = p.moves;
    }
    return result;
  }

  hint(userId: string, id: string, solvedMoves: number): { square: string | null } {
    const p = this.find(userId, id);
    const key = `${userId}:${id}`;
    const s = this.sessions.get(key) ?? { failed: false, hinted: false, recorded: false };
    s.hinted = true;
    this.sessions.set(key, s);
    return { square: hintSquare(p, solvedMoves) };
  }

  /** Lösung anzeigen zählt als nicht gelöst. */
  solution(userId: string, id: string): { moves: string[]; themes: PuzzleTheme[]; rating?: CheckResponse["rating"] } {
    const p = this.find(userId, id);
    const key = `${userId}:${id}`;
    const s = this.sessions.get(key) ?? { failed: false, hinted: false, recorded: false };
    this.sessions.set(key, s);
    s.failed = true;
    return { moves: p.moves, themes: p.themes, rating: this.record(userId, p, false, s) };
  }

  private record(userId: string, p: Puzzle, win: boolean, session: Session) {
    if (session.recorded) return undefined;
    session.recorded = true;
    const u = this.user(userId);
    const stat = this.store.getStat(p.id) ?? { rating: p.rating, plays: 0, wins: 0 };
    const before = u.rating;
    // Mit Tipp gelöst: zählt als Versuch, verändert das Rating aber nicht.
    const assisted = win && session.hinted;
    const r = updateRatings({ rating: u.rating, attempts: u.attempts }, { rating: stat.rating, plays: stat.plays }, win);
    if (!assisted) {
      u.rating = r.player;
      this.store.saveStat(p.id, { rating: r.puzzle, plays: stat.plays + 1, wins: stat.wins + (win ? 1 : 0) });
    }
    u.attempts++;
    if (win) {
      u.wins++;
      u.streak++;
      u.best_streak = Math.max(u.best_streak, u.streak);
    } else u.streak = 0;
    for (const t of p.themes) {
      const ts = (u.themes[t] ??= { attempts: 0, wins: 0 });
      ts.attempts++;
      if (win) ts.wins++;
    }
    u.history = [{ puzzle_id: p.id, win, rating_after: u.rating, at: this.now() }, ...u.history].slice(0, HISTORY);
    this.store.saveUser(u);
    return { before, after: u.rating, delta: u.rating - before };
  }

  stats(userId: string) {
    const u = this.user(userId);
    return { ...u, puzzles_available: this.puzzles.length, own_puzzles: this.store.userPuzzles(userId).length };
  }

  /** Übersicht für Filter: Anzahl je Stufe und Thema. */
  catalog() {
    const difficulties = Object.fromEntries(
      Object.entries(DIFFICULTIES).map(([k, d]) => [k, this.puzzles.filter((p) => p.rating >= d.min && p.rating < d.max).length]),
    ) as Record<Difficulty, number>;
    const themes = Object.fromEntries(THEMES.map((t) => [t, this.puzzles.filter((p) => p.themes.includes(t)).length]).filter(([, n]) => (n as number) > 0)) as Partial<
      Record<PuzzleTheme, number>
    >;
    return { total: this.puzzles.length, difficulties, themes };
  }

  /** Puzzle-Sturm: 60 Puzzles mit steigender Schwierigkeit. Ungewertet, Lösungen werden mitgeschickt. */
  storm(count = 60): Puzzle[] {
    const used = new Set<string>();
    const out: Puzzle[] = [];
    const short = this.puzzles.filter((p) => solverMoveCount(p) <= 3);
    const pool = short.length >= count ? short : this.puzzles;
    for (let k = 0; k < count && used.size < pool.length; k++) {
      const target = 600 + (k * 1800) / count;
      let window = 120;
      let c: Puzzle[] = [];
      while (!c.length && window < 4000) {
        c = pool.filter((p) => !used.has(p.id) && Math.abs(p.rating - target) <= window);
        window *= 2;
      }
      if (!c.length) break;
      const p = c[Math.floor(Math.random() * c.length)]!;
      used.add(p.id);
      out.push({ id: p.id, fen: p.fen, moves: p.moves, rating: p.rating, themes: p.themes, source: p.source });
    }
    return out;
  }

  stormResult(userId: string, score: number) {
    const u = this.user(userId);
    const best = score > u.storm_best;
    if (best) {
      u.storm_best = score;
      this.store.saveUser(u);
    }
    return { score, best: u.storm_best, new_record: best };
  }

  /** Durchsucht eine eigene Partie nach verpassten oder genutzten Taktiken. */
  async fromGame(userId: string, game: { id: string; initialFen: string; moves: string[] }, engine: Analyzer, opts: Partial<MiningOptions> = {}): Promise<Puzzle[]> {
    const found = await mineGame(engine, { initialFen: game.initialFen, moves: game.moves }, { verifyNodes: 0, ...opts, source: `game:${game.id}` });
    const existing = new Set(this.store.userPuzzles(userId).map((p) => p.id));
    const fresh = found.filter((p) => !existing.has(p.id));
    if (fresh.length) this.store.addUserPuzzles(userId, fresh);
    return found;
  }
}

/** Speicher im Arbeitsspeicher (Tests, Fallback). */
export class MemoryPuzzleStore implements PuzzleStore {
  users = new Map<string, PuzzleUserState>();
  stats = new Map<string, PuzzleStat>();
  own = new Map<string, Puzzle[]>();
  getUser(id: string) {
    const u = this.users.get(id);
    return u ? structuredClone(u) : undefined;
  }
  saveUser(s: PuzzleUserState) {
    this.users.set(s.user_id, structuredClone(s));
  }
  getStat(id: string) {
    return this.stats.get(id);
  }
  saveStat(id: string, s: PuzzleStat) {
    this.stats.set(id, s);
  }
  attemptedIds(userId: string) {
    return new Set(this.users.get(userId)?.history.map((h) => h.puzzle_id) ?? []);
  }
  userPuzzles(userId: string) {
    return this.own.get(userId) ?? [];
  }
  addUserPuzzles(userId: string, puzzles: Puzzle[]) {
    this.own.set(userId, [...puzzles, ...(this.own.get(userId) ?? [])]);
  }
}
