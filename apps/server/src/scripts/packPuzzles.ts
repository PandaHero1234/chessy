/**
 * Baut die ausgelieferte Puzzle-Sammlung: eigene Puzzles (Generator) plus optional eine Auswahl aus der
 * offenen Lichess-Puzzle-Datenbank (CC0, https://database.lichess.org/#puzzles), aufgeteilt in Rating-Bänder.
 *
 *   npm run puzzles:pack                                              # nur eigene Puzzles
 *   npm run puzzles:pack -- --lichess lichess_db_puzzle.csv.zst --total 102400
 *
 * Die Lichess-Auswahl ist reproduzierbar (Reihenfolge nach Hash der ID) und wird vollständig nachgeprüft:
 * Jede Zugfolge muss legal sein und mit einem Lösungszug enden.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { Chess } from "chess.js";
import { BAND_MAX, BAND_MIN, BAND_WIDTH, DIFFICULTIES, THEMES, THEME_LABELS, bandKeyOf, buildPack, difficultyOf, toRow, type Difficulty, type Puzzle, type PuzzleTheme } from "@chessy/puzzles";
import { DATA_DIR } from "@chessy/puzzles/node";

const { values } = parseArgs({
  options: {
    lichess: { type: "string" },
    total: { type: "string", default: "102400" },
    "min-plays": { type: "string", default: "200" },
    "min-popularity": { type: "string", default: "80" },
    "max-deviation": { type: "string", default: "90" },
  },
});

const REPORT = new URL("../../../../docs/puzzles-report.md", import.meta.url);

/** Anteil der Sammlung je Stufe. Innerhalb einer Stufe werden die Bänder gleichmäßig gefüllt. */
const LEVEL_SHARE: Record<Difficulty, number> = { beginner: 0.15, easy: 0.25, medium: 0.25, hard: 0.22, master: 0.13 };

const known = new Set<string>(THEMES);

function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Liest eine Textdatei zeilenweise; `.zst` im pzstd-Format (viele Einzelblöcke mit Größenangabe davor) wird blockweise entpackt. */
function* lines(path: string): Generator<string> {
  if (!path.endsWith(".zst")) {
    yield* readFileSync(path, "utf8").split("\n");
    return;
  }
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(12);
    let pos = 0;
    let rest = "";
    for (;;) {
      if (readSync(fd, head, 0, 4, pos) < 4) break;
      const magic = head.readUInt32LE(0);
      let frame: Buffer;
      if ((magic & 0xfffffff0) === 0x184d2a50) {
        // Überspringbarer Block: enthält bei pzstd die Größe des folgenden Datenblocks.
        readSync(fd, head, 0, 12, pos);
        const skip = head.readUInt32LE(4);
        const size = skip === 4 ? head.readUInt32LE(8) : 0;
        pos += 8 + skip;
        if (!size) continue;
        frame = Buffer.alloc(size);
        if (readSync(fd, frame, 0, size, pos) < size) throw new Error("Datei ist unvollständig");
        pos += size;
      } else {
        // Gewöhnliche zstd-Datei ohne Blockgrößen: Rest am Stück entpacken.
        frame = readFileSync(path).subarray(pos);
        pos = Infinity;
      }
      const text = rest + zstdDecompressSync(frame).toString("utf8");
      const parts = text.split("\n");
      rest = parts.pop()!;
      yield* parts;
      if (pos === Infinity) break;
    }
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}

