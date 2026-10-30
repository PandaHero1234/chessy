import { describe, expect, it, vi } from "vitest";
import { DGT, DgtAdapter, DgtParser, placementFromFields } from "../src/adapters/dgt.ts";
import { detectMove } from "../src/moveDetection.ts";
import { renderBoard } from "../src/adapters/console.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Startstellung in DGT-Codes (Index 0 = a8). */
const startFields = () => {
  const back = [2, 3, 4, 6, 5, 4, 3, 2];
  return [...back.map((p) => p + 6), ...Array(8).fill(7), ...Array(32).fill(0), ...Array(8).fill(1), ...back];
};
const dump = (fields: number[]) => [DGT.MSG_BOARD_DUMP, 0, 67, ...fields];
const update = (field: number, piece: number) => [DGT.MSG_FIELD_UPDATE, 0, 5, field, piece];
const idx = (sq: string) => (8 - Number(sq[1])) * 8 + "abcdefgh".indexOf(sq[0]!);

describe("Zugerkennung", () => {
  it("erkennt normale Züge, Rochade, en passant und Umwandlung", () => {
    expect(detectMove(START, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR")).toBe("e2e4");
    expect(detectMove("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "r3k2r/8/8/8/8/8/8/R4RK1")).toBe("e1g1");
    expect(detectMove("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", "4k3/8/3P4/8/8/8/8/4K3")).toBe("e5d6");
    expect(detectMove("8/P6k/8/8/8/8/8/K7 w - - 0 1", "N7/7k/8/8/8/8/8/K7")).toBe("a7a8n");
    expect(detectMove(START, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toBeNull();
  });
});

describe("DGT", () => {
  it("parst Board-Dump und Feld-Updates, auch über Chunk-Grenzen", () => {
    const p = new DgtParser();
    const bytes = [0x00, ...dump(startFields()), ...update(idx("e2"), 0)];
    expect(p.push(bytes.slice(0, 20))).toEqual([]);
    const msgs = p.push(bytes.slice(20));
    expect(msgs[0]!.type).toBe("boardDump");
    expect(msgs[1]).toEqual({ type: "fieldUpdate", field: idx("e2"), piece: 0 });
    expect(placementFromFields(startFields())).toBe(START.split(" ")[0]);
  });

  it("sendet einen Zug, sobald die Brettstellung einem legalen Zug entspricht", async () => {
    vi.useFakeTimers();
    const writes: number[][] = [];
    const adapter = new DgtAdapter({ write: (b) => void writes.push([...b]), onData: () => undefined, close: () => undefined }, { settleMs: 10, log: () => undefined });
    const moves: string[] = [];
    adapter.onMove((m) => moves.push(m));
    await adapter.connect();
    expect(writes.map((w) => w[0])).toEqual([DGT.SEND_RESET, DGT.SEND_BRD, DGT.SEND_UPDATE_BRD]);

    adapter.setPosition({ fen: START, lastMove: null, myColor: "white", myTurn: true });
    adapter.onBytes(dump(startFields()));
    adapter.onBytes(update(idx("g1"), 0));
    vi.advanceTimersByTime(20);
    expect(moves).toEqual([]); // Springer angehoben, noch nicht abgestellt
    adapter.onBytes(update(idx("f3"), 3));
    vi.advanceTimersByTime(20);
    expect(moves).toEqual(["g1f3"]);
    vi.useRealTimers();
  });
});

describe("ConsoleAdapter", () => {
  it("zeichnet das Brett aus Sicht von Schwarz", () => {
    const out = renderBoard(START, "black");
    expect(out.split("\n")[0]!.startsWith("1")).toBe(true);
    expect(out).toContain("♔");
  });
});
