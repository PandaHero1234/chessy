import { Chess, type Move, type Square } from "chess.js";
import { winningChances, type Score } from "@chessy/shared";
import type { PuzzleTheme } from "./types.ts";
import { VALUE, cheapestAttacker, fileOf, isDefended, kingSquare, other, pieceCount, rankOf, ray, slideDirs, squareAt, uciToMove, type Side } from "./board.ts";

/**
 * Regelbasierte Themen-Erkennung: Die Lösung wird Zug für Zug auf dem Brett nachgespielt und auf
 * Muster geprüft (Gabel, Fesselung, Abzug, Mattbilder …). Keine Heuristik aus Daten, nur Schachregeln.
 */
export function detectThemes(fen: string, moves: string[], finalScore: Score): { themes: PuzzleTheme[]; sacrifices: number } {
  const themes = new Set<PuzzleTheme>();
  const chess = new Chess(fen);
  uciToMove(chess, moves[0]!);
  const solver: Side = chess.turn();
  const solverMoves: Move[] = [];
  let sacrifices = 0;
  const plyStart = (Number(fen.split(" ")[5]) - 1) * 2;

  const verbose: { move: Move; before: Chess; after: Chess }[] = [];
  for (let i = 1; i < moves.length; i++) {
    const before = new Chess(chess.fen());
    const m = uciToMove(chess, moves[i]!);
    if (i % 2 === 1) {
      solverMoves.push(m);
      verbose.push({ move: m, before, after: new Chess(chess.fen()) });
    }
  }

  const n = solverMoves.length;
  themes.add(n === 1 ? "oneMove" : n === 2 ? "short" : n === 3 ? "long" : "veryLong");

  // Matt-Themen
  if (chess.isCheckmate()) {
    themes.add("mate");
    themes.add(n >= 5 ? "mateIn5" : (`mateIn${n}` as PuzzleTheme));
    const last = solverMoves[n - 1]!;
    const mated = other(solver);
    const k = kingSquare(chess, mated)!;
    const neighbours = [-1, 0, 1].flatMap((df) => [-1, 0, 1].map((dr) => (df || dr ? squareAt(fileOf(k) + df, rankOf(k) + dr) : null))).filter((s): s is Square => !!s);
    const ownAround = neighbours.filter((s) => chess.get(s)?.color === mated).length;
    if (last.piece === "n" && ownAround === neighbours.length) themes.add("smotheredMate");
    const backRank = mated === "w" ? 0 : 7;
    const forward = mated === "w" ? 1 : -1;
    if (rankOf(k) === backRank && (last.piece === "r" || last.piece === "q") && rankOf(last.to) === backRank) {
      const escape = [-1, 0, 1].map((df) => squareAt(fileOf(k) + df, backRank + forward)).filter((s): s is Square => !!s);
      if (escape.every((s) => chess.get(s)?.color === mated)) themes.add("backRankMate");
    }
  } else {
    themes.add(winningChances(finalScore) > 0.8 ? "crushing" : "advantage");
  }

  for (const [idx, { move: m, before, after }] of verbose.entries()) {
    if (m.promotion) {
      themes.add("promotion");
      if (m.promotion !== "q") themes.add("underPromotion");
    }
    if (m.flags.includes("e")) themes.add("enPassant");
    const enemy = other(solver);
    const capturedLater = (sq: string) => verbose.slice(idx + 1).some((v) => v.move.to === sq && v.move.captured);

    // Doppelschach
    if (after.inCheck()) {
      const k = kingSquare(after, enemy)!;
      if (after.attackers(k, solver).length >= 2) themes.add("doubleCheck");
    }

    // Gabel: die gezogene Figur greift ≥ 2 wertvollere/ungedeckte Figuren (oder König) an, eine davon fällt später.
    const moverValue = m.piece === "k" ? 100 : VALUE[m.piece];
    const targets: string[] = [];
    for (const row of after.board())
      for (const sq of row) {
        if (!sq || sq.color !== enemy) continue;
        if (!after.attackers(sq.square, solver).includes(m.to as Square)) continue;
        if (sq.type === "k" || VALUE[sq.type] > moverValue || (!isDefended(after, sq.square, enemy) && VALUE[sq.type] >= 3)) targets.push(sq.square);
      }
    const fallsOrMate = (sq: string) => capturedLater(sq) || chess.isCheckmate();
    if (targets.length >= 2 && m.piece !== "k" && targets.some((t) => after.get(t as Square)?.type !== "k" && fallsOrMate(t))) themes.add("fork");

    // Fesselung / Spieß durch die gezogene Langschrittfigur
    for (const [df, dr] of slideDirs(m.piece)) {
      let first: Square | null = null;
      for (const s of ray(m.to, df, dr)) {
        const p = after.get(s);
        if (!p) continue;
        if (!first) {
          if (p.color !== enemy) break;
          first = s;
          continue;
        }
        if (p.color !== enemy) break;
        const front = after.get(first)!;
        const frontV = front.type === "k" ? 100 : VALUE[front.type];
        const backV = p.type === "k" ? 100 : VALUE[p.type];
        if (front.type !== "k" && backV > frontV && (p.type === "k" || capturedLater(first) || capturedLater(s))) themes.add("pin");
        if ((front.type === "k" || front.type === "q") && backV < frontV && capturedLater(s)) themes.add("skewer");
        break;
      }
    }

    // Abzugsangriff: eine ANDERE eigene Figur greift durch den Zug neu König oder wertvolle Figur an.
    for (const row of after.board())
      for (const sq of row) {
        if (!sq || sq.color !== enemy || (sq.type !== "k" && VALUE[sq.type] < 3)) continue;
        const now = after.attackers(sq.square, solver).filter((a) => a !== m.to);
        const was = new Set(before.attackers(sq.square, solver));
        if (now.some((a) => !was.has(a) && after.get(a)?.type !== "p")) themes.add("discoveredAttack");
      }

    // Opfer: Figur zieht auf ein angegriffenes Feld und kann mit Materialverlust geschlagen werden.
    const gained = m.captured ? VALUE[m.captured] : 0;
    const cheapest = cheapestAttacker(after, m.to as Square, enemy);
    if (m.piece !== "k" && cheapest !== null && VALUE[m.piece] - gained >= 2 && (cheapest < VALUE[m.piece] || !isDefended(after, m.to as Square, solver))) {
      sacrifices++;
    }
  }
  if (sacrifices) themes.add("sacrifice");

  const first = solverMoves[0]!;
  if (!first.captured && !first.san.includes("+") && !first.san.includes("#") && !first.promotion) themes.add("quietMove");
  if (n === 1 && first.captured && !isDefended(verbose[0]!.before, first.to as Square, other(solver))) themes.add("hangingPiece");

  const start = new Chess(fen);
  const pieces = pieceCount(start);
  if (pieces <= 6) themes.add("endgame");
  else if (plyStart < 20) themes.add("opening");
  else themes.add("middlegame");

  return { themes: [...themes].sort(), sacrifices };
}
