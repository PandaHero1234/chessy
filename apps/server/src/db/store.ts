import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Account, GameSnapshot } from "@chessy/shared";

export interface StoredUser extends Account {
  token: string;
}

/** Persistenz in SQLite (eingebautes `node:sqlite`, keine nativen Abhängigkeiten). */
export class Store {
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
}
