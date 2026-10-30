import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { AnalysisResult, ChatLine, Color, GameSnapshot, GameStreamEvent } from "@chessy/shared";
import { describeTimeControl, parseTimeControl } from "@chessy/shared";
import { Board } from "../components/Board.tsx";
import { ClockView } from "../components/Clock.tsx";
import { MoveList } from "../components/MoveList.tsx";
import { EvalBar } from "../components/EvalBar.tsx";
import { Chat } from "../components/Chat.tsx";
import { api, ApiError } from "../lib/api.ts";
import { live } from "../lib/live.ts";
import { play } from "../lib/sound.ts";
import { navigate } from "../lib/router.ts";
import { pieceUrl } from "../lib/paths.ts";
import { useAccount, useToast } from "../App.tsx";

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

interface Timeline {
  fens: string[];
  san: string[];
  uci: string[];
}

function buildTimeline(initialFen: string, moves: string): Timeline {
  const c = new Chess(initialFen);
  const fens = [c.fen()];
  const san: string[] = [];
  const uci = moves.split(" ").filter(Boolean);
  for (const m of uci) {
    try {
      const mv = c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      san.push(mv.san);
      fens.push(c.fen());
    } catch {
      break;
    }
  }
  return { fens, san, uci: uci.slice(0, san.length) };
}

function material(fen: string) {
  const counts: Record<"w" | "b", Record<string, number>> = { w: {}, b: {} };
  for (const ch of fen.split(" ")[0]!) {
    if (!/[pnbrqk]/i.test(ch)) continue;
    const color = ch === ch.toUpperCase() ? "w" : "b";
    const t = ch.toLowerCase();
    counts[color][t] = (counts[color][t] ?? 0) + 1;
  }
  const captured = (by: "w" | "b") => {
    const opp = by === "w" ? "b" : "w";
    const out: string[] = [];
    for (const t of ["q", "r", "b", "n", "p"]) for (let i = counts[opp][t] ?? 0; i < START_COUNT[t]!; i++) out.push(opp + t.toUpperCase());
    return out;
  };
  const score = (c: "w" | "b") => Object.entries(counts[c]).reduce((s, [t, n]) => s + PIECE_VALUE[t]! * n, 0);
  return { w: captured("w"), b: captured("b"), diff: score("w") - score("b") };
}

const TERMINATION_TEXT: Record<string, string> = {
  checkmate: "durch Schachmatt",
  resign: "durch Aufgabe",
  timeout: "durch Zeitüberschreitung",
  stalemate: "Patt",
  agreement: "Remis vereinbart",
  repetition: "dreifache Stellungswiederholung",
  insufficient: "ungenügendes Material",
  "50move": "50-Züge-Regel",
  timevsinsufficient: "Zeit abgelaufen, aber kein Mattmaterial",
  abandoned: "Partie verlassen",
  aborted: "Partie abgebrochen",
  imported: "importierte Partie",
};

