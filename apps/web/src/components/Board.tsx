import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Color } from "@chessy/shared";
import { BOARD_THEMES, useSettings } from "../lib/settings.ts";

type PieceCode = `${"w" | "b"}${"K" | "Q" | "R" | "B" | "N" | "P"}`;
interface PlacedPiece {
  id: number;
  square: string;
  code: PieceCode;
}

export interface BoardProps {
  fen: string;
  orientation: Color;
  lastMove?: [string, string] | null;
  check?: string | null;
  /** Welche Farbe darf ziehen ("both" bei lokalen Partien). */
  movable: Color | "both" | null;
  /** Legale Ziele pro Startfeld. */
  dests: Map<string, string[]>;
  onMove?: (from: string, to: string, promotion?: string) => void;
}

const FILES = "abcdefgh";
const PROMO_PIECES = ["q", "n", "r", "b"] as const;

function parseFen(fen: string): { square: string; code: PieceCode }[] {
  const out: { square: string; code: PieceCode }[] = [];
  const rows = fen.split(" ")[0]!.split("/");
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        out.push({ square: FILES[file]! + (8 - i), code: `${color}${ch.toUpperCase()}` as PieceCode });
        file++;
      }
    }
  });
  return out;
}

const sqXY = (sq: string) => ({ f: FILES.indexOf(sq[0]!), r: Number(sq[1]) - 1 });
const dist = (a: string, b: string) => {
  const p = sqXY(a);
  const q = sqXY(b);
  return Math.abs(p.f - q.f) + Math.abs(p.r - q.r);
};

let nextId = 1;
/** Ordnet Figuren stabile IDs zu, damit Züge (auch Rochade, Rücknahme) animiert werden. */
function assignIds(prev: PlacedPiece[], next: { square: string; code: PieceCode }[]): PlacedPiece[] {
  const unmatchedPrev = new Map(prev.map((p) => [p.id, p]));
  const result: (PlacedPiece | null)[] = next.map((n) => {
    const same = prev.find((p) => p.square === n.square && p.code === n.code && unmatchedPrev.has(p.id));
    if (same) {
      unmatchedPrev.delete(same.id);
      return { ...same };
    }
    return null;
  });
  next.forEach((n, i) => {
    if (result[i]) return;
    let best: PlacedPiece | null = null;
    for (const p of unmatchedPrev.values()) {
      if (p.code === n.code && (!best || dist(p.square, n.square) < dist(best.square, n.square))) best = p;
    }
    if (best) {
      unmatchedPrev.delete(best.id);
      result[i] = { id: best.id, square: n.square, code: n.code };
    } else result[i] = { id: nextId++, square: n.square, code: n.code };
  });
  return result as PlacedPiece[];
}

interface Arrow {
  from: string;
  to: string;
}

