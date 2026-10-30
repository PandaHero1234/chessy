import type { TimeClass } from "./timeControl.ts";

export type Color = "white" | "black";
export const opposite = (c: Color): Color => (c === "white" ? "black" : "white");

/** Engine-Stufen 1 (Einsteiger) bis 8 (Großmeister-Niveau). */
export const AI_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type AiLevel = (typeof AI_LEVELS)[number];

export type GameStatus = "waiting" | "started" | "ended" | "aborted";

/** Ergebnis-Codes wie in der chess.com Public API (pro Spieler). */
export type PlayerResult =
  | "win"
  | "checkmated"
  | "resigned"
  | "timeout"
  | "stalemate"
  | "agreed"
  | "repetition"
  | "insufficient"
  | "50move"
  | "timevsinsufficient"
  | "abandoned"
  | "aborted";

export type Termination =
  | "checkmate"
  | "resign"
  | "timeout"
  | "stalemate"
  | "agreement"
  | "repetition"
  | "insufficient"
  | "50move"
  | "timevsinsufficient"
  | "abandoned"
  | "aborted"
  | "imported";

export type PlayerKind = "human" | "ai" | "local";

export interface PlayerInfo {
  /** Benutzer-ID (null bei KI). */
  id: string | null;
  username: string;
  kind: PlayerKind;
  ai_level?: AiLevel;
  result?: PlayerResult;
}

/** Spiel-Snapshot – Feldnamen orientieren sich an chess.com (`time_control`, `time_class`, `fen`, `pgn`). */
export interface GameSnapshot {
  id: string;
  url: string;
  status: GameStatus;
  rated: false;
  variant: "standard";
  time_control: string;
  time_class: TimeClass;
  white: PlayerInfo;
  black: PlayerInfo;
  initial_fen: string;
  fen: string;
  /** Alle Züge in UCI, durch Leerzeichen getrennt (wie Lichess Board API). */
  moves: string;
  san: string[];
  turn: Color;
  clock: ClockSnapshot | null;
  draw_offer: Color | null;
  takeback_offer: Color | null;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  winner: Color | null;
  termination: Termination | null;
  source: "live" | "import";
  pgn: string;
  created_at: number;
  last_move_at: number | null;
}

export interface ClockSnapshot {
  /** Restzeit in Millisekunden zum Zeitpunkt `at`. */
  white: number;
  black: number;
  increment: number;
  /** Tickt die Uhr der Seite am Zug gerade? */
  running: boolean;
  /** Serverzeit (ms) des Snapshots. */
  at: number;
  /** Daily: Frist pro Zug in ms. */
  per_move?: number;
}

export interface ChatLine {
  username: string;
  text: string;
  at: number;
}

/** Events auf `/games/:id/stream` (NDJSON) bzw. via WebSocket. */
export type GameStreamEvent =
  | { type: "gameFull"; game: GameSnapshot }
  | {
      type: "gameState";
      moves: string;
      fen: string;
      last_move: string | null;
      last_san: string | null;
      status: GameStatus;
      clock: ClockSnapshot | null;
      draw_offer: Color | null;
      takeback_offer: Color | null;
      result: GameSnapshot["result"];
      winner: Color | null;
      termination: Termination | null;
    }
  | { type: "chatLine"; line: ChatLine }
  | { type: "opponentGone"; gone: boolean };

/** Events auf `/stream/events` – betreffen den angemeldeten Account. */
export type AccountEvent =
  | { type: "gameStart"; game: { id: string; color: Color; opponent: string; time_control: string } }
  | { type: "gameFinish"; game: { id: string; result: GameSnapshot["result"] } }
  | { type: "seekRemoved"; seek_id: string };

export interface Seek {
  id: string;
  username: string;
  user_id: string;
  time_control: string;
  time_class: TimeClass;
  color: Color | "random";
  created_at: number;
}

export interface Account {
  id: string;
  username: string;
  kind: "guest" | "bot" | "board";
  created_at: number;
}

export interface AnalysisResult {
  fen: string;
  depth: number;
  bestmove: string | null;
  /** Bewertung aus Sicht von Weiß. */
  eval: { cp: number } | { mate: number };
  pv: string[];
}
