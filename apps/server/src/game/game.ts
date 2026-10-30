import { Chess, DEFAULT_POSITION, type Move } from "chess.js";
import {
  type Color,
  type GameSnapshot,
  type GameStatus,
  type PlayerInfo,
  type PlayerResult,
  type Termination,
  type TimeControl,
  formatTimeControl,
  opposite,
  timeClassOf,
} from "@chessy/shared";
import { Clock } from "./clock.ts";

export interface Players {
  white: PlayerInfo;
  black: PlayerInfo;
}

export type MoveError = "not_your_turn" | "illegal_move" | "game_not_started" | "game_over";

export class MoveRejected extends Error {
  constructor(readonly code: MoveError, message: string) {
    super(message);
  }
}

const RESULT_BY_TERMINATION: Record<Termination, { loser: PlayerResult; winner: PlayerResult } | PlayerResult> = {
  checkmate: { loser: "checkmated", winner: "win" },
  resign: { loser: "resigned", winner: "win" },
  timeout: { loser: "timeout", winner: "win" },
  abandoned: { loser: "abandoned", winner: "win" },
  stalemate: "stalemate",
  agreement: "agreed",
  repetition: "repetition",
  insufficient: "insufficient",
  "50move": "50move",
  timevsinsufficient: "timevsinsufficient",
  aborted: "aborted",
  imported: "agreed",
};

/** Eine Partie: Regeln (chess.js), Uhr, Angebote und Ergebnis. Reine Logik ohne I/O. */
export class Game {
  readonly chess: Chess;
  readonly uci: string[] = [];
  status: GameStatus;
  winner: Color | null = null;
  termination: Termination | null = null;
  drawOffer: Color | null = null;
  takebackOffer: Color | null = null;
  clock: Clock | null;
  lastMoveAt: number | null = null;
  source: "live" | "import" = "live";
  /** Für importierte Partien: PGN-Header (Event, Site, Spieler …). */
  headers: Record<string, string> = {};

  constructor(
    readonly id: string,
    readonly players: Players,
    readonly timeControl: TimeControl,
    readonly createdAt: number,
    readonly initialFen: string = DEFAULT_POSITION,
    waiting = false,
  ) {
    this.chess = new Chess(initialFen);
    this.status = waiting ? "waiting" : "started";
    this.clock = timeControl.type === "unlimited" ? null : new Clock(timeControl);
  }

