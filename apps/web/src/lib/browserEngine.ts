import { type AnalysisResult, type Color, aiMoveTime, aiSearchCommands, parseAnalysis } from "@chessy/shared";
import type { Engine, MoveRequest } from "../../../server/src/game/ports.ts";
import { BASE } from "./paths.ts";

interface Job {
  commands: string[];
  terminator: RegExp;
  done: (lines: string[]) => void;
  fail: (e: Error) => void;
}

/**
 * Stockfish (WASM, single-threaded, "lite"-Netz) als Web Worker. Gleiche UCI-Befehle und Stufen wie auf dem Server.
 * Die Engine-Dateien liegen unter `<BASE>engine/` (kopiert von vite.config.ts).
 */
export class BrowserEngine implements Engine {
  private worker: Worker | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private lines: string[] = [];

  private ensure() {
    if (this.worker) return;
    this.worker = new Worker(`${BASE}engine/stockfish-19-lite-single.js`);
    this.worker.onmessage = (e: MessageEvent) => this.onLine(String(e.data));
    this.worker.onerror = () => {
      const err = new Error("Stockfish konnte im Browser nicht geladen werden");
      this.current?.fail(err);
      for (const j of this.queue) j.fail(err);
      this.queue = [];
      this.current = null;
      this.worker = null;
    };
    void this.run(["uci"], /^uciok/);
  }

  private run(commands: string[], terminator = /^bestmove/): Promise<string[]> {
    this.ensure();
    return new Promise((done, fail) => {
      this.queue.push({ commands, terminator, done, fail });
      if (!this.current) this.next();
    });
  }

  private next() {
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.lines = [];
    for (const c of job.commands) this.worker!.postMessage(c);
  }

  private onLine(chunk: string) {
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      const job = this.current;
      if (!job || !line) continue;
      this.lines.push(line);
      if (job.terminator.test(line)) {
        this.current = null;
        job.done(this.lines);
        this.next();
      }
    }
  }

  async bestMove(req: MoveRequest): Promise<string> {
    const movetime = aiMoveTime(req.level, req.timeLeft, req.increment);
    const lines = await this.run(aiSearchCommands(req.level, req.initialFen, req.moves, movetime));
    const best = /^bestmove (\S+)/.exec(lines[lines.length - 1] ?? "")?.[1];
    if (!best || best === "(none)") throw new Error("Engine hat keinen Zug gefunden");
    return best;
  }

  async analyse(fen: string, depth: number): Promise<AnalysisResult> {
    const lines = await this.run(["setoption name Skill Level value 20", "ucinewgame", `position fen ${fen}`, `go depth ${depth}`]);
    const turn: Color = fen.split(" ")[1] === "b" ? "black" : "white";
    return parseAnalysis(fen, lines, turn);
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
  }
}
