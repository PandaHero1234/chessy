/** Bewertung aus Sicht der Seite am Zug: Centibauern oder Matt in n Zügen (negativ = wird mattgesetzt). */
export type Score = { cp: number } | { mate: number };

export type SearchLimit = { nodes: number } | { depth: number } | { movetime: number };

export interface PvLine {
  /** 1-basiert, 1 = bester Zug. */
  multipv: number;
  move: string;
  pv: string[];
  score: Score;
  depth: number;
}

export interface MultiPvResult {
  lines: PvLine[];
  /** Bester Zug (multipv 1) je abgeschlossener Suchtiefe – zeigt, ab welcher Tiefe eine Lösung gefunden wird. */
  bestByDepth: { depth: number; move: string; score?: Score }[];
}

/** Gewinnchance −1…1 aus Sicht der Seite am Zug (Formel wie bei Lichess). */
export function winningChances(s: Score): number {
  if ("mate" in s) return s.mate > 0 ? 1 : -1;
  return 2 / (1 + Math.exp(-0.00368208 * s.cp)) - 1;
}

export const negate = (s: Score): Score => ("mate" in s ? { mate: -s.mate } : { cp: -s.cp });

export function multiPvCommands(fen: string, multipv: number, limit: SearchLimit): string[] {
  const go = "nodes" in limit ? `go nodes ${limit.nodes}` : "depth" in limit ? `go depth ${limit.depth}` : `go movetime ${limit.movetime}`;
  return ["setoption name Skill Level value 20", `setoption name MultiPV value ${multipv}`, `position fen ${fen}`, go];
}

const INFO_RE = /^info .*?\bdepth (\d+)\b.*?\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+)(.*?)\bpv (.+)$/;

/** Wertet die UCI-Ausgabe einer MultiPV-Suche aus (letzte vollständige Zeile je multipv zählt). */
export function parseMultiPv(lines: string[]): MultiPvResult {
  const latest = new Map<number, PvLine>();
  const bestByDepth: { depth: number; move: string; score?: Score }[] = [];
  for (const line of lines) {
    const m = INFO_RE.exec(line);
    if (!m || /\b(upperbound|lowerbound)\b/.test(m[5]!)) continue;
    const depth = Number(m[1]);
    const multipv = Number(m[2]);
    const pv = m[6]!.trim().split(/\s+/);
    const score: Score = m[3] === "cp" ? { cp: Number(m[4]) } : { mate: Number(m[4]) };
    latest.set(multipv, { multipv, move: pv[0]!, pv, score, depth });
    if (multipv === 1) {
      const last = bestByDepth[bestByDepth.length - 1];
      if (last?.depth === depth) Object.assign(last, { move: pv[0]!, score });
      else bestByDepth.push({ depth, move: pv[0]!, score });
    }
  }
  return { lines: [...latest.values()].sort((a, b) => a.multipv - b.multipv), bestByDepth };
}
