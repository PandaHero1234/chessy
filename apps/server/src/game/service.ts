import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { Chess, DEFAULT_POSITION } from "chess.js";
import {
  type AccountEvent,
  type AiLevel,
  type Color,
  type GameSnapshot,
  type GameStreamEvent,
  type ChatLine,
  type PlayerInfo,
  type Seek,
  type TimeControl,
  formatTimeControl,
  opposite,
  parseTimeControl,
  timeClassOf,
} from "@chessy/shared";
import { Game, MoveRejected, parseMoveInput } from "./game.ts";
import { Clock } from "./clock.ts";
import type { Engine } from "../ai/stockfish.ts";
import type { Store, StoredUser } from "../db/store.ts";

export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export type Opponent = { type: "ai"; level: AiLevel } | { type: "local" } | { type: "friend" };

export interface CreateGameInput {
  opponent: Opponent;
  time_control: string | TimeControl;
  color?: Color | "random";
  fen?: string;
}

/** Nach so vielen ms ohne ersten Zug wird eine Online-Partie abgebrochen. */
const FIRST_MOVE_TIMEOUT_MS = 60_000;

export const newId = (bytes = 6) => randomBytes(bytes).toString("base64url");

/**
 * Zentrale Spiellogik + Event-Bus. Transporte (REST, NDJSON, WebSocket) hängen sich nur an die Events.
 * Event-Namen: `game:<id>` → GameStreamEvent, `user:<id>` → AccountEvent.
 */
