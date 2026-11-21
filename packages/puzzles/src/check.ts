import { Chess } from "chess.js";
import type { Puzzle, PuzzlePublic } from "./types.ts";
import { uciToMove } from "./board.ts";

export type CheckResult =
  | { status: "correct"; reply: string; next_index: number }
  | { status: "solved" }
  | { status: "wrong"; expected_index: number };

/** Stellung nach dem vorgespielten Gegnerzug. */
export function startPosition(p: Puzzle): Chess {
  const c = new Chess(p.fen);
  uciToMove(c, p.moves[0]!);
  return c;
}

export const solverMoveCount = (p: Puzzle) => Math.floor(p.moves.length / 2);

export function toPublic(p: Puzzle): PuzzlePublic {
  const solverColor = new Chess(p.fen).turn() === "w" ? "black" : "white";
  return { id: p.id, fen: p.fen, initial_move: p.moves[0]!, color: solverColor, rating: Math.round(p.rating), solver_moves: solverMoveCount(p), source: p.source };
}

/**
 * Prüft die bisherigen Lösungszüge des Spielers (nur seine eigenen Züge, UCI).
 * Wie bei Lichess gilt im letzten Zug jedes Matt als richtig, auch wenn es nicht der hinterlegte Zug ist.
 */
export function checkMoves(p: Puzzle, solverMoves: string[]): CheckResult {
  const chess = startPosition(p);
  const total = solverMoveCount(p);
  for (let i = 0; i < solverMoves.length; i++) {
    const expected = p.moves[1 + 2 * i];
    const played = solverMoves[i]!.toLowerCase();
    if (expected === undefined) return { status: "wrong", expected_index: i };
    let ok = played === expected;
    if (!ok && i === total - 1) {
      try {
        const probe = new Chess(chess.fen());
        uciToMove(probe, played);
        ok = probe.isCheckmate();
      } catch {
        ok = false;
      }
    }
    if (!ok) return { status: "wrong", expected_index: i };
    if (i === total - 1) return { status: "solved" };
    uciToMove(chess, expected);
    if (i === solverMoves.length - 1) {
      const reply = p.moves[2 + 2 * i]!;
      return { status: "correct", reply, next_index: i + 1 };
    }
    uciToMove(chess, p.moves[2 + 2 * i]!);
  }
  return { status: "correct", reply: "", next_index: 0 };
}

/** Startfeld des nächsten Lösungszugs (für Tipps). */
export function hintSquare(p: Puzzle, solvedSoFar: number): string | null {
  return p.moves[1 + 2 * solvedSoFar]?.slice(0, 2) ?? null;
}