  get turn(): Color {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  get isOver() {
    return this.status === "ended" || this.status === "aborted";
  }

  /** Abbruch ist nur vor dem jeweils ersten eigenen Zug möglich. */
  canAbort(color: Color) {
    const plies = this.uci.length;
    return !this.isOver && (plies === 0 || (plies === 1 && color === "black"));
  }

  /** Wer darf als `color` ziehen? Bei lokalen Partien steuert ein Account beide Seiten. */
  controls(userId: string, color: Color) {
    const p = this.players[color];
    return p.kind !== "ai" && p.id === userId;
  }

  isLocal() {
    return this.players.white.kind === "local";
  }

  start(now: number) {
    this.status = "started";
    this.lastMoveAt = now;
  }

  /** Führt einen Zug (UCI wie `e2e4`/`e7e8q` oder SAN wie `Nf3`) für `color` aus. */
  move(color: Color, input: string, now: number, lagMs = 0): Move {
    if (this.isOver) throw new MoveRejected("game_over", "Die Partie ist beendet");
    if (this.status !== "started") throw new MoveRejected("game_not_started", "Die Partie hat noch nicht begonnen");
    if (color !== this.turn) throw new MoveRejected("not_your_turn", "Du bist nicht am Zug");
    let move: Move;
    try {
      move = this.chess.move(parseMoveInput(input));
    } catch {
      throw new MoveRejected("illegal_move", `Ungültiger Zug: ${input}`);
    }
    if (this.clock && !this.clock.press(color, now, lagMs)) {
      this.chess.undo();
      this.flagFall(color, now);
      throw new MoveRejected("game_over", "Zeit abgelaufen");
    }
    this.uci.push(move.from + move.to + (move.promotion ?? ""));
    this.lastMoveAt = now;
    this.drawOffer = this.drawOffer === color ? color : null;
    this.takebackOffer = null;
    if (this.clock && !this.clock.running && this.uci.length >= 2) this.clock.start(now);
    this.checkNaturalEnd(now);
    return move;
  }

  private checkNaturalEnd(now: number) {
    const c = this.chess;
    if (c.isCheckmate()) this.finish("checkmate", opposite(this.turn), now);
    else if (c.isStalemate()) this.finish("stalemate", null, now);
    else if (c.isInsufficientMaterial()) this.finish("insufficient", null, now);
    else if (c.isThreefoldRepetition()) this.finish("repetition", null, now);
    else if (c.isDrawByFiftyMoves()) this.finish("50move", null, now);
  }

  /** Prüft Zeitüberschreitung; gibt true zurück, wenn die Partie dadurch endet. */
  checkFlag(now: number): boolean {
    if (this.isOver || !this.clock) return false;
    const flagged = this.clock.flagged(now);
    if (!flagged) return false;
    this.flagFall(flagged, now);
    return true;
  }

  private flagFall(flagged: Color, now: number) {
    const winner = opposite(flagged);
    if (hasMatingMaterial(this.chess, winner)) this.finish("timeout", winner, now);
    else this.finish("timevsinsufficient", null, now);
  }

  finish(termination: Termination, winner: Color | null, now: number) {
    if (this.isOver) return;
    this.clock?.stop(now);
    this.status = termination === "aborted" ? "aborted" : "ended";
    this.termination = termination;
    this.winner = winner;
    this.drawOffer = null;
    this.takebackOffer = null;
    const r = RESULT_BY_TERMINATION[termination];
    for (const color of ["white", "black"] as const) {
      this.players[color].result = typeof r === "string" ? r : color === winner ? r.winner : r.loser;
    }
  }

  /** Nimmt `plies` Halbzüge zurück. */
  undo(plies: number) {
    for (let i = 0; i < plies && this.uci.length > 0; i++) {
      this.chess.undo();
      this.uci.pop();
    }
    if (this.clock) {
      this.clock.turn = this.turn;
      if (this.clock.running) this.clock.turnStartedAt = Date.now();
    }
    this.takebackOffer = null;
    this.drawOffer = null;
  }

  get result(): GameSnapshot["result"] {
    if (this.status !== "ended") return "*";
    if (this.winner === "white") return "1-0";
    if (this.winner === "black") return "0-1";
    return "1/2-1/2";
  }

  pgn(baseUrl = ""): string {
    const c = new Chess(this.initialFen);
    for (const m of this.uci) c.move(parseMoveInput(m));
    const d = new Date(this.createdAt);
    const date = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
    const headers: Record<string, string> = {
      Event: this.source === "import" ? (this.headers.Event ?? "Import") : "Chessy Partie",
      Site: this.headers.Site ?? `${baseUrl}/game/${this.id}`,
      Date: this.headers.Date ?? date,
      White: this.players.white.username,
      Black: this.players.black.username,
      Result: this.source === "import" ? (this.headers.Result ?? this.result) : this.result,
      TimeControl: formatTimeControl(this.timeControl),
      ...(this.initialFen !== DEFAULT_POSITION ? { SetUp: "1", FEN: this.initialFen } : {}),
      ...(this.termination && this.source === "live" ? { Termination: this.termination } : {}),
    };
    for (const [k, v] of Object.entries(headers)) c.setHeader(k, v);
    return c.pgn();
  }

  snapshot(now: number, baseUrl = ""): GameSnapshot {
    const history = this.chess.history();
    return {
      id: this.id,
      url: `${baseUrl}/game/${this.id}`,
      status: this.status,
      rated: false,
      variant: "standard",
      time_control: formatTimeControl(this.timeControl),
      time_class: timeClassOf(this.timeControl),
      white: { ...this.players.white },
      black: { ...this.players.black },
      initial_fen: this.initialFen,
      fen: this.chess.fen(),
      moves: this.uci.join(" "),
      san: history,
      turn: this.turn,
      clock: this.clock?.snapshot(now) ?? null,
      draw_offer: this.drawOffer,
      takeback_offer: this.takebackOffer,
      result: this.source === "import" ? ((this.headers.Result as GameSnapshot["result"]) ?? this.result) : this.result,
      winner: this.winner,
      termination: this.termination,
      source: this.source,
      pgn: this.pgn(baseUrl),
      created_at: this.createdAt,
      last_move_at: this.lastMoveAt,
    };
  }
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function parseMoveInput(input: string): string | { from: string; to: string; promotion?: string } {
  const m = UCI_RE.exec(input.trim().toLowerCase());
  if (m) return { from: m[1]!, to: m[2]!, ...(m[3] ? { promotion: m[3] } : {}) };
  return input.trim();
}

/** Kann `color` theoretisch noch mattsetzen? (FIDE-Regel für Zeitüberschreitung) */
export function hasMatingMaterial(chess: Chess, color: Color): boolean {
  const c = color === "white" ? "w" : "b";
  let minors = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== c) continue;
      if (sq.type === "p" || sq.type === "q" || sq.type === "r") return true;
      if (sq.type === "b" || sq.type === "n") minors++;
    }
  }
  return minors >= 2 || (minors === 1 && chess.board().flat().some((s) => s && s.color !== c && s.type !== "k"));
}
