import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameSnapshot } from "@chessy/shared";
import type { Puzzle, PuzzleStat, PuzzleStore, PuzzleUserState } from "@chessy/puzzles";
import type { GameStore, StoredUser } from "../game/ports.ts";

export type { StoredUser };

/** Persistenz in SQLite (eingebautes `node:sqlite`, keine nativen Abhängigkeiten). */
export class Store implements GameStore {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        white_id TEXT,
        black_id TEXT,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS games_white ON games(white_id);
      CREATE INDEX IF NOT EXISTS games_black ON games(black_id);
      CREATE TABLE IF NOT EXISTS puzzle_users (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS puzzle_stats (
        puzzle_id TEXT PRIMARY KEY,
        rating INTEGER NOT NULL,
        plays INTEGER NOT NULL,
        wins INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS puzzle_attempts (
        user_id TEXT NOT NULL,
        puzzle_id TEXT NOT NULL,
        PRIMARY KEY (user_id, puzzle_id)
      );
      CREATE TABLE IF NOT EXISTS user_puzzles (
        user_id TEXT NOT NULL,
        puzzle_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, puzzle_id)
      );
    `);
  }

  createUser(u: StoredUser) {
    this.db
      .prepare("INSERT INTO users (id, username, kind, token, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(u.id, u.username, u.kind, u.token, u.created_at);
  }

  userByToken(token: string): StoredUser | undefined {
    return this.db.prepare("SELECT * FROM users WHERE token = ?").get(token) as StoredUser | undefined;
  }

  userById(id: string): StoredUser | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as StoredUser | undefined;
  }

  usernameTaken(username: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username);
  }

  saveGame(g: GameSnapshot) {
    this.db
      .prepare(
        `INSERT INTO games (id, white_id, black_id, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET white_id = excluded.white_id, black_id = excluded.black_id,
         status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(g.id, g.white.id, g.black.id, g.status, JSON.stringify(g), Date.now());
  }

  loadGame(id: string): GameSnapshot | undefined {
    const row = this.db.prepare("SELECT data FROM games WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as GameSnapshot) : undefined;
  }

  activeGames(): GameSnapshot[] {
    return (this.db.prepare("SELECT data FROM games WHERE status IN ('waiting', 'started')").all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as GameSnapshot,
    );
  }

  gamesOf(userId: string, limit = 50): GameSnapshot[] {
    return (
      this.db
        .prepare("SELECT data FROM games WHERE white_id = ? OR black_id = ? ORDER BY updated_at DESC LIMIT ?")
        .all(userId, userId, limit) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as GameSnapshot);
  }

  close() {
    this.db.close();
  }

  /** Puzzle-Daten (Spieler-Ratings, Puzzle-Ratings, Versuche, Puzzles aus eigenen Partien) in derselben Datenbank. */
  puzzleStore(): PuzzleStore {
    const db = this.db;
    return {
      getUser(userId) {
        const row = db.prepare("SELECT data FROM puzzle_users WHERE user_id = ?").get(userId) as { data: string } | undefined;
        return row ? (JSON.parse(row.data) as PuzzleUserState) : undefined;
      },
      saveUser(state) {
        db.prepare("INSERT INTO puzzle_users (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data").run(
          state.user_id,
          JSON.stringify(state),
        );
        const last = state.history[0];
        if (last) db.prepare("INSERT OR IGNORE INTO puzzle_attempts (user_id, puzzle_id) VALUES (?, ?)").run(state.user_id, last.puzzle_id);
      },
      getStat(id) {
        return db.prepare("SELECT rating, plays, wins FROM puzzle_stats WHERE puzzle_id = ?").get(id) as PuzzleStat | undefined;
      },
      saveStat(id, s) {
        db.prepare(
          "INSERT INTO puzzle_stats (puzzle_id, rating, plays, wins) VALUES (?, ?, ?, ?) ON CONFLICT(puzzle_id) DO UPDATE SET rating = excluded.rating, plays = excluded.plays, wins = excluded.wins",
        ).run(id, s.rating, s.plays, s.wins);
      },
      attemptedIds(userId) {
        return new Set((db.prepare("SELECT puzzle_id FROM puzzle_attempts WHERE user_id = ?").all(userId) as { puzzle_id: string }[]).map((r) => r.puzzle_id));
      },
      userPuzzles(userId) {
        return (db.prepare("SELECT data FROM user_puzzles WHERE user_id = ? ORDER BY created_at DESC").all(userId) as { data: string }[]).map(
          (r) => JSON.parse(r.data) as Puzzle,
        );
      },
      addUserPuzzles(userId, puzzles) {
        const stmt = db.prepare("INSERT OR IGNORE INTO user_puzzles (user_id, puzzle_id, data, created_at) VALUES (?, ?, ?, ?)");
        for (const p of puzzles) stmt.run(userId, p.id, JSON.stringify(p), Date.now());
      },
    };
  }
}
