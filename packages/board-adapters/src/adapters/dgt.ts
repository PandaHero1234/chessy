import type { BoardAdapter, BoardPosition } from "../types.ts";
import { detectMove, diffSquares, placementOf } from "../moveDetection.ts";

/**
 * DGT-E-Board-Protokoll (USB/Seriell, 9600 Baud, 8N1). Experimentell, ohne Hardware nur per Unit-Test geprüft.
 * Quelle: DGT „Electronic Chessboard communication protocol“.
 */
export const DGT = {
  SEND_RESET: 0x40,
  SEND_BRD: 0x42,
  SEND_UPDATE_BRD: 0x44,
  SEND_UPDATE_NICE: 0x4b,
  RETURN_SERIALNR: 0x45,
  SEND_VERSION: 0x4d,
  MSG_BOARD_DUMP: 0x86,
  MSG_FIELD_UPDATE: 0x8e,
  MSG_SERIALNR: 0x91,
  MSG_VERSION: 0x93,
} as const;

/** DGT-Figurencodes → FEN-Zeichen (0 = leer). */
const PIECES = ["", "P", "R", "N", "B", "K", "Q", "p", "r", "n", "b", "k", "q"];

/** 64 Felder (Index 0 = a8 … 63 = h1, Brett mit Weiß unten) → FEN-Figurenteil. */
export function placementFromFields(fields: ArrayLike<number>, flipped = false): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = "";
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const idx = flipped ? 63 - (r * 8 + c) : r * 8 + c;
      const p = PIECES[fields[idx]!] ?? "";
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    rows.push(row + (empty ? empty : ""));
  }
  return rows.join("/");
}

export type DgtMessage = { type: "boardDump"; fields: number[] } | { type: "fieldUpdate"; field: number; piece: number } | { type: "other"; id: number; data: number[] };

/** Zerlegt den Bytestrom des Bretts in Nachrichten. Header: [id | 0x80, size >> 7, size & 0x7f], size inkl. Header. */
export class DgtParser {
  private buf: number[] = [];

  push(chunk: ArrayLike<number>): DgtMessage[] {
    for (let i = 0; i < chunk.length; i++) this.buf.push(chunk[i]!);
    const out: DgtMessage[] = [];
    for (;;) {
      // Bis zum nächsten gültigen Nachrichtenbeginn verwerfen.
      while (this.buf.length && (this.buf[0]! & 0x80) === 0) this.buf.shift();
      if (this.buf.length < 3) break;
      const size = ((this.buf[1]! & 0x7f) << 7) | (this.buf[2]! & 0x7f);
      if (size < 3) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < size) break;
      const msg = this.buf.splice(0, size);
      const id = msg[0]!;
      const data = msg.slice(3);
      if (id === DGT.MSG_BOARD_DUMP && data.length === 64) out.push({ type: "boardDump", fields: data });
      else if (id === DGT.MSG_FIELD_UPDATE && data.length === 2) out.push({ type: "fieldUpdate", field: data[0]!, piece: data[1]! });
      else out.push({ type: "other", id, data });
    }
    return out;
  }
}

/** Minimaler Transport (z. B. `serialport` in Node oder WebSerial im Browser). */
export interface ByteTransport {
  write(bytes: Uint8Array): void | Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): void;
  close(): void | Promise<void>;
}

/**
 * Adapter für DGT-Bretter. Erkennt Züge, sobald die physische Stellung einem legalen Zug entspricht.
 * Der Gegnerzug muss am Brett nachgezogen werden; bis dahin werden keine eigenen Züge gesendet.
 */
export class DgtAdapter implements BoardAdapter {
  readonly name = "dgt";
  private parser = new DgtParser();
  private fields = new Array<number>(64).fill(0);
  private position: BoardPosition | null = null;
  private cb: ((m: string) => void) | null = null;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private sentFor: string | null = null;

  constructor(
    private readonly transport: ByteTransport,
    private readonly opts: { flipped?: boolean; settleMs?: number; log?: (m: string) => void } = {},
  ) {}

  async connect() {
    this.transport.onData((b) => this.onBytes(b));
    await this.transport.write(Uint8Array.of(DGT.SEND_RESET));
    await this.transport.write(Uint8Array.of(DGT.SEND_BRD));
    await this.transport.write(Uint8Array.of(DGT.SEND_UPDATE_BRD));
  }

  onMove(cb: (move: string) => void) {
    this.cb = cb;
  }

  setPosition(pos: BoardPosition) {
    this.position = pos;
    this.sentFor = null;
    this.evaluate();
  }

  showMessage(text: string) {
    (this.opts.log ?? console.log)(`[DGT] ${text}`);
  }

  async close() {
    await this.transport.close();
  }

  /** Aktuelle physische Stellung als FEN-Figurenteil. */
  get placement() {
    return placementFromFields(this.fields, this.opts.flipped);
  }

  onBytes(bytes: ArrayLike<number>) {
    for (const msg of this.parser.push(bytes)) {
      if (msg.type === "boardDump") this.fields = msg.fields;
      else if (msg.type === "fieldUpdate" && msg.field < 64) this.fields[msg.field] = msg.piece;
      else continue;
      if (this.settle) clearTimeout(this.settle);
      // Kurz warten, bis Figuren abgestellt sind (Schlagzüge = mehrere Feld-Updates).
      this.settle = setTimeout(() => this.evaluate(), this.opts.settleMs ?? 250);
    }
  }

  private evaluate() {
    const pos = this.position;
    if (!pos) return;
    const physical = this.placement;
    const expected = placementOf(pos.fen);
    if (physical === expected) return;
    if (pos.myTurn) {
      const move = detectMove(pos.fen, physical);
      if (move && this.sentFor !== pos.fen) {
        this.sentFor = pos.fen;
        this.cb?.(move);
        return;
      }
    }
    const diff = diffSquares(physical, expected);
    if (!pos.myTurn && pos.lastMove) this.showMessage(`Bitte Gegnerzug ${pos.lastMove} am Brett ausführen`);
    else if (diff.length > 4) this.showMessage(`Brett weicht ab auf: ${diff.join(", ")}`);
  }
}
