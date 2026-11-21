import type { Puzzle, PuzzlePublic, PuzzleTheme, Difficulty } from "./types.ts";
import { DIFFICULTIES } from "./types.ts";
import type { BandInfo, PuzzleSource } from "./source.ts";
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
  /** Optional (Browser): zuletzt gezeigte Puzzles merken, damit Verlaufs-Links ohne Suche in allen Bändern funktionieren. */
  cachePuzzle?(p: Puzzle): void;
  cachedPuzzle?(id: string): Puzzle | undefined;
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
 *
 * Die Sammlung kommt aus einer PuzzleSource in Rating-Bändern. Die Auswahl lädt nur die Bänder, die sie braucht,
 * und durchsucht nie die ganze Sammlung. So funktioniert derselbe Code mit 1.000 wie mit 100.000 Puzzles.
 */
export class PuzzleService {
  private byId = new Map<string, Puzzle>();
  private sessions = new Map<string, Session>();

  constructor(
    private readonly source: PuzzleSource,
    private readonly store: PuzzleStore,
    private readonly now: () => number = Date.now,
  ) {}

  get count() {
    return this.source.index.total;
  }

  private remember(list: Puzzle[]) {
    for (const p of list) this.byId.set(p.id, p);
    return list;
  }

  private async band(key: string): Promise<Puzzle[]> {
    const list = await this.source.band(key);
    if (list.length && !this.byId.has(list[0]!.id)) this.remember(list);
    return list;
  }

  private async pool(name: "storm" | "daily"): Promise<Puzzle[]> {
    return this.remember(await this.source.pool(name));
  }

  /** Lädt alle Bänder vorab (Server): Danach sind Puzzles per ID ohne Nachladen auffindbar. */
  async preload() {
    for (const b of this.source.index.bands) await this.band(b.key);
  }

  private async find(userId: string, id: string): Promise<Puzzle> {
    const known = this.byId.get(id) ?? this.store.userPuzzles(userId).find((x) => x.id === id) ?? this.store.cachedPuzzle?.(id);
    if (known) return known;
    // Unbekannte ID (z. B. geteilter Link): Bänder der Reihe nach durchsuchen.
    for (const b of this.source.index.bands) {
      await this.band(b.key);
      const p = this.byId.get(id);
      if (p) return p;
    }
    for (const name of ["daily", "storm"] as const) {
      await this.pool(name);
      const p = this.byId.get(id);
      if (p) return p;
    }
    throw new PuzzleError(404, "puzzle_not_found", "Puzzle nicht gefunden");
  }

  private rated(p: Puzzle): Puzzle {
    const s = this.store.getStat(p.id);
    return s ? { ...p, rating: s.rating } : p;
  }

