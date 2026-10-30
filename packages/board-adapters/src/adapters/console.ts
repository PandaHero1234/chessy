import { createInterface, type Interface } from "node:readline";
import type { BoardAdapter, BoardPosition } from "../types.ts";

const GLYPHS: Record<string, string> = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

/** Terminal-„Brett“: zeigt die Stellung als Unicode-Diagramm und liest Züge von stdin. Ideal zum Testen der API. */
export class ConsoleAdapter implements BoardAdapter {
  readonly name = "console";
  private rl: Interface | null = null;
  private cb: ((m: string) => void) | null = null;

  constructor(
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  async connect() {
    this.rl = createInterface({ input: this.input, output: this.output, terminal: false });
    this.rl.on("line", (line) => {
      const m = line.trim();
      if (m) this.cb?.(m);
    });
  }

  onMove(cb: (move: string) => void) {
    this.cb = cb;
  }

  setPosition(pos: BoardPosition) {
    this.output.write(`\n${renderBoard(pos.fen, pos.myColor ?? "white", pos.lastMove)}\n`);
    if (pos.lastMove) this.output.write(`Letzter Zug: ${pos.lastMove}\n`);
    if (pos.myTurn) this.output.write("Dein Zug (z. B. e2e4 oder Nf3): ");
  }

  showMessage(text: string) {
    this.output.write(`\n» ${text}\n`);
  }

  async close() {
    this.rl?.close();
  }
}

export function renderBoard(fen: string, orientation: "white" | "black", lastMove: string | null = null): string {
  const rows = fen.split(" ")[0]!.split("/").map((r) => r.replace(/\d/g, (d) => ".".repeat(Number(d))).split(""));
  const files = "abcdefgh";
  const ranks = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const hl = new Set(lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : []);
  const lines = ranks.map((r) => {
    const cells = cols.map((c) => {
      const sq = files[c]! + (8 - r);
      const p = rows[r]![c]!;
      const g = p === "." ? ((r + c) % 2 ? "·" : " ") : GLYPHS[p]!;
      return hl.has(sq) ? `[${g}]` : ` ${g} `;
    });
    return `${8 - r} ${cells.join("")}`;
  });
  lines.push(`   ${cols.map((c) => files[c]).join("  ")}`);
  return lines.join("\n");
}
