import { existsSync, readFileSync } from "node:fs";
import type { PoolName, PuzzleIndex, PuzzleRow, PuzzleSource } from "./source.ts";
import { sourceFromRows } from "./source.ts";

/** Nur für Node (Server, Skripte): Sammlung aus `packages/puzzles/data` von der Platte lesen. */
export const DATA_DIR = new URL("../data/", import.meta.url);

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DATA_DIR), "utf8")) as T;

export function diskSource(): PuzzleSource {
  if (!existsSync(new URL("index.json", DATA_DIR))) throw new Error("Puzzle-Sammlung fehlt: bitte `npm run puzzles:pack` ausführen");
  const index = read<PuzzleIndex>("index.json");
  return sourceFromRows(
    index,
    (key) => read<PuzzleRow[]>(`bands/${key}.json`),
    (name: PoolName) => read<PuzzleRow[]>(`${name}.json`),
  );
}
