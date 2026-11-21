import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Chess } from "chess.js";
import { THEMES, bandKeyOf, checkMoves, fromRow, type Puzzle, type PuzzleIndex, type PuzzleRow } from "../src/index.ts";
import { DATA_DIR, diskSource } from "../src/node.ts";

const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, DATA_DIR), "utf8")) as T;
const index = read<PuzzleIndex>("index.json");
const bandFiles = readdirSync(new URL("bands/", DATA_DIR)).sort();
const bands = new Map(bandFiles.map((f) => [f.replace(".json", ""), read<PuzzleRow[]>(`bands/${f}`).map(fromRow)]));
const all = [...bands.values()].flat();
const play = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

function replay(p: Puzzle) {
  const c = new Chess(p.fen);
  for (const m of p.moves) expect(() => play(c, m), `${p.id}: ${m}`).not.toThrow();
  if (p.themes.includes("mate")) expect(c.isCheckmate(), `${p.id}: Matt-Thema ohne Matt`).toBe(true);
  expect(checkMoves(p, p.moves.filter((_, i) => i % 2 === 1))).toEqual({ status: "solved" });
}

/** Prüft die ausgelieferte Sammlung: Struktur bei jedem Puzzle, vollständiges Nachspielen bei einer festen Stichprobe. */
describe(`Puzzle-Sammlung (${all.length} Puzzles in ${bands.size} Bändern)`, () => {
  it("Index passt zu den Band-Dateien", () => {
    expect(index.total).toBe(all.length);
    expect(index.bands.map((b) => b.key)).toEqual([...bands.keys()]);
    for (const b of index.bands) expect(bands.get(b.key)!.length, `Band ${b.key}`).toBe(b.count);
    expect(Object.values(index.difficulties).reduce((a, b) => a + b, 0)).toBe(all.length);
  });

  it("jedes Puzzle: eindeutige ID, richtiges Band, gültige Themen, Lösung endet mit eigenem Zug", () => {
    const valid = new Set<string>(THEMES);
    const ids = new Set<string>();
    for (const [key, list] of bands) {
      let last = -Infinity;
      for (const p of list) {
        expect(ids.has(p.id), `doppelte ID ${p.id}`).toBe(false);
        ids.add(p.id);
        if (bandKeyOf(p.rating) !== key) throw new Error(`${p.id}: Rating ${p.rating} liegt nicht in Band ${key}`);
        if (p.rating < last) throw new Error(`Band ${key} ist nicht nach Rating sortiert`);
        last = p.rating;
        if (p.moves.length < 2 || p.moves.length % 2 !== 0) throw new Error(`${p.id}: Lösung muss mit eigenem Zug enden`);
        if (!/^[1-8pnbrqkPNBRQK/]+ [wb] /.test(p.fen)) throw new Error(`${p.id}: FEN ungültig`);
        for (const m of p.moves) if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) throw new Error(`${p.id}: Zug ${m} ungültig`);
        for (const t of p.themes) if (!valid.has(t)) throw new Error(`${p.id}: Thema ${t} unbekannt`);
      }
    }
  });

  it("Stichprobe (jedes 20. Puzzle und alle selbst erzeugten) lässt sich vollständig nachspielen", () => {
    const sample = all.filter((p, i) => i % 20 === 0 || p.source !== "lichess");
    expect(sample.length).toBeGreaterThan(0);
    for (const p of sample) replay(p);
  }, 120_000);

  it("Sturm- und Tagespool sind spielbar und liegen im richtigen Bereich", async () => {
    const source = diskSource();
    const storm = await source.pool("storm");
    const daily = await source.pool("daily");
    expect(storm.length).toBeGreaterThan(20);
    expect(daily.length).toBeGreaterThan(20);
    for (const p of [...storm, ...daily]) replay(p);
    expect(storm.every((p) => p.rating >= 500 && p.rating < 2500 && p.moves.length <= 6)).toBe(true);
  }, 60_000);
});
