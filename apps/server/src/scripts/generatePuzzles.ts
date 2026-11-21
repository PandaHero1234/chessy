/**
 * Puzzle-Generator: Stockfish spielt in gemischten Stufen gegen sich selbst, danach werden die Partien
 * nach Fehlern durchsucht und daraus Puzzles mit eindeutiger Lösung gebaut. Läuft komplett lokal.
 *
 *   npm run puzzles:generate -- --target 1000 --workers 4 --minutes 120   # sammeln (fortsetzbar)
 *   npm run puzzles:generate -- --build                                  # puzzles.json + Bericht schreiben
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { type AiLevel, aiSearchCommands, multiPvCommands, parseMultiPv } from "@chessy/shared";
import { DEFAULT_MINING, DIFFICULTIES, THEMES, THEME_LABELS, blunderCandidates, detectThemes, difficultyOf, estimateRating, solveFrom, type Analyzer, type Puzzle } from "@chessy/puzzles";
import { UciProcess } from "../ai/stockfish.ts";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "1000" },
    workers: { type: "string", default: "4" },
    minutes: { type: "string", default: "120" },
    games: { type: "string" },
    build: { type: "boolean", default: false },
    seed: { type: "string" },
  },
});

const dataDir = new URL("../../../../packages/puzzles/data/", import.meta.url);
const RAW = new URL("puzzles.raw.jsonl", dataDir);
const OUT = new URL("puzzles.json", dataDir);
const REPORT = new URL("../../../../docs/puzzles-report.md", import.meta.url);

/** Gängige Eröffnungen, damit die Partien abwechslungsreich und realistisch sind. */
const BOOK = [
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6",
  "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6",
  "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4",
  "e2e4 e7e5 g1f3 g8f6 f3e5 d7d6",
  "e2e4 e7e5 f2f4 e5f4",
  "e2e4 e7e5 b1c3 g8f6",
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6",
  "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g7g6",
  "e2e4 c7c5 b1c3 b8c6 g2g3",
  "e2e4 c7c5 c2c3 g8f6 e4e5",
  "e2e4 e7e6 d2d4 d7d5 b1c3 f8b4",
  "e2e4 c7c6 d2d4 d7d5 e4e5 c8f5",
  "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5",
  "e2e4 g8f6 e4e5 f6d5 d2d4 d7d6",
  "e2e4 d7d6 d2d4 g8f6 b1c3 g7g6",
  "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5",
  "d2d4 d7d5 c2c4 d5c4 g1f3 g8f6",
  "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6",
  "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6",
  "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4",
  "d2d4 g8f6 c2c4 c7c5 d4d5 e7e6",
  "d2d4 d7d5 c1f4 g8f6 e2e3",
  "d2d4 f7f5 g2g3 g8f6",
  "c2c4 e7e5 b1c3 g8f6 g2g3",
  "g1f3 d7d5 g2g3 g8f6 f1g2",
  "b2b3 e7e5 c1b2 b8c6",
];

function bookLine(): string[] {
  const line = BOOK[Math.floor(Math.random() * BOOK.length)]!.split(" ");
  return line.slice(0, 2 + Math.floor(Math.random() * (line.length - 1)));
}

const analyzerOf = (e: UciProcess): Analyzer => ({
  analyseMulti: async (fen, multipv, limit) => parseMultiPv(await e.run(multiPvCommands(fen, multipv, limit))),
});

async function selfPlay(e: UciProcess): Promise<string[]> {
  const moves = bookLine();
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
  // Stufen 4–8: realistische Stellungen; Fehler werden später gezielt an Stichproben eingebaut.
  const level = () => (4 + Math.floor(Math.random() * 5)) as AiLevel;
  const levels = { w: level(), b: level() };
  await e.run(["ucinewgame", "isready"], /^readyok/);
  while (!chess.isGameOver() && moves.length < 110) {
    const level = levels[chess.turn()];
    const lines = await e.run(aiSearchCommands(level, DEFAULT_POSITION, moves, Math.min(250, 40 * level)));
    const best = /^bestmove (\S+)/.exec(lines[lines.length - 1] ?? "")?.[1];
    if (!best || best === "(none)") break;
    chess.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    moves.push(best);
  }
  return moves;
}

function loadRaw(): Puzzle[] {
  if (!existsSync(RAW)) return [];
  return readFileSync(RAW, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Puzzle);
}