export function GamePage({ id }: { id: string }) {
  const account = useAccount();
  const toast = useToast();
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(performance.now());
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [engineOn, setEngineOn] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const prevMoves = useRef<number | null>(null);
  const prevStatus = useRef<string | null>(null);

  const applySnapshot = useCallback((g: GameSnapshot) => {
    setGame(g);
    setReceivedAt(performance.now());
    setPendingMove(null);
  }, []);

  useEffect(() => {
    setGame(null);
    setChat([]);
    setViewPly(null);
    setAnalysis(null);
    setEngineOn(false);
    prevMoves.current = null;
    prevStatus.current = null;
    api.game(id).then(applySnapshot, (e) => e instanceof ApiError && e.status === 404 && setNotFound(true));
    return live.subscribeGame(id, (msg) => {
      const e = msg as unknown as GameStreamEvent;
      if (e.type === "gameFull") applySnapshot(e.game);
      else if (e.type === "gameState") {
        setGame((g) => (g ? { ...g, ...stateToSnapshot(e) } : g));
        setReceivedAt(performance.now());
        setPendingMove(null);
      } else if (e.type === "chatLine") setChat((c) => (c.some((l) => l.at === e.line.at && l.text === e.line.text) ? c : [...c, e.line]));
    });
  }, [id, applySnapshot]);

  const moves = game ? (pendingMove ? `${game.moves} ${pendingMove}`.trim() : game.moves) : "";
  const timeline = useMemo(() => (game ? buildTimeline(game.initial_fen, moves) : null), [game?.initial_fen, moves]);

  // Sounds und Ergebnisdialog bei Zustandswechseln.
  useEffect(() => {
    if (!game || !timeline) return;
    const n = timeline.san.length;
    if (prevMoves.current !== null && n > prevMoves.current) {
      const s = timeline.san[n - 1]!;
      play(s.includes("#") || s.includes("+") ? "check" : s.startsWith("O-O") ? "castle" : s.includes("x") ? "capture" : "move");
    }
    if (prevMoves.current === null || n !== prevMoves.current) setViewPly(null);
    prevMoves.current = n;
    if (prevStatus.current && prevStatus.current !== game.status) {
      if (game.status === "started") play("start");
      if (game.status === "ended" || game.status === "aborted") {
        play("end");
        setShowResult(true);
      }
    }
    prevStatus.current = game.status;
  }, [game, timeline]);

  const isOver = game?.status === "ended" || game?.status === "aborted";
  const ply = viewPly ?? (timeline ? timeline.san.length : 0);
  const viewFen = timeline?.fens[ply] ?? game?.fen ?? "";

  // Engine-Analyse der angezeigten Stellung (nur außerhalb laufender Online-Partien).
  const isLocal = game?.white.kind === "local";
  const isMine = (c: Color) => !!game && !!account && game[c].id === account.id && game[c].kind !== "ai";
  const playing = !!game && (isMine("white") || isMine("black"));
  const vsHumanLive = !!game && !isOver && !isLocal && game.white.kind !== "ai" && game.black.kind !== "ai";
  const engineAllowed = !vsHumanLive || !playing;
  useEffect(() => {
    if (!engineOn || !engineAllowed || !viewFen) return;
    let cancelled = false;
    api.analysis(viewFen, 14).then((a) => !cancelled && setAnalysis(a), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [engineOn, engineAllowed, viewFen]);

  // Tastatur: ← → zum Navigieren, F zum Drehen.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (!timeline) return;
      const max = timeline.san.length;
      if (e.key === "ArrowLeft") setViewPly((p) => Math.max(0, (p ?? max) - 1));
      else if (e.key === "ArrowRight") setViewPly((p) => ((p ?? max) + 1 >= max ? null : (p ?? max) + 1));
      else if (e.key === "ArrowUp") setViewPly(0);
      else if (e.key === "ArrowDown") setViewPly(null);
      else if (e.key === "f") setFlipped((f) => !f);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [timeline]);

  const chess = useMemo(() => new Chess(viewFen || undefined), [viewFen]);
  const dests = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const mv of chess.moves({ verbose: true })) m.set(mv.from, [...(m.get(mv.from) ?? []), mv.to]);
    return m;
  }, [chess]);

  if (notFound) {
    return (
      <div className="page narrow center">
        <h2>Partie nicht gefunden</h2>
        <button className="btn primary" onClick={() => navigate("/")}>
          Zur Startseite
        </button>
      </div>
    );
  }
  if (!game || !timeline || !account) return <div className="page center muted">Lade Partie…</div>;

  const myColor: Color | null = isLocal ? null : isMine("white") ? "white" : isMine("black") ? "black" : null;
  const baseOrientation: Color = myColor ?? "white";
  const orientation: Color = flipped ? (baseOrientation === "white" ? "black" : "white") : baseOrientation;
  const turn: Color = timeline.fens[timeline.fens.length - 1]!.split(" ")[1] === "w" ? "white" : "black";
  const atLive = viewPly === null;
  const canMoveNow = game.status === "started" && atLive && !pendingMove && (isLocal ? isMine("white") : myColor === turn);
  const lastIdx = ply - 1;
  const lastUci = lastIdx >= 0 ? timeline.uci[lastIdx] : null;
  const checkSq = chess.inCheck() ? findKing(chess, chess.turn()) : null;
  const mat = material(viewFen);

  const onMove = async (from: string, to: string, promotion?: string) => {
    const uci = from + to + (promotion ?? "");
    setPendingMove(uci);
    try {
      applySnapshot(await api.move(game.id, uci, live.rtt / 2));
    } catch (e) {
      setPendingMove(null);
      play("illegal");
      toast((e as Error).message);
    }
  };

  const act = async (fn: () => Promise<GameSnapshot>) => {
    try {
      applySnapshot(await fn());
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const rematch = async () => {
    const me = myColor ?? "white";
    const opp = game[me === "white" ? "black" : "white"];
    try {
      const tc = parseTimeControl(game.time_control);
      let g: GameSnapshot;
      if (isLocal) g = await api.createGame({ type: "local" }, tc, "white");
      else if (opp.kind === "ai") g = await api.createGame({ type: "ai", level: opp.ai_level ?? 4 }, tc, me === "white" ? "black" : "white");
      else g = await api.createGame({ type: "friend" }, tc, me === "white" ? "black" : "white");
      navigate(`/game/${g.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const top: Color = orientation === "white" ? "black" : "white";
  const bottom: Color = orientation;
  const opponentOffer = (offer: Color | null) => !!offer && !isLocal && myColor !== null && offer !== myColor;
  const resultText = describeResult(game);
  const inviteUrl = `${location.origin}/game/${game.id}`;

  const playerBar = (c: Color) => {
    const p = game[c];
    const caps = c === "white" ? mat.w : mat.b;
    const adv = c === "white" ? mat.diff : -mat.diff;
    return (
      <div className={`player-bar ${turn === c && game.status === "started" ? "to-move" : ""}`}>
        <div className="player-avatar" data-kind={p.kind}>
          {p.kind === "ai" ? "🤖" : p.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="player-info">
          <div className="player-name">
            {p.username}
            {p.kind === "ai" && <span className="badge">Stufe {p.ai_level}</span>}
            {p.id === account.id && !isLocal && <span className="badge subtle">Du</span>}
          </div>
          <div className="captured">
            {caps.map((code, i) => (
              <img key={i} src={pieceUrl(code)} alt="" />
            ))}
            {adv > 0 && <span className="adv">+{adv}</span>}
          </div>
        </div>
        {game.clock && <ClockView clock={game.clock} color={c} turn={turn} active={game.status === "started"} receivedAt={receivedAt} />}
      </div>
    );
  };

  return (
    <div className="page game-page">
      <div className="game-layout">
        <div className="board-column">
          {playerBar(top)}
          <div className="board-wrap">
            {engineOn && engineAllowed && <EvalBar analysis={analysis} orientation={orientation} />}
            <Board
              fen={viewFen}
              orientation={orientation}
              lastMove={lastUci ? [lastUci.slice(0, 2), lastUci.slice(2, 4)] : null}
              check={checkSq}
              movable={canMoveNow ? (isLocal ? "both" : myColor) : null}
              dests={dests}
              onMove={onMove}
            />
            {game.status === "waiting" && (
              <div className="board-overlay">
                <div className="glass card waiting-card">
                  {playing ? (
                    <>
                      <div className="spinner" />
                      <h3>Warte auf Gegner…</h3>
                      <p className="muted">Schicke diesen Link an deinen Freund:</p>
                      <div className="copy-row">
                        <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
                        <button className="btn primary" onClick={() => (navigator.clipboard?.writeText(inviteUrl), toast("Link kopiert"))}>
                          Kopieren
                        </button>
                      </div>
                      <button className="btn ghost" onClick={() => act(() => api.abort(game.id))}>
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <>
                      <h3>Einladung zur Partie</h3>
                      <p className="muted">
                        {(game.white.id ? game.white : game.black).username} lädt dich zu einer Partie ein · {describeTimeControl(parseTimeControl(game.time_control))}
                      </p>
                      <button className="btn primary big" onClick={() => act(() => api.join(game.id))}>
                        Annehmen &amp; spielen
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          {playerBar(bottom)}
        </div>

        <aside className="side-panel glass">
          <div className="side-head">
            <div>
              <div className="tc-title">
                {describeTimeControl(parseTimeControl(game.time_control))} · <span className="cap">{game.time_class}</span>
              </div>
              <div className="muted small">
                {game.source === "import" ? "Importierte Partie" : isLocal ? "Lokale Partie" : game.white.kind === "ai" || game.black.kind === "ai" ? "Gegen Computer" : "Online"}
                {!live.online && " · offline"}
              </div>
            </div>
            {isOver && <div className="result-pill">{game.result}</div>}
          </div>

          {opponentOffer(game.draw_offer) && (
            <div className="offer">
              <span>Remis angeboten</span>
              <button className="btn small primary" onClick={() => act(() => api.draw(game.id, "accept"))}>
                Annehmen
              </button>
              <button className="btn small ghost" onClick={() => act(() => api.draw(game.id, "decline"))}>
                Ablehnen
              </button>
            </div>
          )}
          {opponentOffer(game.takeback_offer) && (
            <div className="offer">
              <span>Zugrücknahme gewünscht</span>
              <button className="btn small primary" onClick={() => act(() => api.takeback(game.id, "accept"))}>
                Erlauben
              </button>
              <button className="btn small ghost" onClick={() => act(() => api.takeback(game.id, "decline"))}>
                Ablehnen
              </button>
            </div>
          )}
          {game.draw_offer && game.draw_offer === myColor && <div className="offer muted">Remisangebot gesendet…</div>}

          <MoveList san={timeline.san} viewPly={ply} onSelect={(p) => setViewPly(p >= timeline.san.length ? null : p)} />

          <div className="nav-row">
            <button className="icon-btn" title="Anfang" onClick={() => setViewPly(0)}>
              ⏮
            </button>
            <button className="icon-btn" title="Zurück" onClick={() => setViewPly(Math.max(0, ply - 1))}>
              ◀
            </button>
            <button className="icon-btn" title="Vor" onClick={() => setViewPly(ply + 1 >= timeline.san.length ? null : ply + 1)}>
              ▶
            </button>
            <button className="icon-btn" title="Ende" onClick={() => setViewPly(null)}>
              ⏭
            </button>
            <button className="icon-btn" title="Brett drehen (F)" onClick={() => setFlipped((f) => !f)}>
              ⇅
            </button>
            {engineAllowed && (
              <button className={`icon-btn ${engineOn ? "on" : ""}`} title="Engine-Analyse" onClick={() => setEngineOn((v) => !v)}>
                ⚙
              </button>
            )}
          </div>
          {engineOn && engineAllowed && analysis && (
            <div className="analysis-line small">
              <b>{"mate" in analysis.eval ? `Matt in ${Math.abs(analysis.eval.mate)}` : `${(analysis.eval.cp / 100).toFixed(2)}`}</b>
              <span className="muted"> · Tiefe {analysis.depth} · </span>
              {pvToSan(viewFen, analysis.pv.slice(0, 6))}
            </div>
          )}

          {!isOver && playing && game.status === "started" && (
            <div className="actions">
              {timeline.san.length < 2 && !isLocal ? (
                <button className="btn ghost" onClick={() => act(() => api.abort(game.id))}>
                  ✕ Abbrechen
                </button>
              ) : (
                <>
                  <button className="btn ghost" title="Zugrücknahme" onClick={() => act(() => api.takeback(game.id, "offer"))} disabled={timeline.san.length === 0}>
                    ↶ Zurück
                  </button>
                  {!isLocal && (
                    <button className="btn ghost" onClick={() => act(() => api.draw(game.id, "offer"))}>
                      ½ Remis
                    </button>
                  )}
                </>
              )}
              {confirmResign ? (
                <button className="btn danger" onClick={() => (setConfirmResign(false), act(() => api.resign(game.id)))} onBlur={() => setConfirmResign(false)}>
                  Wirklich aufgeben?
                </button>
              ) : (
                <button className="btn ghost" onClick={() => setConfirmResign(true)}>
                  ⚑ Aufgeben
                </button>
              )}
            </div>
          )}
          {isOver && (
            <div className="actions">
              {game.source === "live" && playing && (
                <button className="btn primary" onClick={rematch}>
                  ↻ Neue Partie
                </button>
              )}
              <button className="btn ghost" onClick={() => downloadPgn(game)}>
                ⤓ PGN
              </button>
              <button className="btn ghost" onClick={() => (navigator.clipboard?.writeText(game.pgn), toast("PGN kopiert"))}>
                ⧉ Kopieren
              </button>
            </div>
          )}

          {!isLocal && game.source === "live" && game.white.kind !== "ai" && game.black.kind !== "ai" && (
            <Chat lines={chat} onSend={(t) => api.chat(game.id, t).catch((e) => toast((e as Error).message))} disabled={!playing} />
          )}
        </aside>
      </div>

      {showResult && isOver && (
        <div className="modal-backdrop" onClick={() => setShowResult(false)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="result-trophy">{game.status === "aborted" ? "✕" : game.winner ? (game.winner === myColor ? "🏆" : myColor ? "♟" : "🏁") : "½"}</div>
            <h2>{resultText.title}</h2>
            <p className="muted">{resultText.sub}</p>
            <div className="modal-actions">
              {playing && game.source === "live" && (
                <button className="btn primary" onClick={rematch}>
                  Neue Partie
                </button>
              )}
              <button
                className="btn ghost"
                onClick={() => {
                  setShowResult(false);
                  setEngineOn(true);
                }}
              >
                Analysieren
              </button>
              <button className="btn ghost" onClick={() => navigate("/")}>
                Startseite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function describeResult(g: GameSnapshot) {
    if (g.status === "aborted") return { title: "Partie abgebrochen", sub: "Es wurde keine Wertung vergeben." };
    const how = TERMINATION_TEXT[g.termination ?? ""] ?? "";
    if (!g.winner) return { title: "Remis", sub: how };
    const name = g[g.winner].username;
    if (myColor) return { title: g.winner === myColor ? "Du hast gewonnen!" : "Du hast verloren", sub: `${name} gewinnt ${how}` };
    return { title: `${g.winner === "white" ? "Weiß" : "Schwarz"} gewinnt`, sub: `${name} gewinnt ${how}` };
  }
}

function downloadPgn(game: GameSnapshot) {
  const url = URL.createObjectURL(new Blob([game.pgn], { type: "application/x-chess-pgn" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `chessy-${game.id}.pgn`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stateToSnapshot(e: Extract<GameStreamEvent, { type: "gameState" }>): Partial<GameSnapshot> {
  return {
    moves: e.moves,
    fen: e.fen,
    status: e.status,
    clock: e.clock,
    draw_offer: e.draw_offer,
    takeback_offer: e.takeback_offer,
    result: e.result,
    winner: e.winner,
    termination: e.termination,
  };
}

function findKing(chess: Chess, color: "w" | "b"): string | null {
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === "k" && sq.color === color) return sq.square;
  return null;
}

function pvToSan(fen: string, pv: string[]) {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const m of pv) {
    try {
      const mv = c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}
