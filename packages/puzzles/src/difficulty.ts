import type { DifficultyFeatures } from "./types.ts";

/**
 * Schätzt das Rating eines Puzzles aus nachvollziehbaren Merkmalen. Startwert; auf dem Server
 * kalibrieren echte Lösungsversuche das Rating danach per Elo nach.
 */
export function estimateRating(f: DifficultyFeatures): number {
  // Kalibriert an Erfahrungswerten der Lichess-Puzzle-Datenbank: hängende Figur ≈ 500–700,
  // Einzüger mit Taktik ≈ 800–1000, zwei Züge ≈ 1100–1300, drei Züge ≈ 1400–1600, stille Züge/Opfer deutlich schwerer.
  let r = 800;
  r += 280 * (f.solverMoves - 1);
  r += 70 * Math.max(0, Math.min(f.discoveryDepth, 16) - 3);
  if (f.firstMoveQuiet) r += 300;
  if (f.firstMoveCapture && f.sacrifices === 0) r -= 100;
  if (f.firstMoveCheck) r -= 50;
  r += 180 * Math.min(f.sacrifices, 3);
  r += 20 * Math.min(f.temptations, 8);
  if (f.underPromotion) r += 250;
  if (f.hangingPiece) r -= 300;
  if (f.mate && f.solverMoves === 1) r -= 150;
  // Knapper Abstand zum zweitbesten Zug = feinere Lösung.
  r += Math.round(120 * Math.max(0, 1 - f.gap));
  return Math.max(400, Math.min(2800, Math.round(r / 10) * 10));
}
