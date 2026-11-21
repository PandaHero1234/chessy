import { Chess } from "chess.js";
import { type MultiPvResult, type PvLine, type Score, type SearchLimit, negate, winningChances } from "@chessy/shared";
import type { DifficultyFeatures, Puzzle } from "./types.ts";
import { detectThemes } from "./themes.ts";
import { estimateRating } from "./difficulty.ts";
import { materialDiff, moveToUci, other, uciToMove, type Side } from "./board.ts";

/** Alles, was der Algorithmus von einer Engine braucht. Bewertungen aus Sicht der Seite am Zug. */
export interface Analyzer {
  analyseMulti(fen: string, multipv: number, limit: SearchLimit): Promise<MultiPvResult>;
}

export interface MiningOptions {
  /** Knoten für die Bewertung jeder Partiestellung (Fehlersuche). */
  scanNodes: number;
  /** Knoten für die Eindeutigkeitsprüfung jedes Lösungszugs. */
  solveNodes: number;
  /** Knoten für die abschließende Gegenprüfung des ersten Lösungszugs (0 = aus). */
  verifyNodes: number;
  /** Erst ab diesem Halbzug suchen (Eröffnungstheorie überspringen). */
  minPly: number;
  /** Maximale Anzahl Lösungszüge. */
  maxSolverMoves: number;
  source: string;
  onProgress?: (done: number, total: number) => void;
  /** Grund, warum ein Kandidat verworfen wurde (Bericht/Debugging). */
  onReject?: (reason: RejectReason) => void;
}

export type RejectReason = "not_unique" | "no_material_gain" | "stalemate" | "verify_failed";

export const DEFAULT_MINING: MiningOptions = {
  scanNodes: 120_000,
  solveNodes: 700_000,
  verifyNodes: 2_000_000,
  minPly: 8,
  maxSolverMoves: 6,
  source: "selfplay",
};

/** Mindest-Sprung der Gewinnchancen, damit ein Zug als Fehler gilt (Skala −1…1). */
const BLUNDER_SWING = 0.1;
/** Nach dem Fehler muss die Gegenseite mindestens so gut stehen. */
const MIN_WINNING = 0.3;
/** Vor dem Fehler durfte die Gegenseite höchstens so gut stehen (sonst war die Partie schon entschieden). */
const MAX_BEFORE = 0.6;
/** Abstand bester ↔ zweitbester Zug, damit ein Zug als eindeutig gilt. */
const UNIQUE_GAP = 0.35;

interface Step {
  move: string;
  /** Ergebnis der Eindeutigkeitsprüfung vor diesem Lösungszug. */
  analysis: MultiPvResult;
}

/**
 * Ab welcher Suchtiefe die Engine den Lösungszug stabil als besten UND klar gewinnenden Zug sieht.
 * Je tiefer, desto mehr muss ein Mensch vorausberechnen.
 */
export function discoveryDepth(r: MultiPvResult, move: string): number {
  let d = r.bestByDepth.length ? r.bestByDepth[r.bestByDepth.length - 1]!.depth : 1;
  for (let i = r.bestByDepth.length - 1; i >= 0; i--) {
    const e = r.bestByDepth[i]!;
    if (e.move !== move || (e.score && winningChances(e.score) < MIN_WINNING)) break;
    d = e.depth;
  }
  return d;
}

/** Ist der beste Zug eindeutig besser als alle anderen? */
export function isUnique(lines: PvLine[]): boolean {
  const [best, second] = lines;
  if (!best) return false;
  if ("mate" in best.score) {
    if (best.score.mate <= 0) return false;
    // Matt in 1: jedes Matt wird beim Prüfen akzeptiert.
    if (best.score.mate === 1) return true;
    return !second || !("mate" in second.score) || second.score.mate <= 0;
  }
  if (best.score.cp < 200) return false;
  if (!second) return true;
  return winningChances(best.score) - winningChances(second.score) >= UNIQUE_GAP;
}

function scoreAfterMove(r: MultiPvResult): Score | null {
  return r.lines[0]?.score ?? null;
}

/**
 * Sucht in einer Partie nach Puzzles: Ein Zug, der die Gewinnchancen stark kippt, ist der „Fehler“.
 * Ab der Stellung danach wird die Lösung verlängert, solange die beste Fortsetzung eindeutig ist.
 */
