import type { AiLevel, AnalysisResult, Color } from "./types.ts";

/**
 * Spielstärken. Stockfish "Skill Level" (0–20) plus begrenzte Suchtiefe und Bedenkzeit.
 * Stufe 1 macht bewusst grobe Fehler, Stufe 8 spielt mit voller Stärke.
 */
export const AI_LEVEL_SETTINGS: Record<AiLevel, { skill: number; depth: number; movetime: number; label: string }> = {
  1: { skill: 0, depth: 1, movetime: 50, label: "Einsteiger" },
  2: { skill: 3, depth: 2, movetime: 100, label: "Anfänger" },
  3: { skill: 6, depth: 3, movetime: 150, label: "Gelegenheitsspieler" },
  4: { skill: 9, depth: 5, movetime: 200, label: "Vereinsspieler" },
  5: { skill: 11, depth: 8, movetime: 300, label: "Fortgeschritten" },
  6: { skill: 14, depth: 12, movetime: 500, label: "Experte" },
  7: { skill: 17, depth: 16, movetime: 800, label: "Meister" },
  8: { skill: 20, depth: 22, movetime: 1200, label: "Großmeister" },
};

/** Bedenkzeit: nie mehr als ~1/30 der Restzeit (+ halbes Inkrement). */
export function aiMoveTime(level: AiLevel, timeLeft: number | null, increment: number): number {
  const base = AI_LEVEL_SETTINGS[level].movetime;
  if (timeLeft === null) return base;
  return Math.round(Math.max(20, Math.min(base, timeLeft / 30 + increment / 2)));
}

/** UCI-Befehle für einen KI-Zug. */
export function aiSearchCommands(level: AiLevel, initialFen: string, moves: string[], movetime: number): string[] {
  const lvl = AI_LEVEL_SETTINGS[level];
  return [
    `setoption name Skill Level value ${lvl.skill}`,
    "ucinewgame",
    `position fen ${initialFen}${moves.length ? ` moves ${moves.join(" ")}` : ""}`,
    `go depth ${lvl.depth} movetime ${movetime}`,
  ];
}

/** Wertet die UCI-Ausgabe einer Analyse aus; Bewertung aus Sicht von Weiß. */
export function parseAnalysis(fen: string, lines: string[], turn: Color): AnalysisResult {
  const sign = turn === "white" ? 1 : -1;
  let result: AnalysisResult = { fen, depth: 0, bestmove: null, eval: { cp: 0 }, pv: [] };
  for (const line of lines) {
    const info = /^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)(?:.*\bpv (.+))?/.exec(line);
    if (info && !/\bupperbound|lowerbound\b/.test(line)) {
      const v = Number(info[3]) * sign;
      result = {
        ...result,
        depth: Number(info[1]),
        eval: info[2] === "cp" ? { cp: v } : { mate: v },
        pv: info[4]?.split(" ") ?? result.pv,
      };
    }
    const bm = /^bestmove (\S+)/.exec(line);
    if (bm) result.bestmove = bm[1] === "(none)" ? null : bm[1]!;
  }
  return result;
}
