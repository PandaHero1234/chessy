import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import type { AiLevel, AnalysisResult, Color } from "@chessy/shared";

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

/**
 * Spielstärken. Stockfish "Skill Level" (0–20) plus begrenzte Suchtiefe und Bedenkzeit.
 * Stufe 1 macht bewusst grobe Fehler, Stufe 8 spielt mit voller Stärke.
 */
export const LEVELS: Record<AiLevel, { skill: number; depth: number; movetime: number; label: string }> = {
  1: { skill: 0, depth: 1, movetime: 50, label: "Einsteiger" },
  2: { skill: 3, depth: 2, movetime: 100, label: "Anfänger" },
  3: { skill: 6, depth: 3, movetime: 150, label: "Gelegenheitsspieler" },
  4: { skill: 9, depth: 5, movetime: 200, label: "Vereinsspieler" },
  5: { skill: 11, depth: 8, movetime: 300, label: "Fortgeschritten" },
  6: { skill: 14, depth: 12, movetime: 500, label: "Experte" },
  7: { skill: 17, depth: 16, movetime: 800, label: "Meister" },
  8: { skill: 20, depth: 22, movetime: 1200, label: "Großmeister" },
};

export interface MoveRequest {
  initialFen: string;
  moves: string[];
  level: AiLevel;
  /** Verbleibende Zeit der KI in ms (null = unbegrenzt). */
  timeLeft: number | null;
  increment: number;
}

export interface Engine {
  bestMove(req: MoveRequest): Promise<string>;
  analyse(fen: string, depth: number): Promise<AnalysisResult>;
  close(): void;
}

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
    const lvl = LEVELS[req.level];
    let movetime = lvl.movetime;
    // Nie mehr als ~1/30 der Restzeit (+ Inkrement) verbrauchen.
    if (req.timeLeft !== null) movetime = Math.max(20, Math.min(movetime, req.timeLeft / 30 + req.increment / 2));
    const position = `position fen ${req.initialFen}${req.moves.length ? ` moves ${req.moves.join(" ")}` : ""}`;
    const lines = await this.pick().run([
      `setoption name Skill Level value ${lvl.skill}`,
      "ucinewgame",
      position,
      `go depth ${lvl.depth} movetime ${Math.round(movetime)}`,
    ]);
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

export function parseAnalysis(fen: string, lines: string[], turn: Color): AnalysisResult {
  const sign = turn === "white" ? 1 : -1;
  let result: AnalysisResult = { fen, depth: 0, bestmove: null, eval: { cp: 0 }, pv: [] };
  for (const line of lines) {
    const info = /^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)(?:.*\bpv (.+))?/.exec(line);
    if (info && !/\bupperbound|lowerbound\b/.test(line)) {
      const v = Number(info[3]) * sign;
      result = {
        ...result,
        depth: Number(info[1]),
        eval: info[2] === "cp" ? { cp: v } : { mate: v },
        pv: info[4]?.split(" ") ?? result.pv,
      };
    }
    const bm = /^bestmove (\S+)/.exec(line);
    if (bm) result.bestmove = bm[1] === "(none)" ? null : bm[1]!;
  }
  return result;
}
