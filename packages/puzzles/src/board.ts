import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export type Side = "w" | "b";
export const other = (c: Side): Side => (c === "w" ? "b" : "w");

/** Materialbilanz aus Sicht von `color`. */
export function materialDiff(chess: Chess, color: Side): number {
  let d = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) d += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return d;
}

/** Anzahl Figuren ohne Könige und Bauern. */
export function pieceCount(chess: Chess): number {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== "k" && sq.type !== "p") n++;
  return n;
}

export function uciToMove(chess: Chess, uci: string): Move {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export const moveToUci = (m: Move) => m.from + m.to + (m.promotion ?? "");

const FILES = "abcdefgh";
export const fileOf = (sq: string) => FILES.indexOf(sq[0]!);
export const rankOf = (sq: string) => Number(sq[1]) - 1;
export const squareAt = (f: number, r: number): Square | null => (f >= 0 && f < 8 && r >= 0 && r < 8 ? ((FILES[f]! + (r + 1)) as Square) : null);

/** Felder entlang eines Strahls ab `from` (exklusiv) in Richtung (df, dr). */
export function* ray(from: string, df: number, dr: number): Generator<Square> {
  let f = fileOf(from) + df;
  let r = rankOf(from) + dr;
  let sq: Square | null;
  while ((sq = squareAt(f, r))) {
    yield sq;
    f += df;
    r += dr;
  }
}

export const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
export const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export function slideDirs(type: PieceSymbol): readonly (readonly [number, number])[] {
  if (type === "r") return ROOK_DIRS;
  if (type === "b") return BISHOP_DIRS;
  if (type === "q") return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}

export function kingSquare(chess: Chess, color: Side): Square | null {
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === "k" && sq.color === color) return sq.square;
  return null;
}

/** Ist die Figur auf `square` von ihrer eigenen Seite gedeckt? */
export const isDefended = (chess: Chess, square: Square, color: Side) => chess.attackers(square, color).length > 0;

/** Billigster Angreifer von `color` auf `square` (Wert), oder null. */
export function cheapestAttacker(chess: Chess, square: Square, color: Side): number | null {
  let best: number | null = null;
  for (const a of chess.attackers(square, color)) {
    const p = chess.get(a);
    if (!p) continue;
    const v = p.type === "k" ? 100 : VALUE[p.type];
    if (best === null || v < best) best = v;
  }
  return best;
}