export async function mineGame(engine: Analyzer, game: { initialFen: string; moves: string[] }, opts: Partial<MiningOptions> = {}): Promise<Puzzle[]> {
  const o = { ...DEFAULT_MINING, ...opts };
  const chess = new Chess(game.initialFen);
  const fens = [chess.fen()];
  for (const m of game.moves) {
    uciToMove(chess, m);
    fens.push(chess.fen());
  }

  // 1. Jede Stellung bewerten (aus Sicht der Seite am Zug).
  const scores: (Score | null)[] = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]!);
    if (c.isGameOver()) scores.push(c.isCheckmate() ? { mate: 0 } : { cp: 0 });
    else if (i < o.minPly) scores.push(null);
    else scores.push(scoreAfterMove(await engine.analyseMulti(fens[i]!, 1, { nodes: o.scanNodes })));
    o.onProgress?.(i + 1, fens.length);
  }

  // 2. Fehler finden und lösen.
  const puzzles: Puzzle[] = [];
  for (let i = o.minPly; i < game.moves.length; i++) {
    const before = scores[i];
    const after = scores[i + 1];
    if (!before || !after || ("mate" in after && after.mate === 0)) continue;
    const solverBefore = winningChances(negate(before));
    const solverAfter = winningChances(after);
    if (solverAfter - solverBefore < BLUNDER_SWING || solverAfter < MIN_WINNING || solverBefore > MAX_BEFORE) continue;
    const puzzle = await solveFrom(engine, fens[i]!, game.moves[i]!, o);
    if (puzzle && !puzzles.some((p) => p.id === puzzle.id)) puzzles.push(puzzle);
  }
  return puzzles;
}

/**
 * Findet in einer Stellung Züge, die die Partie verderben („Fehler“), sortiert nach Plausibilität:
 * Züge, die die Engine selbst weit oben einordnet, sehen gut aus und führen zu schwereren Puzzles.
 */
export async function blunderCandidates(engine: Analyzer, fen: string, opts: { multipv?: number; nodes?: number } = {}): Promise<{ move: string; rank: number }[]> {
  const r = await engine.analyseMulti(fen, opts.multipv ?? 40, { nodes: opts.nodes ?? 400_000 });
  const best = r.lines[0];
  if (!best) return [];
  const bestWc = winningChances(best.score);
  return r.lines
    .slice(1)
    .filter((l) => bestWc - winningChances(l.score) >= BLUNDER_SWING * 4 && winningChances(l.score) <= -MIN_WINNING)
    .map((l) => ({ move: l.move, rank: l.multipv }));
}