function valid(p: Puzzle): boolean {
  if (p.moves.length < 2 || p.moves.length % 2 !== 0) return false;
  try {
    const c = new Chess(p.fen);
    for (const m of p.moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    return !p.themes.includes("mate") || c.isCheckmate();
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ eigene Puzzles
const own = (JSON.parse(readFileSync(new URL("puzzles.json", DATA_DIR), "utf8")) as Puzzle[]).filter(valid);
const total = Number(values.total);
console.log(`Eigene Puzzles: ${own.length}`);

// ------------------------------------------------------------------ Lichess-Auswahl
let lichess: Puzzle[] = [];
const stats = { rows: 0, quality: 0, selected: 0, invalid: 0 };
if (values.lichess) {
  // Kontingent je Band: Stufenanteil gleichmäßig auf die Bänder der Stufe, abzüglich eigener Puzzles dort.
  const bandKeys: string[] = [];
  for (let lo = BAND_MIN; lo < BAND_MAX; lo += BAND_WIDTH) bandKeys.push(bandKeyOf(lo));
  const quota = new Map<string, number>();
  for (const [level, share] of Object.entries(LEVEL_SHARE)) {
    const keys = bandKeys.filter((k) => difficultyOf(Number(k)) === level);
    for (const k of keys) quota.set(k, Math.round((total * share) / keys.length));
  }
  for (const p of own) quota.set(bandKeyOf(p.rating), Math.max(0, quota.get(bandKeyOf(p.rating))! - 1));

  const minPlays = Number(values["min-plays"]);
  const minPop = Number(values["min-popularity"]);
  const maxDev = Number(values["max-deviation"]);
  const ownStarts = new Set(own.map((p) => p.fen.split(" ").slice(0, 4).join(" ") + p.moves[0]));
  const picked = new Map<string, { h: number; p: Puzzle }[]>(bandKeys.map((k) => [k, []]));
  const cut = new Map<string, number>();
  const SPARE = 1.5; // Vorrat: für Puzzles, die die Nachprüfung nicht bestehen, und zum Ausgleich dünn besetzter Bänder

  let first = true;
  for (const line of lines(values.lichess)) {
    if (first) {
      first = false;
      if (line.startsWith("PuzzleId")) continue;
    }
    if (!line) continue;
    stats.rows++;
    if (stats.rows % 1_000_000 === 0) console.log(`  ${stats.rows / 1_000_000} Mio. Zeilen gelesen …`);
    // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    const f = line.split(",");
    const rating = Number(f[3]);
    if (Number(f[4]) > maxDev || Number(f[5]) < minPop || Number(f[6]) < minPlays || !Number.isFinite(rating)) continue;
    stats.quality++;
    const key = bandKeyOf(rating);
    const list = picked.get(key)!;
    const limit = Math.ceil(quota.get(key)! * SPARE);
    const h = hashOf(f[0]!);
    // Je Band bleiben die Kandidaten mit den kleinsten Hash-Werten übrig (begrenzter Speicher).
    if (limit === 0 || h >= (cut.get(key) ?? Infinity)) continue;
    const p: Puzzle = { id: f[0]!, fen: f[1]!, moves: f[2]!.split(" "), rating, themes: f[7]!.split(" ").filter((t) => known.has(t)) as PuzzleTheme[], source: "lichess" };
    if (ownStarts.has(p.fen.split(" ").slice(0, 4).join(" ") + p.moves[0])) continue;
    list.push({ h, p });
    if (list.length >= limit * 2) {
      list.sort((a, b) => a.h - b.h);
      list.length = limit;
      cut.set(key, list[limit - 1]!.h);
    }
  }

  // Erste Runde: jedes Band bis zu seinem Kontingent füllen (nur nachgeprüfte Puzzles).
  const pools = new Map<string, Puzzle[]>();
  const taken = new Map<string, number>();
  for (const key of bandKeys) {
    const ok: Puzzle[] = [];
    for (const { p } of picked.get(key)!.sort((a, b) => a.h - b.h || a.p.id.localeCompare(b.p.id))) {
      if (valid(p)) ok.push(p);
      else stats.invalid++;
    }
    pools.set(key, ok);
    taken.set(key, Math.min(quota.get(key)!, ok.length));
  }
  // Zweite Runde: Was einem Band fehlt (ganz oben gibt es zu wenige gute Puzzles), übernehmen die anderen Bänder derselben Stufe.
  for (const level of Object.keys(LEVEL_SHARE)) {
    const keys = bandKeys.filter((k) => difficultyOf(Number(k)) === level);
    let deficit = keys.reduce((s, k) => s + quota.get(k)! - taken.get(k)!, 0);
    for (const k of keys) if (taken.get(k)! < quota.get(k)!) console.log(`  Band ${k}: nur ${taken.get(k)} von ${quota.get(k)} verfügbar`);
    while (deficit > 0) {
      const open = keys.filter((k) => taken.get(k)! < pools.get(k)!.length);
      if (!open.length) break;
      const each = Math.max(1, Math.floor(deficit / open.length));
      for (const k of open) {
        const add = Math.min(each, pools.get(k)!.length - taken.get(k)!, deficit);
        taken.set(k, taken.get(k)! + add);
        deficit -= add;
      }
    }
    if (deficit > 0) console.log(`  Stufe ${level}: ${deficit} Puzzles fehlen`);
  }
  for (const key of bandKeys) lichess.push(...pools.get(key)!.slice(0, taken.get(key)!));
  stats.selected = lichess.length;
  console.log(`Lichess: ${stats.rows} Zeilen, ${stats.quality} bestehen den Qualitätsfilter, ${stats.selected} ausgewählt, ${stats.invalid} bei der Nachprüfung verworfen`);
}

// ------------------------------------------------------------------ schreiben
const all = [...own, ...lichess];
const ids = new Set<string>();
for (const p of all) {
  if (ids.has(p.id)) throw new Error(`Doppelte Puzzle-ID ${p.id}`);
  ids.add(p.id);
}
const pack = buildPack(all);
const bandsDir = new URL("bands/", DATA_DIR);
mkdirSync(bandsDir, { recursive: true });
for (const f of readdirSync(bandsDir)) rmSync(new URL(f, bandsDir));
let bytes = 0;
const write = (name: string, data: unknown) => {
  const text = JSON.stringify(data) + "\n";
  bytes += text.length;
  writeFileSync(new URL(name, DATA_DIR), text);
};
for (const [key, list] of pack.bands) write(`bands/${key}.json`, list.map(toRow));
write("storm.json", pack.storm.map(toRow));
write("daily.json", pack.daily.map(toRow));
write("index.json", pack.index);

// ------------------------------------------------------------------ Bericht
const pct = (n: number) => `${((100 * n) / Math.max(all.length, 1)).toFixed(0)} %`;
const out: string[] = [];
out.push("# Puzzle-Bericht", "");
out.push(`Erzeugt mit \`npm run puzzles:pack\`: **${all.length.toLocaleString("de-DE")} Puzzles** in ${pack.index.bands.length} Rating-Bändern (${(bytes / 1e6).toFixed(1)} MB).`, "");
out.push("## Herkunft", "", "| Quelle | Anzahl |", "|---|---|");
out.push(`| Eigener Generator (Stockfish-Selbstspiel) | ${own.length.toLocaleString("de-DE")} |`);
if (values.lichess) {
  out.push(`| Lichess-Puzzle-Datenbank (CC0) | ${lichess.length.toLocaleString("de-DE")} |`, "");
  out.push(
    `Aus ${stats.rows.toLocaleString("de-DE")} Lichess-Puzzles bestehen ${stats.quality.toLocaleString("de-DE")} den Qualitätsfilter ` +
      `(mindestens ${values["min-plays"]} Lösungsversuche, Beliebtheit ≥ ${values["min-popularity"]}, Rating-Abweichung ≤ ${values["max-deviation"]}). ` +
      `Daraus wird je Rating-Band eine feste Zahl gezogen (Reihenfolge nach Hash der ID, also reproduzierbar). ` +
      `${stats.invalid} Kandidaten fielen bei der Nachprüfung der Zugfolgen durch.`,
  );
}
out.push("", "## Verteilung nach Stufe", "", "| Stufe | Rating | Anzahl | Anteil |", "|---|---|---|---|");
for (const [k, d] of Object.entries(DIFFICULTIES)) {
  const n = pack.index.difficulties[k as Difficulty];
  out.push(`| ${d.label} | ${d.min}–${d.max >= 10_000 ? "" : d.max - 1} | ${n.toLocaleString("de-DE")} | ${pct(n)} |`);
}
out.push("", "## Rating-Bänder", "", "```");
const maxCount = Math.max(...pack.index.bands.map((b) => b.count));
for (const b of pack.index.bands) out.push(`${b.key}${b.max >= 10_000 ? "+   " : `–${String(b.max - 1).padEnd(4)}`}${"█".repeat(Math.round((40 * b.count) / maxCount))} ${b.count}`);
out.push("```", "", "## Themen", "", "| Thema | Anzahl |", "|---|---|");
for (const t of THEMES) if (pack.index.themes[t]) out.push(`| ${THEME_LABELS[t]} (\`${t}\`) | ${pack.index.themes[t]!.toLocaleString("de-DE")} |`);
out.push("", "## Lösungslänge", "", "| Lösungszüge | Anzahl |", "|---|---|");
for (let n = 1; n <= 7; n++) {
  const c = all.filter((p) => (n < 7 ? Math.floor(p.moves.length / 2) === n : Math.floor(p.moves.length / 2) >= 7)).length;
  if (c) out.push(`| ${n}${n === 7 ? "+" : ""} | ${c.toLocaleString("de-DE")} |`);
}
out.push("", `Feste Auswahlen: ${pack.storm.length} Puzzles für den Puzzle-Sturm, ${pack.daily.length} für das Tagespuzzle.`);
writeFileSync(REPORT, out.join("\n") + "\n");
console.log(out.slice(0, 22).join("\n"));
