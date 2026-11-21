import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameSnapshot } from "@chessy/shared";
import type { Puzzle, PuzzleStat, PuzzleStore, PuzzleUserState } from "@chessy/puzzles";
import type { GameStore, StoredUser } from "../game/ports.ts";

export type { StoredUser };

/** Spalten eines Kontos ohne Passwort-Hash (der verlässt die Datenbankschicht nur über credentialsByUsername). */
const USER_COLS = "id, username, kind, token, created_at";

const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");

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
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    `);
    // Spalte für Passwort-Hashes nachrüsten (ältere Datenbanken haben sie noch nicht).
    const cols = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "password_hash")) this.db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }

  createUser(u: StoredUser) {
    this.db
      .prepare("INSERT INTO users (id, username, kind, token, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(u.id, u.username, u.kind, u.token, u.created_at);
  }

  /** Gast-, Bot- und Board-Tokens stehen direkt am Konto; Anmelde-Sitzungen nur als SHA-256-Hash in `sessions`. */
  userByToken(token: string): StoredUser | undefined {
    const direct = this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE token = ?`).get(token) as StoredUser | undefined;
    if (direct) return direct;
    const hash = sessionHash(token);
    const viaSession = this.db
      .prepare(`SELECT ${USER_COLS.split(", ").map((c) => `u.${c}`).join(", ")} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(hash) as StoredUser | undefined;
    if (viaSession) this.db.prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").run(Date.now(), hash);
    return viaSession;
  }

  userById(id: string): StoredUser | undefined {
    return this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as StoredUser | undefined;
  }

  // ---------------------------------------------------------------- Anmeldung

  credentialsByUsername(username: string): { user: StoredUser; passwordHash: string | null } | undefined {
    const row = this.db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ? COLLATE NOCASE`).get(username) as
      | (StoredUser & { password_hash: string | null })
      | undefined;
    if (!row) return undefined;
    const { password_hash, ...user } = row;
    return { user, passwordHash: password_hash };
  }

  passwordHashOf(userId: string): string | null {
    return (this.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string | null } | undefined)?.password_hash ?? null;
  }

  /** Macht aus einem Gast ein angemeldetes Konto. Das alte Gast-Token wird dabei ungültig. */
  upgradeToUser(userId: string, username: string, passwordHash: string, newDeviceToken: string) {
    this.db.prepare("UPDATE users SET username = ?, kind = 'user', password_hash = ?, token = ? WHERE id = ?").run(username, passwordHash, newDeviceToken, userId);
  }

  setPasswordHash(userId: string, passwordHash: string) {
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  }

  createSession(userId: string, token: string) {
    const now = Date.now();
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)").run(sessionHash(token), userId, now, now);
  }

  /** Entfernt eine Sitzung; gibt zurück, ob es eine war. */
  deleteSession(token: string): boolean {
    return Number(this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token)).changes) > 0;
  }

  /** Entfernt alle Sitzungen eines Kontos außer `keepToken`. */
  deleteSessionsOf(userId: string, keepToken?: string): number {
    const keep = keepToken ? sessionHash(keepToken) : "";
    return Number(this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, keep).changes);
  }

  sessionCount(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId) as { n: number }).n;
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
