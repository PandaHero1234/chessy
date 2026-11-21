import type { Color, Score } from "@chessy/shared";

/**
 * Format wie in der offenen Lichess-Puzzle-Datenbank:
 * `fen` ist die Stellung VOR dem Fehler des Gegners, `moves[0]` ist dieser Fehler (wird vorgespielt),
 * danach wechseln sich Lösungszüge und erzwungene Antworten ab. Der letzte Zug ist immer ein Lösungszug.
 */
export interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: PuzzleTheme[];
  /** "selfplay" (Generator), "game:<id>" (eigene Partie) oder "lichess". */
  source: string;
  /** Merkmale, aus denen das Rating berechnet wurde (für Bericht und Nachkalibrierung). */
  features?: DifficultyFeatures;
}

export const THEMES = [
  "mate",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mateIn4",
  "mateIn5",
  "backRankMate",
  "smotheredMate",
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "sacrifice",
  "hangingPiece",
  "quietMove",
  "promotion",
  "underPromotion",
  "enPassant",
  "advantage",
  "crushing",
  "opening",
  "middlegame",
  "endgame",
  "oneMove",
  "short",
  "long",
  "veryLong",
] as const;
export type PuzzleTheme = (typeof THEMES)[number];

export const THEME_LABELS: Record<PuzzleTheme, string> = {
  mate: "Matt",
  mateIn1: "Matt in 1",
  mateIn2: "Matt in 2",
  mateIn3: "Matt in 3",
  mateIn4: "Matt in 4",
  mateIn5: "Matt in 5+",
  backRankMate: "Grundreihenmatt",
  smotheredMate: "Ersticktes Matt",
  fork: "Gabel",
  pin: "Fesselung",
  skewer: "Spieß",
  discoveredAttack: "Abzugsangriff",
  doubleCheck: "Doppelschach",
  sacrifice: "Opfer",
  hangingPiece: "Hängende Figur",
  quietMove: "Stiller Zug",
  promotion: "Umwandlung",
  underPromotion: "Unterverwandlung",
  enPassant: "En passant",
  advantage: "Vorteil",
  crushing: "Entscheidender Vorteil",
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
  oneMove: "Ein Zug",
  short: "Kurz (2 Züge)",
  long: "Lang (3 Züge)",
  veryLong: "Sehr lang (4+ Züge)",
};

/** Schwierigkeitsstufen nach Puzzle-Rating. */
export const DIFFICULTIES = {
  beginner: { label: "Einsteiger", min: 0, max: 1000 },
  easy: { label: "Leicht", min: 1000, max: 1400 },
  medium: { label: "Mittel", min: 1400, max: 1800 },
  hard: { label: "Schwer", min: 1800, max: 2200 },
  master: { label: "Meister", min: 2200, max: 10_000 },
} as const;
export type Difficulty = keyof typeof DIFFICULTIES;

export function difficultyOf(rating: number): Difficulty {
  for (const [k, d] of Object.entries(DIFFICULTIES)) if (rating >= d.min && rating < d.max) return k as Difficulty;
  return "master";
}

export interface DifficultyFeatures {
  /** Anzahl Lösungszüge. */
  solverMoves: number;
  mate: boolean;
  /** Größte Suchtiefe, ab der die Engine einen Lösungszug stabil findet. */
  discoveryDepth: number;
  firstMoveCheck: boolean;
  firstMoveCapture: boolean;
  firstMoveQuiet: boolean;
  sacrifices: number;
  /** Naheliegende Schach-/Schlagzüge in der Startstellung, die nicht die Lösung sind. */
  temptations: number;
  /** Abstand der Gewinnchancen zwischen bestem und zweitbestem Zug (0…2) beim ersten Lösungszug. */
  gap: number;
  underPromotion: boolean;
  hangingPiece: boolean;
  finalScore: Score;
}

/** Was ein Client vor dem Lösen sieht (ohne Lösung). */
export interface PuzzlePublic {
  id: string;
  fen: string;
  /** Der vorgespielte Fehler des Gegners (UCI). */
  initial_move: string;
  /** Farbe, die das Puzzle löst. */
  color: Color;
  rating: number;
  /** Anzahl der Lösungszüge. */
  solver_moves: number;
  source: string;
}
