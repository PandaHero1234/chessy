import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import type { AnalysisResult, Color } from "@chessy/shared";
import type { Engine, MoveRequest } from "../game/ports.ts";
import { AI_LEVEL_SETTINGS, aiMoveTime, aiSearchCommands, parseAnalysis } from "@chessy/shared";

const require = createRequire(import.meta.url);
const findEngine: (flavor: string) => string = require("stockfish").findEngine;

interface Job {
  commands: string[];
  terminator: RegExp;
  done: (lines: string[]) => void;
  fail: (err: Error) => void;
}

/** Eine Stockfish-Instanz (WASM, Single-Thread) als Kindprozess; spricht UCI über stdin/stdout. */
class EngineProcess {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private lines: string[] = [];
  private current: Job | null = null;
  private queue: Job[] = [];
  dead = false;

  constructor() {
    this.proc = spawn(process.execPath, [findEngine("lite-single")], { stdio: "pipe" });
    this.proc.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
    this.proc.on("exit", () => {
      this.dead = true;
      const err = new Error("Stockfish wurde beendet");
      this.current?.fail(err);
      for (const j of this.queue) j.fail(err);
      this.queue = [];
      this.current = null;
    });
    void this.run(["uci"], /^uciok/);
  }

  get load() {
    return this.queue.length + (this.current ? 1 : 0);
  }

  run(commands: string[], terminator = /^bestmove/): Promise<string[]> {
    return new Promise((done, fail) => {
      if (this.dead) return fail(new Error("Stockfish ist nicht verfügbar"));
      this.queue.push({ commands, terminator, done, fail });
      if (!this.current) this.next();
    });
  }

  kill() {
    this.proc.kill();
  }

  private next() {
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.lines = [];
    this.proc.stdin.write(job.commands.join("\n") + "\n");
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      const job = this.current;
      if (!job) continue;
      this.lines.push(line);
      if (job.terminator.test(line)) {
        this.current = null;
        job.done(this.lines);
        this.next();
      }
    }
  }
}

export const LEVELS = AI_LEVEL_SETTINGS;
export { parseAnalysis };

export type { Engine, MoveRequest };

/** Kleiner Pool von Engine-Prozessen, die lazy gestartet werden. */
export class StockfishPool implements Engine {
  private engines: EngineProcess[] = [];

  constructor(private readonly size = 2) {}

  private pick(): EngineProcess {
    this.engines = this.engines.filter((e) => !e.dead);
    const idle = this.engines.find((e) => e.load === 0);
    if (idle) return idle;
    if (this.engines.length < this.size) {
      const e = new EngineProcess();
      this.engines.push(e);
      return e;
    }
    return this.engines.reduce((a, b) => (a.load <= b.load ? a : b));
  }

  async bestMove(req: MoveRequest): Promise<string> {
    const movetime = aiMoveTime(req.level, req.timeLeft, req.increment);
    const lines = await this.pick().run(aiSearchCommands(req.level, req.initialFen, req.moves, movetime));
    const best = /^bestmove (\S+)/.exec(lines[lines.length - 1] ?? "")?.[1];
    if (!best || best === "(none)") throw new Error("Engine hat keinen Zug gefunden");
    return best;
  }

  async analyse(fen: string, depth: number): Promise<AnalysisResult> {
    const lines = await this.pick().run([
      "setoption name Skill Level value 20",
      "ucinewgame",
      `position fen ${fen}`,
      `go depth ${depth}`,
    ]);
    const turn: Color = fen.split(" ")[1] === "b" ? "black" : "white";
    return parseAnalysis(fen, lines, turn);
  }

  close() {
    for (const e of this.engines) e.kill();
    this.engines = [];
  }
}
