import { Chess } from "chess.js";

const DE: Record<string, string> = { N: "S", B: "L", R: "T", Q: "D", K: "K" };

/** SAN mit deutschen Figurenbuchstaben: Nf3 → Sf3, Qxf7# → Dxf7#, e8=Q → e8=D. */
export const sanDe = (san: string) => san.replace(/[NBRQ]/g, (c) => DE[c]!);

export interface LineStep {
  /** Stellung nach dem Zug. */
  fen: string;
  uci: string;
  san: string;
  /** Zugnummer und ob Weiß gezogen hat (für „12.“ bzw. „12…“). */
  number: number;
  white: boolean;
}

/** Spielt eine UCI-Zugfolge nach und liefert Stellungen und deutsche Notation je Zug. */
export function buildLine(fen: string, moves: string[]): LineStep[] {
  const c = new Chess(fen);
  const out: LineStep[] = [];
  for (const uci of moves) {
    const white = c.turn() === "w";
    const number = c.moveNumber();
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    out.push({ fen: c.fen(), uci, san: sanDe(m.san), number, white });
  }
  return out;
}