async function collect() {
  const target = Number(values.target);
  const deadline = Date.now() + Number(values.minutes) * 60_000;
  const maxGames = values.games ? Number(values.games) : Infinity;
  const have = new Set(loadRaw().map((p) => p.id));
  const rejects: Record<string, number> = {};
  let games = 0;
  const started = Date.now();
  console.log(`Start: ${have.size} Puzzles vorhanden, Ziel ${target}, ${values.workers} Engines, max ${values.minutes} min`);

  const worker = async (n: number) => {
    const e = new UciProcess();
    const analyzer = analyzerOf(e);
    while (have.size < target && Date.now() < deadline && games < maxGames) {
      games++;
      const moves = await selfPlay(e);
      const found: Puzzle[] = [];
      // Stichproben: an zufälligen Stellungen einen verlierenden Zug einbauen und die Widerlegung lösen.
      const plies = moves.map((_, i) => i).filter((i) => i >= 8 && Math.random() < 0.6).slice(0, 24);
      for (const ply of plies) {
        const chess = new Chess();
        for (const m of moves.slice(0, ply)) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
        if (chess.isGameOver()) continue;
        const fen = chess.fen();
        const cands = await blunderCandidates(analyzer, fen);
        if (!cands.length) {
          rejects.no_blunder = (rejects.no_blunder ?? 0) + 1;
          continue;
        }
        // Plausible (hoch eingestufte) Fehler zuerst → schwerere Puzzles; die billige Vorprüfung verwirft Mehrdeutiges schnell.
        const order = [...cands.slice(0, 4), ...cands.slice(4).sort(() => Math.random() - 0.5)].slice(0, 6);
        for (const cand of order) {
          const p = await solveFrom(analyzer, fen, cand.move, { ...DEFAULT_MINING, onReject: (r) => (rejects[r] = (rejects[r] ?? 0) + 1) });
          if (!p) continue;
          // Sehr leichte Puzzles entstehen von selbst reichlich; nur einen Teil behalten.
          if (p.rating >= 900 || Math.random() < 0.35) found.push(p);
          else rejects.easy_quota = (rejects.easy_quota ?? 0) + 1;
          break;
        }
      }
      // Mattangriffe: In Partien, die mit Matt enden, die letzten Züge auf erzwungene Mattfolgen prüfen
      // (ohne eingebauten Fehler). Liefert mehrzügige Matt-Puzzles für die schweren Stufen.
      const end = new Chess();
      for (const m of moves) end.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      if (end.isCheckmate()) {
        const winnerParity = (moves.length - 1) % 2; // der letzte Zug (Matt) stammt vom Gewinner
        const c = new Chess();
        const fens: string[] = [];
        for (const m of moves) {
          fens.push(c.fen());
          c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
        }
        for (let i = Math.max(8, moves.length - 24); i < moves.length - 2; i++) {
          if (i % 2 === winnerParity) continue; // Zug i muss vom späteren Verlierer stammen
          const p = await solveFrom(analyzer, fens[i]!, moves[i]!, { ...DEFAULT_MINING, onReject: (r) => (rejects[r] = (rejects[r] ?? 0) + 1) });
          if (p && p.features?.mate && p.features.solverMoves >= 2) {
            found.push(p);
            break; // ein Matt-Puzzle pro Partie (spätere sind Teilstücke davon)
          }
        }
      }
      let added = 0;
      for (const p of found) {
        if (have.has(p.id)) continue;
        have.add(p.id);
        appendFileSync(RAW, JSON.stringify(p) + "\n");
        added++;
      }
      const min = (Date.now() - started) / 60_000;
      console.log(`[w${n}] Partie ${games}: ${moves.length} Halbzüge, +${added} Puzzles → ${have.size} (${(have.size / Math.max(min, 0.01)).toFixed(1)}/min gesamt)`);
    }
    e.kill();
  };
  await Promise.all(Array.from({ length: Number(values.workers) }, (_, i) => worker(i + 1)));
  console.log("Verworfen:", JSON.stringify(rejects));
  console.log(`Fertig: ${have.size} Puzzles aus ${games} Partien in ${((Date.now() - started) / 60_000).toFixed(1)} min`);
}

function build() {
  // Themen und Rating werden aus den gespeicherten Merkmalen neu berechnet: Formel-Änderungen brauchen keinen neuen Lauf.
  const raw = loadRaw().map((p) => {
    if (!p.features) return p;
    const { themes, sacrifices } = detectThemes(p.fen, p.moves, p.features.finalScore);
    const features = { ...p.features, sacrifices, underPromotion: themes.includes("underPromotion"), hangingPiece: themes.includes("hangingPiece") };
    return { ...p, themes, features, rating: estimateRating(features) };
  });
  // Doppelte Stellungen entfernen (gleiche Stellung → nur ein Puzzle).
  const byFen = new Map<string, Puzzle>();
  for (const p of raw) {
    const key = p.fen.split(" ").slice(0, 4).join(" ") + p.moves[0];
    if (!byFen.has(key)) byFen.set(key, p);
  }
  const list = [...byFen.values()].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  writeFileSync(OUT, JSON.stringify(list.map(({ features: _f, ...p }) => p)) + "\n");

  const lines: string[] = [];
  lines.push("# Puzzle-Bericht", "");
  lines.push(`Erzeugt mit \`npm run puzzles:generate\`: **${list.length} Puzzles** (aus ${raw.length} Funden nach Entfernen doppelter Stellungen).`, "");
  lines.push("## Verteilung nach Stufe", "", "| Stufe | Rating | Anzahl | Anteil |", "|---|---|---|---|");
  for (const [k, d] of Object.entries(DIFFICULTIES)) {
    const n = list.filter((p) => difficultyOf(p.rating) === k).length;
    lines.push(`| ${d.label} | ${d.min}–${d.max >= 10_000 ? "" : d.max - 1} | ${n} | ${((100 * n) / Math.max(list.length, 1)).toFixed(0)} % |`);
  }
  lines.push("", "## Rating-Histogramm", "", "```");
  for (let r = 400; r < 2800; r += 200) {
    const n = list.filter((p) => p.rating >= r && p.rating < r + 200).length;
    lines.push(`${String(r).padStart(4)}–${String(r + 199).padEnd(4)} ${"█".repeat(Math.round((60 * n) / Math.max(list.length, 1)))} ${n}`);
  }
  lines.push("```", "", "## Themen", "", "| Thema | Anzahl |", "|---|---|");
  for (const t of THEMES) {
    const n = list.filter((p) => p.themes.includes(t)).length;
    if (n) lines.push(`| ${THEME_LABELS[t]} (\`${t}\`) | ${n} |`);
  }
  const solver = (p: Puzzle) => Math.floor(p.moves.length / 2);
  lines.push("", "## Lösungslänge", "", "| Lösungszüge | Anzahl |", "|---|---|");
  for (let n = 1; n <= 6; n++) lines.push(`| ${n} | ${list.filter((p) => solver(p) === n).length} |`);
  writeFileSync(REPORT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

if (values.build) build();
else await collect();