export function Board({ fen, orientation, lastMove, check, movable, dests, onMove }: BoardProps) {
  const settings = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme];
  const boardRef = useRef<HTMLDivElement>(null);
  const piecesRef = useRef<PlacedPiece[]>([]);
  const fenRef = useRef<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ square: string; id: number; x: number; y: number; started: boolean } | null>(null);
  const [instantId, setInstantId] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; color: "w" | "b" } | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [circles, setCircles] = useState<string[]>([]);
  const rightStart = useRef<string | null>(null);

  if (fenRef.current !== fen) {
    piecesRef.current = assignIds(piecesRef.current, parseFen(fen));
    fenRef.current = fen;
  }
  const pieces = piecesRef.current;
  const pieceAt = useMemo(() => new Map(pieces.map((p) => [p.square, p])), [pieces]);

  // Neue Stellung → Auswahl, Pfeile und Promotion-Dialog zurücksetzen.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
    setArrows([]);
    setCircles([]);
    const t = setTimeout(() => setInstantId(null), 50);
    return () => clearTimeout(t);
  }, [fen]);

  const white = orientation === "white";
  const toXY = (sq: string) => {
    const { f, r } = sqXY(sq);
    return { col: white ? f : 7 - f, row: white ? 7 - r : r };
  };
  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
      const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      const f = white ? col : 7 - col;
      const r = white ? 7 - row : row;
      return FILES[f]! + (r + 1);
    },
    [white],
  );

  const canMove = (sq: string) => {
    const p = pieceAt.get(sq);
    if (!p || !movable || !onMove) return false;
    const color = p.code[0] === "w" ? "white" : "black";
    return (movable === "both" || movable === color) && (dests.get(sq)?.length ?? 0) > 0;
  };

  const tryMove = (from: string, to: string, dropped = false) => {
    if (!dests.get(from)?.includes(to)) return false;
    const p = pieceAt.get(from)!;
    if (dropped) setInstantId(p.id);
    if (p.code[1] === "P" && (to[1] === "8" || to[1] === "1")) {
      if (settings.autoQueen) onMove?.(from, to, "q");
      else setPromo({ from, to, color: p.code[0] as "w" | "b" });
      return true;
    }
    onMove?.(from, to);
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      rightStart.current = squareFromPoint(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0 || promo) return;
    setArrows([]);
    setCircles([]);
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (selected && selected !== sq && dests.get(selected)?.includes(sq)) {
      tryMove(selected, sq);
      setSelected(null);
      return;
    }
    if (canMove(sq)) {
      const rect = boardRef.current!.getBoundingClientRect();
      setSelected(sq);
      setDrag({ square: sq, id: pieceAt.get(sq)!.id, x: e.clientX - rect.left, y: e.clientY - rect.top, started: false });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else setSelected(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const moved = drag.started || Math.hypot(x - drag.x, y - drag.y) > 4;
    setDrag({ ...drag, x, y, started: moved });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button === 2) {
      const start = rightStart.current;
      const end = squareFromPoint(e.clientX, e.clientY);
      rightStart.current = null;
      if (!start || !end) return;
      if (start === end) setCircles((c) => (c.includes(end) ? c.filter((s) => s !== end) : [...c, end]));
      else
        setArrows((a) =>
          a.some((x) => x.from === start && x.to === end) ? a.filter((x) => !(x.from === start && x.to === end)) : [...a, { from: start, to: end }],
        );
      return;
    }
    if (!drag) return;
    const target = squareFromPoint(e.clientX, e.clientY);
    if (drag.started && target && target !== drag.square) {
      if (tryMove(drag.square, target, true)) setSelected(null);
    }
    setDrag(null);
  };

  const highlightDests = selected ? (dests.get(selected) ?? []) : [];
  const files = white ? FILES.split("") : FILES.split("").reverse();
  const ranks = white ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = files[col]! + ranks[row]!;
      const light = (col + row) % 2 === 0;
      const isLast = lastMove && (lastMove[0] === sq || lastMove[1] === sq);
      const isSel = selected === sq;
      let bg: string = light ? theme.light : theme.dark;
      if (isLast) bg = light ? theme.lastLight : theme.lastDark;
      if (isSel) bg = light ? theme.lastLight : theme.lastDark;
      squares.push(
        <div key={sq} className="sq" style={{ background: bg }} data-square={sq}>
          {settings.coordinates && col === 0 && (
            <span className="coord rank" style={{ color: light ? theme.dark : theme.light }}>
              {ranks[row]}
            </span>
          )}
          {settings.coordinates && row === 7 && (
            <span className="coord file" style={{ color: light ? theme.dark : theme.light }}>
              {files[col]}
            </span>
          )}
          {check === sq && <div className="check-glow" />}
          {settings.legalMoves && highlightDests.includes(sq) && <div className={pieceAt.has(sq) ? "hint capture" : "hint"} />}
          {circles.includes(sq) && <div className="mark-circle" />}
        </div>,
      );
    }
  }

  const animate = settings.animation;

  return (
    <div
      className={`board ${drag?.started ? "dragging" : ""}`}
      ref={boardRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="squares">{squares}</div>
      <div className="pieces">
        {pieces.map((p) => {
          const { col, row } = toXY(p.square);
          const dragging = drag?.started && drag.id === p.id;
          const style: React.CSSProperties = dragging
            ? { transform: `translate(calc(${drag.x}px - 50%), calc(${drag.y}px - 50%)) scale(1.12)`, zIndex: 10, transition: "none" }
            : {
                transform: `translate(${col * 100}%, ${row * 100}%)`,
                transition: !animate || instantId === p.id ? "none" : undefined,
              };
          return <div key={p.id} className={`piece ${p.code}`} style={{ ...style, backgroundImage: `url(/pieces/cburnett/${p.code}.svg)` }} />;
        })}
      </div>
      <svg className="arrows" viewBox="0 0 8 8">
        <defs>
          <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 z" fill="rgba(21, 128, 61, .85)" />
          </marker>
        </defs>
        {arrows.map((a) => {
          const s = toXY(a.from);
          const t = toXY(a.to);
          const x1 = s.col + 0.5;
          const y1 = s.row + 0.5;
          const len = Math.hypot(t.col - s.col, t.row - s.row);
          const k = (len - 0.45) / len;
          return (
            <line
              key={a.from + a.to}
              x1={x1}
              y1={y1}
              x2={x1 + (t.col - s.col) * k}
              y2={y1 + (t.row - s.row) * k}
              stroke="rgba(21, 128, 61, .85)"
              strokeWidth={0.17}
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
            />
          );
        })}
      </svg>
      {promo && (
        <div className="promo-overlay" onPointerDown={(e) => (e.stopPropagation(), setPromo(null))}>
          <div
            className="promo-column"
            style={{
              left: `${toXY(promo.to).col * 12.5}%`,
              top: toXY(promo.to).row === 0 ? 0 : undefined,
              bottom: toXY(promo.to).row === 7 ? 0 : undefined,
              flexDirection: toXY(promo.to).row === 0 ? "column" : "column-reverse",
            }}
          >
            {PROMO_PIECES.map((k) => (
              <button
                key={k}
                className="promo-piece"
                style={{ backgroundImage: `url(/pieces/cburnett/${promo.color}${k.toUpperCase()}.svg)` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onMove?.(promo.from, promo.to, k);
                  setPromo(null);
                }}
                aria-label={`Umwandeln in ${k}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
