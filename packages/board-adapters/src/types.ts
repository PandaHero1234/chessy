import type { Color } from "@chessy/shared";

export interface BoardPosition {
  fen: string;
  /** Letzter Zug in UCI (z. B. "e2e4"), falls vorhanden. */
  lastMove: string | null;
  /** Farbe, die dieses Brett spielt (`null` = Zuschauer). */
  myColor: Color | null;
  /** Ist das Brett gerade am Zug? */
  myTurn: boolean;
}

/**
 * Schnittstelle für alles, was Züge eingibt oder anzeigt: physische E-Boards (DGT, Chessnut, …),
 * Terminal, Sprachsteuerung, LED-Boards … Ein Adapter kennt die API nicht, das macht die `ApiBridge`.
 */
export interface BoardAdapter {
  readonly name: string;
  connect(): Promise<void>;
  /** Wird aufgerufen, wenn am Brett ein Zug gemacht wurde (UCI oder SAN). */
  onMove(cb: (move: string) => void): void;
  /** Neue Stellung vom Server. */
  setPosition(pos: BoardPosition): void;
  /** Statusmeldungen (Ergebnis, Fehler, „bitte Zug X ausführen“ …). */
  showMessage(text: string): void;
  close(): Promise<void>;
}
