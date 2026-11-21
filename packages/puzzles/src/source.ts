import type { Difficulty, Puzzle, PuzzleTheme } from "./types.ts";
import { DIFFICULTIES, THEMES } from "./types.ts";
import { solverMoveCount } from "./check.ts";

/**
 * Die Puzzle-Sammlung liegt in Rating-Bändern vor (je 100 Punkte eine Datei). So muss der Browser nie alle
 * Puzzles laden: Für ein Puzzle nahe am eigenen Rating reichen ein bis drei Bänder. Der Server lädt alle.
 */
export const BAND_WIDTH = 100;
export const BAND_MIN = 400;
export const BAND_MAX = 3000;

export interface BandInfo {
  key: string;
  /** Rating-Bereich [min, max). Das oberste Band ist nach oben offen. */
  min: number;
  max: number;
  count: number;
}

export interface PuzzleIndex {
  total: number;
  bands: BandInfo[];
  difficulties: Record<Difficulty, number>;
  themes: Partial<Record<PuzzleTheme, number>>;
  sources: Record<string, number>;
}

/** Kompakte Zeile in den Band-Dateien: [id, fen, "zug zug …", rating, "thema thema …", quelle?] (Quelle fehlt = "lichess"). */
export type PuzzleRow = [string, string, string, number, string] | [string, string, string, number, string, string];

export type PoolName = "storm" | "daily";

export interface PuzzleSource {
  index: PuzzleIndex;
  band(key: string): Promise<Puzzle[]>;
  /** Kleine feste Auswahl für Puzzle-Sturm und Tagespuzzle (für alle Clients gleich). */
  pool(name: PoolName): Promise<Puzzle[]>;
}

export const DEFAULT_SOURCE = "lichess";

export function bandKeyOf(rating: number): string {
  const lo = Math.min(BAND_MAX - BAND_WIDTH, Math.max(BAND_MIN, Math.floor(rating / BAND_WIDTH) * BAND_WIDTH));
  return String(lo).padStart(4, "0");
}

export const toRow = (p: Puzzle): PuzzleRow =>
  p.source === DEFAULT_SOURCE ? [p.id, p.fen, p.moves.join(" "), Math.round(p.rating), p.themes.join(" ")] : [p.id, p.fen, p.moves.join(" "), Math.round(p.rating), p.themes.join(" "), p.source];

export const fromRow = (r: PuzzleRow): Puzzle => ({
  id: r[0],
  fen: r[1],
  moves: r[2].split(" "),
  rating: r[3],
  themes: (r[4] ? r[4].split(" ") : []) as PuzzleTheme[],
  source: r[5] ?? DEFAULT_SOURCE,
});

/** Stabile Pseudo-Zufallsreihenfolge aus der ID (für reproduzierbare Auswahlen). */
function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface PuzzlePack {
  index: PuzzleIndex;
  bands: Map<string, Puzzle[]>;
  storm: Puzzle[];
  daily: Puzzle[];
}

/** Teilt eine Sammlung in Bänder und baut Index sowie die Auswahlen für Sturm und Tagespuzzle. */
export function buildPack(puzzles: Puzzle[]): PuzzlePack {
  const bands = new Map<string, Puzzle[]>();
  for (const p of puzzles) {
    const k = bandKeyOf(p.rating);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k)!.push(p);
  }
  for (const list of bands.values()) list.sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  const keys = [...bands.keys()].sort();

  const difficulties = Object.fromEntries(Object.keys(DIFFICULTIES).map((d) => [d, 0])) as Record<Difficulty, number>;
  const themeCount = new Map<string, number>();
  const sources: Record<string, number> = {};
  for (const p of puzzles) {
    for (const [d, def] of Object.entries(DIFFICULTIES)) if (p.rating >= def.min && p.rating < def.max) difficulties[d as Difficulty]++;
    for (const t of p.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
    const src = p.source.startsWith("game:") ? "game" : p.source;
    sources[src] = (sources[src] ?? 0) + 1;
  }
  const themes = Object.fromEntries(THEMES.filter((t) => themeCount.get(t)).map((t) => [t, themeCount.get(t)!])) as Partial<Record<PuzzleTheme, number>>;

  const index: PuzzleIndex = {
    total: puzzles.length,
    bands: keys.map((key) => {
      const min = Number(key);
      return { key, min, max: min + BAND_WIDTH >= BAND_MAX ? 10_000 : min + BAND_WIDTH, count: bands.get(key)!.length };
    }),
    difficulties,
    themes,
    sources,
  };
  if (index.bands[0]) index.bands[0].min = 0;

  const byHash = (list: Puzzle[]) => list.slice().sort((a, b) => hashOf(a.id) - hashOf(b.id) || a.id.localeCompare(b.id));
  // Sturm: je Band bis zu 40 kurze Puzzles zwischen 500 und 2500.
  const storm: Puzzle[] = [];
  for (const key of keys) {
    const lo = Number(key);
    if (lo < 500 || lo >= 2500) continue;
    storm.push(...byHash(bands.get(key)!.filter((p) => solverMoveCount(p) <= 3)).slice(0, 40));
  }
  storm.sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  // Tagespuzzle: mittlere Schwierigkeit, mindestens zwei Lösungszüge, gut ein Jahr Vorrat.
  const dailyAll = byHash(puzzles.filter((p) => p.rating >= 1300 && p.rating <= 2100 && solverMoveCount(p) >= 2));
  const daily = (dailyAll.length ? dailyAll : byHash(puzzles)).slice(0, 400).sort((a, b) => a.id.localeCompare(b.id));

  return { index, bands, storm, daily };
}

/** Quelle über eine Sammlung im Arbeitsspeicher (Tests, kleine Sammlungen). */
export function sourceFromArray(puzzles: Puzzle[]): PuzzleSource {
  const pack = buildPack(puzzles);
  return {
    index: pack.index,
    band: async (key) => pack.bands.get(key) ?? [],
    pool: async (name) => pack[name],
  };
}

/** Quelle über Band-Dateien, die bei Bedarf nachgeladen werden (Browser) oder vorab geladen sind (Server). */
export function sourceFromRows(index: PuzzleIndex, loadBand: (key: string) => Promise<PuzzleRow[]> | PuzzleRow[], loadPool: (name: PoolName) => Promise<PuzzleRow[]> | PuzzleRow[]): PuzzleSource {
  const bandCache = new Map<string, Promise<Puzzle[]>>();
  const poolCache = new Map<string, Promise<Puzzle[]>>();
  return {
    index,
    band(key) {
      if (!index.bands.some((b) => b.key === key)) return Promise.resolve([]);
      if (!bandCache.has(key)) bandCache.set(key, Promise.resolve(loadBand(key)).then((rows) => rows.map(fromRow)));
      return bandCache.get(key)!;
    },
    pool(name) {
      if (!poolCache.has(name)) poolCache.set(name, Promise.resolve(loadPool(name)).then((rows) => rows.map(fromRow)));
      return poolCache.get(name)!;
    },
  };
}