/** Baut aus Stellung `fen` + Fehler `blunder` ein Puzzle, oder null, wenn die Lösung nicht eindeutig ist. */
export async function solveFrom(engine: Analyzer, fen: string, blunder: string, o: MiningOptions): Promise<Puzzle | null> {
  const chess = new Chess(fen);
  uciToMove(chess, blunder);
  const solver: Side = chess.turn();
  const startMaterial = materialDiff(new Chess(fen), solver);
  const steps: Step[] = [];
  const line: string[] = [];
  let lastReplyFen: string | null = null;
  let finalScore: Score = { cp: 0 };

  // Schnelle Vorprüfung: klar mehrdeutige Kandidaten früh verwerfen (spart die teure Suche).
  const quick = await engine.analyseMulti(chess.fen(), 2, { nodes: Math.round(o.solveNodes / 5) });
  const [qb, qs] = quick.lines;
  if (!qb || ("cp" in qb.score && (qb.score.cp < 120 || (qs && winningChances(qb.score) - winningChances(qs.score) < UNIQUE_GAP / 2)))) {
    o.onReject?.("not_unique");
    return null;
  }

  for (let n = 0; n < o.maxSolverMoves; n++) {
    if (chess.isGameOver()) break;
    const r = await engine.analyseMulti(chess.fen(), 2, { nodes: o.solveNodes });
    if (!isUnique(r.lines)) {
      if (steps.length === 0) o.onReject?.("not_unique");
      break;
    }
    const best = r.lines[0]!;
    steps.push({ move: best.move, analysis: r });
    finalScore = best.score;
    uciToMove(chess, best.move);
    line.push(best.move);
    if (chess.isCheckmate()) break;
    if (chess.isGameOver()) {
      o.onReject?.("stalemate"); // Patt o. ä. ist keine Lösung
      return null;
    }
    // Beste Verteidigung des Gegners
    const reply = (await engine.analyseMulti(chess.fen(), 1, { nodes: Math.round(o.solveNodes / 2) })).lines[0];
    if (!reply) break;
    uciToMove(chess, reply.move);
    line.push(reply.move);
    lastReplyFen = chess.fen();
  }
  if (steps.length === 0) return null;
  // Die Lösung endet immer mit einem eigenen Zug.
  if (line.length % 2 === 0) line.pop();

  const end = new Chess(fen);
  uciToMove(end, blunder);
  for (const m of line) uciToMove(end, m);
  const mate = end.isCheckmate();
  if (!mate) {
    // Gewinn muss greifbar sein: Material nach der besten Antwort des Gegners.
    const check = lastReplyFen ? new Chess(lastReplyFen) : end;
    const gained = materialDiff(check, solver) - startMaterial;
    if (gained < 2 || winningChances(finalScore) < MIN_WINNING) {
      o.onReject?.("no_material_gain");
      return null;
    }
  }

  // 3. Gegenprüfung des ersten Zugs mit tieferer Suche.
  const startFen = (() => {
    const c = new Chess(fen);
    uciToMove(c, blunder);
    return c.fen();
  })();
  if (o.verifyNodes > 0) {
    const v = await engine.analyseMulti(startFen, 2, { nodes: o.verifyNodes });
    if (!isUnique(v.lines) || (v.lines[0]!.move !== line[0] && !mateInOneAlternative(startFen, v.lines[0]!.move, steps.length))) {
      o.onReject?.("verify_failed");
      return null;
    }
  }

  const moves = [blunder, ...line];
  const first = new Chess(startFen);
  const firstMove = uciToMove(first, line[0]!);
  const startPos = new Chess(startFen);
  const tempting = startPos.moves({ verbose: true }).filter((m) => moveToUci(m) !== line[0] && (m.captured || m.san.includes("+"))).length;
  const { themes, sacrifices } = detectThemes(fen, moves, mate ? { mate: 1 } : finalScore);
  const firstAnalysis = steps[0]!.analysis;
  const second = firstAnalysis.lines[1];
  const features: DifficultyFeatures = {
    solverMoves: Math.ceil(line.length / 2),
    mate,
    discoveryDepth: Math.max(...steps.slice(0, Math.ceil(line.length / 2)).map((s) => discoveryDepth(s.analysis, s.move))),
    firstMoveCheck: firstMove.san.includes("+") || firstMove.san.includes("#"),
    firstMoveCapture: !!firstMove.captured,
    firstMoveQuiet: !firstMove.captured && !firstMove.san.includes("+") && !firstMove.san.includes("#") && !firstMove.promotion,
    sacrifices,
    temptations: tempting,
    gap: second ? winningChances(firstAnalysis.lines[0]!.score) - winningChances(second.score) : 2,
    underPromotion: themes.includes("underPromotion"),
    hangingPiece: themes.includes("hangingPiece"),
    finalScore: mate ? { mate: 1 } : finalScore,
  };
  return {
    id: puzzleId(fen, moves),
    fen,
    moves,
    rating: estimateRating(features),
    themes,
    source: o.source,
    features,
  };
}

function mateInOneAlternative(fen: string, move: string, solverMoves: number) {
  if (solverMoves !== 1) return false;
  const c = new Chess(fen);
  uciToMove(c, move);
  return c.isCheckmate();
}

/** Kurze, stabile ID aus Stellung und Zügen (FNV-1a, Base36). */
export function puzzleId(fen: string, moves: string[]): string {
  let h = 0x811c9dc5;
  const s = fen.split(" ").slice(0, 4).join(" ") + "|" + moves.join(" ");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0;
  for (let i = s.length - 1; i >= 0; i--) h2 = (Math.imul(h2, 31) + s.charCodeAt(i)) >>> 0;
  return (h.toString(36) + h2.toString(36)).slice(0, 10);
}

export { other };