export class GameService {
  readonly events = new EventEmitter();
  private games = new Map<string, Game>();
  private chats = new Map<string, ChatLine[]>();
  private seeks = new Map<string, Seek>();
  private timers = new Map<string, NodeJS.Timeout>();
  private aiThinking = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly engine: Engine,
    private readonly now: () => number = Date.now,
  ) {
    this.events.setMaxListeners(0);
    for (const snap of store.activeGames()) this.restore(snap);
  }

  // ---------------------------------------------------------------- Accounts

  createAccount(kind: StoredUser["kind"], requestedName?: string): StoredUser {
    let username = sanitizeName(requestedName) ?? `${kind === "guest" ? "Gast" : kind === "bot" ? "Bot" : "Board"}-${randomBytes(2).toString("hex")}`;
    if (kind === "bot" && !username.toLowerCase().includes("bot")) username = `${username}-BOT`;
    while (this.store.usernameTaken(username)) username = `${username.replace(/-\w{4}$/, "")}-${randomBytes(2).toString("hex")}`;
    const user: StoredUser = {
      id: newId(8),
      username,
      kind,
      token: `chy_${randomBytes(24).toString("base64url")}`,
      created_at: this.now(),
    };
    this.store.createUser(user);
    return user;
  }

  authenticate(token: string | undefined): StoredUser | undefined {
    return token ? this.store.userByToken(token) : undefined;
  }

  // ---------------------------------------------------------------- Partien

  createGame(user: StoredUser, input: CreateGameInput): GameSnapshot {
    const tc = this.parseTc(input.time_control);
    const fen = input.fen ? validateFen(input.fen) : DEFAULT_POSITION;
    const me: PlayerInfo = { id: user.id, username: user.username, kind: "human" };
    let color: Color = input.color === "white" || input.color === "black" ? input.color : Math.random() < 0.5 ? "white" : "black";
    let other: PlayerInfo;
    let waiting = false;
    switch (input.opponent.type) {
      case "ai":
        if (!(input.opponent.level >= 1 && input.opponent.level <= 8)) throw new ApiError(400, "invalid_level", "Stufe muss 1–8 sein");
        other = { id: null, username: `Stockfish Stufe ${input.opponent.level}`, kind: "ai", ai_level: input.opponent.level };
        break;
      case "local":
        color = "white";
        me.kind = "local";
        other = { id: user.id, username: `${user.username} (2)`, kind: "local" };
        break;
      case "friend":
        other = { id: null, username: "?", kind: "human" };
        waiting = true;
        break;
      default:
        throw new ApiError(400, "invalid_opponent", "Unbekannter Gegnertyp");
    }
    const players = color === "white" ? { white: me, black: other } : { white: other, black: me };
    const game = new Game(newId(), players, tc, this.now(), fen, waiting);
    this.register(game);
    if (!waiting) this.onStarted(game);
    return this.snapshot(game);
  }

  /** Einladungslink annehmen: freier Platz in einer wartenden Partie. */
  joinGame(user: StoredUser, id: string): GameSnapshot {
    const game = this.get(id);
    if (game.status !== "waiting") throw new ApiError(409, "not_joinable", "Partie ist nicht mehr offen");
    const free = game.players.white.id === null ? "white" : "black";
    if (game.players[opposite(free)].id === user.id) throw new ApiError(409, "own_game", "Du kannst nicht gegen dich selbst antreten");
    game.players[free] = { id: user.id, username: user.username, kind: "human" };
    game.start(this.now());
    this.onStarted(game);
    return this.snapshot(game);
  }

  getSnapshot(id: string): GameSnapshot {
    const live = this.games.get(id);
    if (live) return this.snapshot(live);
    const stored = this.store.loadGame(id);
    if (!stored) throw new ApiError(404, "not_found", "Partie nicht gefunden");
    return stored;
  }

  listGames(user: StoredUser): GameSnapshot[] {
    return this.store.gamesOf(user.id).map((g) => (this.games.has(g.id) ? this.snapshot(this.games.get(g.id)!) : g));
  }

  chat(id: string) {
    return this.chats.get(id) ?? [];
  }

  move(user: StoredUser, id: string, uci: string, lagMs = 0): GameSnapshot {
    const game = this.get(id);
    const color = game.turn;
    if (!game.controls(user.id, color)) {
      const plays = game.controls(user.id, opposite(color));
      throw new ApiError(plays ? 409 : 403, plays ? "not_your_turn" : "not_a_player", plays ? "Du bist nicht am Zug" : "Du spielst in dieser Partie nicht mit");
    }
    this.applyMove(game, color, uci, lagMs);
    return this.snapshot(game);
  }

  resign(user: StoredUser, id: string) {
    const game = this.get(id);
    const color = this.playerColor(game, user);
    if (game.isOver) throw new ApiError(409, "game_over", "Partie ist bereits beendet");
    if (game.status === "waiting") return this.abort(user, id);
    game.finish("resign", opposite(color), this.now());
    this.afterChange(game);
    return this.snapshot(game);
  }

  abort(user: StoredUser, id: string) {
    const game = this.get(id);
    const color = this.playerColor(game, user);
    if (game.status !== "waiting" && !game.canAbort(color)) throw new ApiError(409, "cannot_abort", "Abbruch nur vor dem ersten Zug möglich");
    game.finish("aborted", null, this.now());
    this.afterChange(game);
    return this.snapshot(game);
  }

  draw(user: StoredUser, id: string, action: "offer" | "accept" | "decline") {
    const game = this.get(id);
    const color = this.playerColor(game, user);
    if (game.status !== "started") throw new ApiError(409, "game_not_running", "Partie läuft nicht");
    if (action === "offer" || (action === "accept" && game.drawOffer === null)) {
      if (game.drawOffer === opposite(color) || game.isLocal()) game.finish("agreement", null, this.now());
      else if (this.isAi(game, opposite(color))) this.aiConsiderDraw(game, color);
      else game.drawOffer = color;
    } else if (action === "accept") {
      if (game.drawOffer === color) throw new ApiError(409, "own_offer", "Eigenes Angebot kann nicht angenommen werden");
      game.finish("agreement", null, this.now());
    } else {
      if (game.drawOffer === opposite(color)) game.drawOffer = null;
    }
    this.afterChange(game);
    return this.snapshot(game);
  }

  takeback(user: StoredUser, id: string, action: "offer" | "accept" | "decline") {
    const game = this.get(id);
    const color = this.playerColor(game, user);
    if (game.status !== "started") throw new ApiError(409, "game_not_running", "Partie läuft nicht");
    if (game.uci.length === 0) throw new ApiError(409, "nothing_to_undo", "Noch keine Züge");
    if (game.isLocal()) {
      game.undo(1);
    } else if (this.isAi(game, opposite(color))) {
      // Gegen den Computer werden Rücknahmen sofort gewährt: zurück bis der Mensch wieder am Zug ist.
      if (this.aiThinking.has(game.id)) throw new ApiError(409, "ai_thinking", "Der Computer denkt gerade nach");
      game.undo(game.turn === color ? 2 : 1);
    } else if (action === "offer") {
      if (game.takebackOffer === opposite(color)) game.undo(game.turn === opposite(color) ? 1 : 2);
      else game.takebackOffer = color;
    } else if (action === "accept" && game.takebackOffer === opposite(color)) {
      // Zurück bis der Antragsteller wieder am Zug ist.
      game.undo(game.turn === opposite(color) ? 2 : 1);
    } else if (action === "decline" && game.takebackOffer === opposite(color)) {
      game.takebackOffer = null;
    }
    this.afterChange(game);
    return this.snapshot(game);
  }

  sendChat(user: StoredUser, id: string, text: string) {
    const game = this.get(id);
    this.playerColor(game, user);
    const clean = text.trim().slice(0, 300);
    if (!clean) throw new ApiError(400, "empty", "Leere Nachricht");
    const line: ChatLine = { username: user.username, text: clean, at: this.now() };
    const lines = this.chats.get(id) ?? [];
    lines.push(line);
    if (lines.length > 200) lines.shift();
    this.chats.set(id, lines);
    this.emitGame(id, { type: "chatLine", line });
  }

  /** PGN importieren (z. B. aus der chess.com Public API) → beendete, nachspielbare Partie. */
  importPgn(user: StoredUser, pgn: string): GameSnapshot {
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
    } catch (e) {
      throw new ApiError(400, "invalid_pgn", `PGN konnte nicht gelesen werden: ${(e as Error).message}`);
    }
    const headers = Object.fromEntries(Object.entries(chess.getHeaders()).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const tc = (() => {
      try {
        return parseTimeControl(headers.TimeControl ?? "-");
      } catch {
        return { type: "unlimited" } as const;
      }
    })();
    const initialFen = headers.FEN ?? DEFAULT_POSITION;
    const game = new Game(
      newId(),
      {
        white: { id: user.id, username: headers.White ?? "Weiß", kind: "human" },
        black: { id: user.id, username: headers.Black ?? "Schwarz", kind: "human" },
      },
      tc,
      this.now(),
      initialFen,
    );
    game.source = "import";
    game.headers = headers;
    game.clock = null;
    for (const m of chess.history({ verbose: true })) {
      game.chess.move(m.san);
      game.uci.push(m.from + m.to + (m.promotion ?? ""));
    }
    const res = headers.Result;
    game.status = "ended";
    game.termination = "imported";
    game.winner = res === "1-0" ? "white" : res === "0-1" ? "black" : null;
    this.store.saveGame(this.snapshot(game));
    return this.snapshot(game);
  }

  // ---------------------------------------------------------------- Lobby

  listSeeks(): Seek[] {
    return [...this.seeks.values()].sort((a, b) => a.created_at - b.created_at);
  }

  /** Erstellt ein Gesuch oder paart sofort mit einem passenden offenen Gesuch. */
  seek(user: StoredUser, timeControl: string | TimeControl, color: Color | "random" = "random"): { seek?: Seek; game?: GameSnapshot } {
    const tc = this.parseTc(timeControl);
    const tcStr = formatTimeControl(tc);
    const match = this.listSeeks().find(
      (s) => s.user_id !== user.id && s.time_control === tcStr && (s.color === "random" || color === "random" || s.color !== color),
    );
    if (match) {
      this.removeSeek(match.id);
      const owner = this.store.userById(match.user_id)!;
      const ownerColor: Color =
        match.color !== "random" ? match.color : color !== "random" ? opposite(color) : Math.random() < 0.5 ? "white" : "black";
      const a: PlayerInfo = { id: owner.id, username: owner.username, kind: "human" };
      const b: PlayerInfo = { id: user.id, username: user.username, kind: "human" };
      const game = new Game(newId(), ownerColor === "white" ? { white: a, black: b } : { white: b, black: a }, tc, this.now());
      this.register(game);
      this.onStarted(game);
      return { game: this.snapshot(game) };
    }
    for (const s of this.seeks.values()) if (s.user_id === user.id && s.time_control === tcStr) return { seek: s };
    const seek: Seek = {
      id: newId(),
      username: user.username,
      user_id: user.id,
      time_control: tcStr,
      time_class: timeClassOf(tc),
      color,
      created_at: this.now(),
    };
    this.seeks.set(seek.id, seek);
    this.events.emit("lobby", { type: "seekAdded", seek });
    return { seek };
  }

  cancelSeek(user: StoredUser, id: string) {
    const s = this.seeks.get(id);
    if (!s) throw new ApiError(404, "not_found", "Gesuch nicht gefunden");
    if (s.user_id !== user.id) throw new ApiError(403, "forbidden", "Nicht dein Gesuch");
    this.removeSeek(id);
  }

  private removeSeek(id: string) {
    const s = this.seeks.get(id);
    if (!s) return;
    this.seeks.delete(id);
    this.events.emit("lobby", { type: "seekRemoved", seek_id: id });
    this.emitUser(s.user_id, { type: "seekRemoved", seek_id: id });
  }

  // ---------------------------------------------------------------- Intern

  private parseTc(input: string | TimeControl): TimeControl {
    try {
      return parseTimeControl(input);
    } catch (e) {
      throw new ApiError(400, "invalid_time_control", (e as Error).message);
    }
  }

  private get(id: string): Game {
    const g = this.games.get(id);
    if (g) return g;
    if (this.store.loadGame(id)) throw new ApiError(409, "game_over", "Partie ist bereits beendet");
    throw new ApiError(404, "not_found", "Partie nicht gefunden");
  }

  private playerColor(game: Game, user: StoredUser): Color {
    if (game.controls(user.id, game.turn)) return game.turn;
    if (game.controls(user.id, opposite(game.turn))) return opposite(game.turn);
    throw new ApiError(403, "not_a_player", "Du spielst in dieser Partie nicht mit");
  }

  private isAi(game: Game, color: Color) {
    return game.players[color].kind === "ai";
  }

  private snapshot(game: Game): GameSnapshot {
    return game.snapshot(this.now());
  }

  private register(game: Game) {
    this.games.set(game.id, game);
    this.store.saveGame(this.snapshot(game));
  }

  private onStarted(game: Game) {
    this.store.saveGame(this.snapshot(game));
    for (const color of ["white", "black"] as const) {
      const p = game.players[color];
      if (p.kind === "ai" || !p.id || (p.kind === "local" && color === "black")) continue;
      this.emitUser(p.id, {
        type: "gameStart",
        game: { id: game.id, color, opponent: game.players[opposite(color)].username, time_control: formatTimeControl(game.timeControl) },
      });
    }
    this.emitGame(game.id, { type: "gameFull", game: this.snapshot(game) });
    this.schedule(game);
  }

  private applyMove(game: Game, color: Color, input: string, lagMs = 0) {
    try {
      game.move(color, input, this.now(), lagMs);
    } catch (e) {
      if (e instanceof MoveRejected) {
        if (e.code === "game_over") this.afterChange(game);
        throw new ApiError(e.code === "illegal_move" ? 400 : 409, e.code, e.message);
      }
      throw e;
    }
    this.afterChange(game);
  }

  /** Persistiert, verteilt den neuen Zustand und plant Timer/KI-Züge. */
  private afterChange(game: Game) {
    const snap = this.snapshot(game);
    this.store.saveGame(snap);
    this.emitGame(game.id, toState(snap));
    if (game.isOver) {
      this.clearTimer(game.id);
      for (const p of [game.players.white, game.players.black]) {
        if (p.id && p.kind !== "ai") this.emitUser(p.id, { type: "gameFinish", game: { id: game.id, result: snap.result } });
      }
      // Beendete Partien bleiben noch kurz im Speicher (Chat, Rematch), danach nur noch in der DB.
      setTimeout(() => this.games.get(game.id)?.isOver && this.games.delete(game.id), 10 * 60_000).unref();
      return;
    }
    this.schedule(game);
  }

  private schedule(game: Game) {
    this.clearTimer(game.id);
    if (game.isOver) return;
    const now = this.now();
    if (game.clock?.running) {
      const left = game.clock.timeLeft(game.turn, now);
      this.setTimer(game.id, left + 50, () => {
        if (game.checkFlag(this.now())) this.afterChange(game);
        else this.schedule(game);
      });
    } else if (game.status === "started" && !game.isLocal() && game.timeControl.type === "realtime" && game.uci.length < 2 && !this.isAi(game, game.turn)) {
      const ref = game.lastMoveAt ?? game.createdAt;
      this.setTimer(game.id, Math.max(0, ref + FIRST_MOVE_TIMEOUT_MS - now), () => {
        if (!game.isOver && game.uci.length < 2) {
          game.finish("aborted", null, this.now());
          this.afterChange(game);
        }
      });
    }
    if (game.status === "started" && this.isAi(game, game.turn)) void this.playAi(game);
  }

  private async playAi(game: Game) {
    if (this.aiThinking.has(game.id)) return;
    this.aiThinking.add(game.id);
    const color = game.turn;
    const ply = game.uci.length;
    try {
      const level = game.players[color].ai_level ?? 4;
      const timeLeft = game.clock && game.clock.perMove === null ? game.clock.timeLeft(color, this.now()) : null;
      const started = this.now();
      const best = await this.engine.bestMove({
        initialFen: game.initialFen,
        moves: [...game.uci],
        level,
        timeLeft,
        increment: game.clock?.increment ?? 0,
      });
      // Etwas "Bedenkzeit", damit Züge auf niedrigen Stufen nicht unnatürlich sofort kommen.
      const minDelay = timeLeft !== null && timeLeft < 20_000 ? 0 : 350;
      const wait = Math.max(0, minDelay - (this.now() - started));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (game.isOver || game.turn !== color || game.uci.length !== ply) return;
      this.applyMove(game, color, best);
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(`[ai] ${game.id}:`, e);
    } finally {
      this.aiThinking.delete(game.id);
    }
  }

  /** Die KI nimmt Remis an, wenn die Stellung ausgeglichen oder für sie schlecht ist. */
  private aiConsiderDraw(game: Game, offeredBy: Color) {
    void this.engine
      .analyse(game.chess.fen(), 10)
      .then((a) => {
        if (game.isOver) return;
        const aiSign = offeredBy === "white" ? -1 : 1; // Bewertung aus Sicht der KI
        const score = "cp" in a.eval ? a.eval.cp * aiSign : a.eval.mate * aiSign > 0 ? 10_000 : -10_000;
        if (score <= 30 && game.uci.length >= 20) {
          game.finish("agreement", null, this.now());
          this.afterChange(game);
        } else {
          this.sendSystemChat(game.id, `${game.players[opposite(offeredBy)].username} lehnt das Remis ab.`);
        }
      })
      .catch(() => undefined);
  }

  private sendSystemChat(id: string, text: string) {
    const line: ChatLine = { username: "System", text, at: this.now() };
    this.chats.set(id, [...(this.chats.get(id) ?? []), line]);
    this.emitGame(id, { type: "chatLine", line });
  }

  private setTimer(id: string, ms: number, fn: () => void) {
    const t = setTimeout(fn, Math.min(ms, 2 ** 31 - 1));
    t.unref();
    this.timers.set(id, t);
  }

  private clearTimer(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private emitGame(id: string, e: GameStreamEvent) {
    this.events.emit(`game:${id}`, e);
  }

  private emitUser(id: string, e: AccountEvent) {
    this.events.emit(`user:${id}`, e);
  }

  /** Nach Neustart: laufende Partien wiederherstellen. */
  private restore(snap: GameSnapshot) {
    const tc = parseTimeControl(snap.time_control);
    const game = new Game(snap.id, { white: snap.white, black: snap.black }, tc, snap.created_at, snap.initial_fen, snap.status === "waiting");
    for (const m of snap.moves.split(" ").filter(Boolean)) {
      game.chess.move(parseMoveInput(m));
      game.uci.push(m);
    }
    game.lastMoveAt = snap.last_move_at;
    if (tc.type !== "unlimited" && snap.clock) game.clock = Clock.restore(tc, snap.clock, game.turn, this.now());
    this.games.set(game.id, game);
    this.schedule(game);
  }

  /** Für Tests und sauberes Herunterfahren. */
  shutdown() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

function toState(s: GameSnapshot): GameStreamEvent {
  const moves = s.moves.split(" ").filter(Boolean);
  return {
    type: "gameState",
    moves: s.moves,
    fen: s.fen,
    last_move: moves[moves.length - 1] ?? null,
    last_san: s.san[s.san.length - 1] ?? null,
    status: s.status,
    clock: s.clock,
    draw_offer: s.draw_offer,
    takeback_offer: s.takeback_offer,
    result: s.result,
    winner: s.winner,
    termination: s.termination,
  };
}

function sanitizeName(name?: string): string | undefined {
  const n = name?.trim().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 20);
  return n && n.length >= 3 ? n : undefined;
}

function validateFen(fen: string): string {
  try {
    return new Chess(fen).fen();
  } catch {
    throw new ApiError(400, "invalid_fen", "Ungültige FEN");
  }
}
