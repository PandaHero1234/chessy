import type { Color, GameSnapshot } from "@chessy/shared";
import type { BoardAdapter } from "./types.ts";
import type { ChessyClient } from "./client.ts";

const RESULT_TEXT: Record<string, string> = { "1-0": "Weiß gewinnt", "0-1": "Schwarz gewinnt", "1/2-1/2": "Remis" };

/**
 * Verbindet einen BoardAdapter mit der Chessy-API:
 * hört auf neue Partien des Accounts, spiegelt Stellungen aufs Brett und schickt Brett-Züge an den Server.
 */
export class ApiBridge {
  private gameId: string | null = null;
  private myColor: Color | null = null;
  private abort = new AbortController();
  /** Zug, der eingegeben wurde, bevor die Partie bekannt war. */
  private queued: string | null = null;

  constructor(
    private readonly client: ChessyClient,
    private readonly adapter: BoardAdapter,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {
    adapter.onMove((move) => {
      if (!this.gameId) {
        this.queued = move;
        return adapter.showMessage(`Noch keine laufende Partie, ${move} ist vorgemerkt`);
      }
      this.send(move);
    });
  }

  async start() {
    await this.adapter.connect();
    const me = await this.client.account();
    this.log(`Verbunden als ${me.username} mit Adapter "${this.adapter.name}". Warte auf Partien…`);
    for await (const e of this.client.streamEvents(this.abort.signal)) {
      if (e.type === "gameStart" && e.game.id !== this.gameId) {
        this.log(`▶ Partie ${e.game.id} gegen ${e.game.opponent} (${e.game.time_control}), du spielst ${e.game.color === "white" ? "Weiß" : "Schwarz"}`);
        void this.follow(e.game.id, e.game.color);
      }
    }
  }

  /** Einer bestimmten Partie folgen (z. B. direkt nach dem Erstellen). */
  async follow(gameId: string, color: Color) {
    this.gameId = gameId;
    this.myColor = color;
    let snap: GameSnapshot | null = null;
    for await (const e of this.client.streamGame(gameId, this.abort.signal)) {
      if (this.gameId !== gameId) return;
      if (e.type === "gameFull") snap = e.game;
      else if (e.type === "gameState" && snap) {
        const { type: _type, last_move: _lm, last_san: _ls, ...state } = e;
        snap = { ...(snap as GameSnapshot), ...state, turn: e.fen.split(" ")[1] === "w" ? "white" : "black" };
      }
      else if (e.type === "chatLine") this.log(`💬 ${e.line.username}: ${e.line.text}`);
      if (!snap) continue;
      const moves = snap.moves.split(" ").filter(Boolean);
      const myTurn = snap.status === "started" && snap.turn === this.myColor;
      this.adapter.setPosition({ fen: snap.fen, lastMove: moves[moves.length - 1] ?? null, myColor: this.myColor, myTurn });
      if (myTurn && this.queued) {
        this.send(this.queued);
        this.queued = null;
      }
      if (snap.status === "ended" || snap.status === "aborted") {
        this.adapter.showMessage(snap.status === "aborted" ? "Partie abgebrochen" : `${RESULT_TEXT[snap.result] ?? snap.result} (${snap.termination})`);
        this.gameId = null;
        return;
      }
    }
  }

  private send(move: string) {
    if (!this.gameId) return;
    this.client.move(this.gameId, move).catch((e: Error) => this.adapter.showMessage(`Zug abgelehnt: ${e.message}`));
  }

  async stop() {
    this.abort.abort();
    await this.adapter.close();
  }
}
