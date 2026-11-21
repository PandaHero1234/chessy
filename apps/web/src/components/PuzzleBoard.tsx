import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { checkMoves, type CheckResponse, type Puzzle, type PuzzlePublic } from "@chessy/puzzles";
import { Board } from "./Board.tsx";
import { api } from "../lib/api.ts";
import { play } from "../lib/sound.ts";
import { haptic } from "../lib/haptics.ts";

export type PuzzlePhase = "intro" | "play" | "busy" | "solved" | "failed";

export interface PuzzleOutcome {
  status: "solved" | "failed";
  /** Erster Versuch richtig (ohne Fehler)? */
  clean: boolean;
  rating?: CheckResponse["rating"];
  themes?: string[];
  solution?: string[];
}

interface Props {
  puzzle: PuzzlePublic;
  /** Vollständiges Puzzle (Sturm): Prüfung lokal statt per API. */
  full?: Puzzle;
  /** Bei Fehler sofort beenden (Sturm) statt weiterprobieren zu lassen. */
  failFast?: boolean;
  onOutcome?: (o: PuzzleOutcome) => void;
  onPhase?: (p: PuzzlePhase, info: { feedback: "good" | "bad" | null; solverIndex: number }) => void;
  /** Erhöhen, um einen Tipp anzufordern: erst die Figur, beim zweiten Mal das Zielfeld. */
  hintSignal?: number;
  /** Meldet die aktuell gezeigte Tipp-Stufe (0 = keiner). */
  onHintLevel?: (level: 0 | 1 | 2) => void;
  introDelay?: number;
}

function apply(fen: string, uci: string) {
  const c = new Chess(fen);
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  play(c.isCheck() ? "check" : m.captured ? "capture" : m.san.startsWith("O-O") ? "castle" : "move");
  return { fen: c.fen(), last: [m.from, m.to] as [string, string] };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Brett mit Puzzle-Ablauf: Gegnerzug vorspielen, eigene Züge prüfen, Antworten ausführen, Tipps anzeigen. */
export function PuzzleBoard({ puzzle, full, failFast, onOutcome, onPhase, hintSignal = 0, onHintLevel, introDelay = 600 }: Props) {
  const [fen, setFen] = useState(puzzle.fen);
  const [last, setLast] = useState<[string, string] | null>(null);
  const [phase, setPhase] = useState<PuzzlePhase>("intro");
  const [marks, setMarks] = useState<{ square: string; kind: "hint" | "good" | "bad" }[]>([]);
  const [shapes, setShapes] = useState<{ from: string; to: string; kind: "hint" }[]>([]);
  const [shake, setShake] = useState(false);
  const solver = useRef<string[]>([]);
  const failed = useRef(false);
  const alive = useRef(true);
  const hintLevel = useRef<0 | 1 | 2>(0);
  const orientation = puzzle.color;

  const setP = useCallback(
    (p: PuzzlePhase, feedback: "good" | "bad" | null = null) => {
      setPhase(p);
      onPhase?.(p, { feedback, solverIndex: solver.current.length });
    },
    [onPhase],
  );

  const clearHint = useCallback(() => {
    hintLevel.current = 0;
    setShapes([]);
    onHintLevel?.(0);
  }, [onHintLevel]);

  // Neues Puzzle: Ausgangsstellung zeigen, dann den Fehler des Gegners vorspielen.
  useEffect(() => {
    alive.current = true;
    solver.current = [];
    failed.current = false;
    setFen(puzzle.fen);
    setLast(null);
    setMarks([]);
    clearHint();
    setP("intro");
    const t = setTimeout(() => {
      if (!alive.current) return;
      const r = apply(puzzle.fen, puzzle.initial_move);
      setFen(r.fen);
      setLast(r.last);
      setP("play");
    }, introDelay);
    return () => {
      alive.current = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const check = useCallback(
    async (moves: string[]): Promise<CheckResponse> => (full ? checkMoves(full, moves) : api.puzzles.check(puzzle.id, moves)),
    [full, puzzle.id],
  );

  const onMove = async (from: string, to: string, promotion?: string) => {
    if (phase !== "play") return;
    const uci = from + to + (promotion ?? "");
    const before = fen;
    const moved = apply(fen, uci);
    setFen(moved.fen);
    setLast(moved.last);
    setMarks([]);
    clearHint();
    setP("busy");
    let r: CheckResponse;
    try {
      r = await check([...solver.current, uci]);
    } catch (e) {
      setFen(before);
      setP("play");
      throw e;
    }
    if (!alive.current) return;
    if (r.status === "wrong") {
      failed.current = true;
      setMarks([{ square: to, kind: "bad" }]);
      setShake(true);
      setTimeout(() => alive.current && setShake(false), 450);
      play("illegal");
      haptic("bad");
      if (failFast) {
        setP("failed", "bad");
        onOutcome?.({ status: "failed", clean: false, rating: r.rating });
        return;
      }
      setP("busy", "bad");
      if (r.rating) onOutcome?.({ status: "failed", clean: false, rating: r.rating });
      await wait(750);
      if (!alive.current) return;
      setFen(before);
      setLast(null);
      setMarks([]);
      setP("play", "bad");
      return;
    }
    solver.current = [...solver.current, uci];
    setMarks([{ square: to, kind: "good" }]);
    if (r.status === "solved") {
      haptic("good");
      setP("solved", "good");
      onOutcome?.({ status: "solved", clean: !failed.current, rating: r.rating, themes: r.themes, solution: r.solution });
      return;
    }
    haptic("tap");
    setP("busy", "good");
    await wait(380);
    if (!alive.current) return;
    const reply = apply(moved.fen, r.reply);
    setFen(reply.fen);
    setLast(reply.last);
    setMarks([]);
    setP("play", "good");
  };

  // Tipp: erst die Figur markieren, beim zweiten Antippen zusätzlich das Zielfeld als Pfeil.
  useEffect(() => {
    if (!hintSignal || phase !== "play") return;
    const level = hintLevel.current === 0 ? 1 : 2;
    const solved = solver.current.length;
    const move = full?.moves[1 + 2 * solved];
    const request = move ? Promise.resolve({ square: move.slice(0, 2), to: level === 2 ? move.slice(2, 4) : null }) : api.puzzles.hint(puzzle.id, solved, level);
    request.then(
      (h) => {
        if (!alive.current || !h.square || solver.current.length !== solved) return;
        hintLevel.current = level;
        onHintLevel?.(level);
        setMarks([{ square: h.square, kind: "hint" }]);
        setShapes(h.to ? [{ from: h.square, to: h.to, kind: "hint" }] : []);
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintSignal]);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const dests = useMemo(() => {
    const m = new Map<string, string[]>();
    if (phase !== "play") return m;
    for (const mv of chess.moves({ verbose: true })) m.set(mv.from, [...(m.get(mv.from) ?? []), mv.to]);
    return m;
  }, [chess, phase]);
  const checkSq = chess.inCheck() ? (chess.board().flat().find((s) => s?.type === "k" && s.color === chess.turn())?.square ?? null) : null;

  return (
    <div className={`puzzle-board ${shake ? "shake" : ""}`} data-puzzle-id={puzzle.id} data-phase={phase}>
      <Board
        fen={fen}
        orientation={orientation}
        lastMove={last}
        check={checkSq}
        movable={phase === "play" ? orientation : null}
        dests={dests}
        onMove={(f, t, p) => void onMove(f, t, p).catch(() => undefined)}
        marks={marks}
        shapes={shapes}
      />
    </div>
  );
}