  private serve(userId: string, p: Puzzle, fresh = true): PuzzlePublic {
    const key = `${userId}:${p.id}`;
    if (fresh || !this.sessions.has(key)) this.sessions.set(key, { failed: false, hinted: false, recorded: false });
    this.store.cachePuzzle?.(p);
    return toPublic(this.rated(p));
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
  async next(userId: string, filter: NextFilter = {}): Promise<PuzzlePublic> {
    const seen = this.store.attemptedIds(userId);
    const pick = (list: Puzzle[]) => {
      const fresh = list.filter((p) => !seen.has(p.id));
      const from = fresh.length ? fresh : list;
      return from[Math.floor(Math.random() * from.length)]!;
    };
    const matches = (p: Puzzle) => !filter.theme || p.themes.includes(filter.theme);

    if (filter.mine) {
      const own = this.store.userPuzzles(userId).filter(matches);
      if (!own.length) throw new PuzzleError(404, "no_puzzles", "Noch keine Puzzles aus deinen Partien");
      let c = own;
      if (filter.difficulty) {
        const d = DIFFICULTIES[filter.difficulty];
        c = own.filter((p) => p.rating >= d.min && p.rating < d.max);
        if (!c.length) throw new PuzzleError(404, "no_puzzles", `Keine Puzzles der Stufe ${d.label} für diesen Filter`);
      }
      return this.serve(userId, pick(c));
    }

    const bands = this.source.index.bands;
    if (!bands.length) throw new PuzzleError(404, "no_puzzles", "Keine Puzzles für diesen Filter");

    if (filter.difficulty) {
      // Ein zufälliges Band der Stufe (nach Größe gewichtet); nur wenn dort nichts passt, die übrigen.
      const d = DIFFICULTIES[filter.difficulty];
      const inLevel = bands.filter((b) => b.max > d.min && b.min < d.max && b.count > 0);
      const order = weightedOrder(inLevel);
      for (const b of order) {
        const c = (await this.band(b.key)).filter((p) => p.rating >= d.min && p.rating < d.max && matches(p));
        if (c.length) return this.serve(userId, pick(c));
      }
      throw new PuzzleError(404, "no_puzzles", `Keine Puzzles der Stufe ${d.label} für diesen Filter`);
    }

    // Adaptiv: Fenster um das eigene Rating, wird erweitert, bis genug ungelöste Kandidaten da sind.
    const target = this.user(userId).rating;
    let window = 100;
    let candidates: Puzzle[] = [];
    for (;;) {
      const lo = target - window;
      const hi = target + window;
      candidates = [];
      for (const b of bands) {
        if (b.max <= lo || b.min > hi || !b.count) continue;
        for (const p of await this.band(b.key)) if (p.rating >= lo && p.rating <= hi && matches(p)) candidates.push(p);
      }
      const fresh = candidates.filter((p) => !seen.has(p.id)).length;
      if (fresh >= 5 || window >= 3000) break;
      window *= 1.6;
    }
    if (!candidates.length) throw new PuzzleError(404, "no_puzzles", "Keine Puzzles für diesen Filter");
    return this.serve(userId, pick(candidates));
  }

  async get(userId: string, id: string): Promise<PuzzlePublic> {
    return this.serve(userId, await this.find(userId, id), false);
  }

  /** Tagespuzzle: für alle gleich, wechselt um Mitternacht UTC. */
  async daily(date = new Date(this.now())): Promise<PuzzlePublic & { daily: string }> {
    const day = date.toISOString().slice(0, 10);
    const list = await this.pool("daily");
    if (!list.length) throw new PuzzleError(404, "no_puzzles", "Keine Puzzles vorhanden");
    let h = 0;
    for (const ch of day) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    const p = list[h % list.length]!;
    this.store.cachePuzzle?.(p);
    return { ...toPublic(this.rated(p)), daily: day };
  }

  async check(userId: string, id: string, moves: string[]): Promise<CheckResponse> {
    const p = await this.find(userId, id);
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

  /** Tipp in zwei Stufen: Stufe 1 nennt die Figur (Startfeld), Stufe 2 zusätzlich das Zielfeld. */
  async hint(userId: string, id: string, solvedMoves: number, level: 1 | 2 = 1): Promise<{ square: string | null; to: string | null }> {
    const p = await this.find(userId, id);
    const key = `${userId}:${id}`;
    const s = this.sessions.get(key) ?? { failed: false, hinted: false, recorded: false };
    s.hinted = true;
    this.sessions.set(key, s);
    const move = p.moves[1 + 2 * solvedMoves];
    return { square: hintSquare(p, solvedMoves), to: level >= 2 && move ? move.slice(2, 4) : null };
  }

  /** Lösung anzeigen zählt als nicht gelöst. */
  async solution(userId: string, id: string): Promise<{ moves: string[]; themes: PuzzleTheme[]; rating?: CheckResponse["rating"] }> {
    const p = await this.find(userId, id);
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
    // Mit Tipp gelöst oder schon früher versucht: zählt als Versuch, verändert die Ratings aber nicht.
    const assisted = (win && session.hinted) || this.store.attemptedIds(userId).has(p.id);
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
    return { ...u, puzzles_available: this.source.index.total, own_puzzles: this.store.userPuzzles(userId).length };
  }

  /** Übersicht für Filter: Anzahl je Stufe und Thema (aus dem Index, ohne die Sammlung zu laden). */
  catalog() {
    const { total, difficulties, themes } = this.source.index;
    return { total, difficulties, themes };
  }

  /** Puzzle-Sturm: Puzzles mit steigender Schwierigkeit. Ungewertet, Lösungen werden mitgeschickt. */
  async storm(count = 60): Promise<Puzzle[]> {
    const pool = await this.pool("storm");
    const used = new Set<string>();
    const out: Puzzle[] = [];
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

/** Zufällige Reihenfolge, größere Bänder kommen mit höherer Wahrscheinlichkeit zuerst. */
function weightedOrder(bands: BandInfo[]): BandInfo[] {
  const rest = bands.slice();
  const out: BandInfo[] = [];
  while (rest.length) {
    let r = Math.random() * rest.reduce((s, b) => s + b.count, 0);
    let i = 0;
    while (i < rest.length - 1 && (r -= rest[i]!.count) > 0) i++;
    out.push(rest.splice(i, 1)[0]!);
  }
  return out;
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
