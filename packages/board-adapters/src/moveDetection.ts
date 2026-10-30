import { Chess } from "chess.js";

/** Nur der Figurenteil der FEN ("rnbqkbnr/pppppppp/…"). */
export const placementOf = (fen: string) => fen.split(" ")[0]!;

/**
 * Erkennt, welcher legale Zug von `fen` aus zur physischen Brettstellung `placement` führt.
 * So funktionieren E-Boards ohne eigene Regel-Logik: Rochade, en passant und Umwandlung (zur Dame,
 * oder zur Figur, die tatsächlich aufs Feld gestellt wurde) werden automatisch erkannt.
 */
export function detectMove(fen: string, placement: string): string | null {
  const chess = new Chess(fen);
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    const match = placementOf(chess.fen()) === placement;
    chess.undo();
    if (match) return m.from + m.to + (m.promotion ?? "");
  }
  return null;
}

/** Unterschiedliche Felder zwischen zwei Stellungen (für Hinweise wie „Figur auf e4 fehlt“). */
export function diffSquares(a: string, b: string): string[] {
  const expand = (p: string) => p.split("/").flatMap((r) => r.replace(/\d/g, (d) => ".".repeat(Number(d))).split(""));
  const x = expand(a);
  const y = expand(b);
  const out: string[] = [];
  for (let i = 0; i < 64; i++) if (x[i] !== y[i]) out.push("abcdefgh"[i % 8]! + (8 - Math.floor(i / 8)));
  return out;
}
