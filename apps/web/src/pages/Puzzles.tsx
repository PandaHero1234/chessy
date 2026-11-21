import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { GameSnapshot } from "@chessy/shared";
import { DIFFICULTIES, THEME_LABELS, difficultyOf, type Difficulty, type Puzzle, type PuzzlePublic, type PuzzleTheme } from "@chessy/puzzles";
import { Board } from "../components/Board.tsx";
import { PuzzleBoard, type PuzzleOutcome, type PuzzlePhase } from "../components/PuzzleBoard.tsx";
import { api, type PuzzleCatalog, type PuzzleStats } from "../lib/api.ts";
import { navigate, onLinkClick } from "../lib/router.ts";
import { href } from "../lib/paths.ts";
import { play } from "../lib/sound.ts";
import { buildLine } from "../lib/notation.ts";
import { useSettings } from "../lib/settings.ts";
import { useAccount, useToast } from "../App.tsx";

type Mode = "train" | "daily" | "storm" | "mine";

const TABS: { id: Mode; label: string; path: string }[] = [
  { id: "train", label: "Training", path: "/puzzles" },
  { id: "daily", label: "Tagespuzzle", path: "/puzzles/daily" },
  { id: "storm", label: "Sturm", path: "/puzzles/storm" },
  { id: "mine", label: "Meine Partien", path: "/puzzles/mine" },
];

/** Wichtigste Themen zuerst im Filter. */
const THEME_ORDER: PuzzleTheme[] = [
  "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "backRankMate", "smotheredMate", "fork", "pin", "skewer", "discoveredAttack",
  "doubleCheck", "sacrifice", "hangingPiece", "quietMove", "promotion", "underPromotion", "enPassant", "opening", "middlegame", "endgame",
  "oneMove", "short", "long", "veryLong",
];

const FILTER_KEY = "chessy.puzzleFilter";
function loadFilter(): { difficulty: Difficulty | "adaptive"; theme: PuzzleTheme | "" } {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}");
    return { difficulty: f.difficulty in DIFFICULTIES ? f.difficulty : "adaptive", theme: f.theme in THEME_LABELS ? f.theme : "" };
  } catch {
    return { difficulty: "adaptive", theme: "" };
  }
}

export function Puzzles({ path }: { path: string }) {
  const sub = path.replace(/^\/puzzles\/?/, "");
  const mode: Mode = sub === "daily" ? "daily" : sub === "storm" ? "storm" : sub === "mine" ? "mine" : "train";
  const puzzleId = mode === "train" && sub ? sub : null;
  return (
    <div className={`page puzzles-page ${mode === "train" || mode === "daily" ? "trainer" : ""}`}>
      <nav className="puzzle-tabs">
        {TABS.map((t) => (
          <a key={t.id} href={href(t.path)} onClick={onLinkClick} className={mode === t.id ? "active" : ""}>
            {t.label}
          </a>
        ))}
      </nav>
      {mode === "storm" ? <Storm /> : mode === "mine" ? <FromGames /> : <Trainer daily={mode === "daily"} puzzleId={puzzleId} />}
    </div>
  );
}

// ------------------------------------------------------------------ Training & Tagespuzzle

function Trainer({ daily, puzzleId, mine }: { daily?: boolean; puzzleId?: string | null; mine?: boolean }) {
  const toast = useToast();
  const account = useAccount();
  const settings = useSettings();
  const [puzzle, setPuzzle] = useState<PuzzlePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PuzzlePhase>("intro");
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [outcome, setOutcome] = useState<PuzzleOutcome | null>(null);
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [catalog, setCatalog] = useState<PuzzleCatalog | null>(null);
  const [filter, setFilter] = useState(loadFilter);
  const [hint, setHint] = useState(0);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);
  /** Zählt jedes Laden hoch: Auch dasselbe Puzzle wird so neu aufgebaut. */
  const [loadSeq, setLoadSeq] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  /** Nachspielen der Lösung: Anzahl gespielter Züge ab der Ausgangsstellung (null = nicht im Nachspiel-Modus). */
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterable = !daily && !puzzleId && !mine;

  const refreshStats = useCallback(() => api.puzzles.stats().then(setStats, () => undefined), []);

  const reset = () => {
    setOutcome(null);
    setFeedback(null);
    setReviewPly(null);
    setSolvedCount(0);
    setHintLevel(0);
    setPhase("intro");
    setLoadSeq((n) => n + 1);
    if (autoTimer.current) clearTimeout(autoTimer.current);
    window.scrollTo({ top: 0 });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = daily
        ? await api.puzzles.daily()
        : puzzleId
          ? await api.puzzles.get(puzzleId)
          : await api.puzzles.next({ difficulty: filter.difficulty === "adaptive" ? undefined : filter.difficulty, theme: filter.theme || undefined, mine });
      setPuzzle(p);
      reset();
    } catch (e) {
      setPuzzle(null);
      setError((e as Error).message);
    }
  }, [daily, puzzleId, filter, mine]);

  useEffect(() => {
    if (!account) return;
    void load();
    void refreshStats();
  }, [account, load, refreshStats]);

  useEffect(() => {
    api.puzzles.catalog().then(setCatalog, () => undefined);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);

  const changeFilter = (patch: Partial<typeof filter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      /* privater Modus */
    }
  };

  const next = useCallback(() => {
    if (puzzleId || daily) navigate("/puzzles");
    else void load();
  }, [puzzleId, daily, load]);

  const onOutcome = (o: PuzzleOutcome) => {
    setOutcome((prev) => ({ ...prev, ...o, rating: o.rating ?? prev?.rating, clean: o.status === "solved" ? o.clean : false }));
    if (o.status === "solved") {
      play("end");
      if (settings.autoNext && o.clean && filterable) autoTimer.current = setTimeout(next, 1500);
    }
    void refreshStats();
  };

  const showSolution = async () => {
    if (!puzzle) return;
    try {
      const sol = await api.puzzles.solution(puzzle.id);
      setOutcome((prev) => ({ status: "failed", clean: false, rating: sol.rating ?? prev?.rating, themes: sol.themes, solution: sol.moves }));
      // Einstieg an der Stelle, an der man selbst am Zug war: Der grüne Pfeil zeigt den richtigen Zug.
      setReviewPly(1 + 2 * solvedCount);
      setPhase("failed");
      void refreshStats();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const analyse = async () => {
    if (!puzzle || !outcome?.solution) return;
    const c = new Chess(puzzle.fen);
    c.setHeader("Event", `Chessy-Puzzle ${puzzle.id}`);
    c.setHeader("White", "Puzzle");
    c.setHeader("Black", "Puzzle");
    for (const m of outcome.solution) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    try {
      const g = await api.importPgn(c.pgn());
      navigate(`/game/${g.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const done = phase === "solved" || phase === "failed";
  const line = useMemo(() => (puzzle && outcome?.solution ? buildLine(puzzle.fen, outcome.solution) : null), [puzzle, outcome?.solution]);
  const reviewing = done && !!line;
  const ply = reviewing ? Math.min(reviewPly ?? line!.length, line!.length) : 0;
  const step = (d: number) => line && setReviewPly(Math.max(1, Math.min(line.length, ply + d)));

  useEffect(() => {
    if (!reviewing) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const colorName = puzzle?.color === "white" ? "Weiß" : "Schwarz";
  const delta = outcome?.rating?.delta;
  const status = !puzzle
    ? null
    : phase === "intro"
      ? { cls: "", icon: "…", title: "Der Gegner zieht", text: "" }
      : phase === "solved"
        ? { cls: "good", icon: "✓", title: outcome?.clean ? "Gelöst!" : "Gelöst im zweiten Anlauf", text: "" }
        : phase === "failed"
          ? { cls: "bad", icon: "👁", title: "Lösung", text: "Grün = richtiger Zug" }
          : feedback === "bad"
            ? { cls: "bad", icon: "✗", title: "Nicht der beste Zug", text: "Versuch es nochmal" }
            : feedback === "good"
              ? { cls: "good", icon: "✓", title: "Richtig, weiter!", text: `Zug ${solvedCount + 1} von ${puzzle.solver_moves}` }
              : { cls: "", icon: puzzle.color === "white" ? "○" : "●", title: `${colorName} am Zug`, text: `Finde den besten Zug` };

  const filterSummary = `${filter.difficulty === "adaptive" ? "Adaptiv" : DIFFICULTIES[filter.difficulty].label}${filter.theme ? ` · ${THEME_LABELS[filter.theme]}` : ""}`;

  return (
    <div className="puzzle-layout">
      <div className="board-column puzzle-column">
        <div className={`puzzle-statusbar ${status?.cls ?? ""}`} role="status" aria-live="polite">
          <span className="ps-icon">{status?.icon ?? ""}</span>
          <span className="ps-text">
            <span className="ps-title">{status?.title ?? (error ? "Kein Puzzle" : "Lade …")}</span>
            {status?.text && <span className="ps-sub">{status.text}</span>}
          </span>
          {stats && (
            <span className="ps-rating" title="Dein Puzzle-Rating">
              {stats.rating}
              {delta !== undefined && delta !== 0 && <span className={`rating-delta ${delta > 0 ? "up" : "down"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
            </span>
          )}
          <button className="sheet-btn" onClick={() => setSheetOpen(true)} aria-label="Filter und Statistik">
            ⚙
          </button>
        </div>

        <div className="puzzle-stage">
          {puzzle ? (
            reviewing ? (
              <div className="puzzle-board" data-puzzle-id={puzzle.id} data-phase={phase}>
                <Board
                  fen={line![ply - 1]!.fen}
                  orientation={puzzle.color}
                  lastMove={[line![ply - 1]!.uci.slice(0, 2), line![ply - 1]!.uci.slice(2, 4)]}
                  movable={null}
                  dests={new Map()}
                  shapes={ply < line!.length && ply % 2 === 1 ? [{ from: line![ply]!.uci.slice(0, 2), to: line![ply]!.uci.slice(2, 4), kind: "good" }] : []}
                />
              </div>
            ) : (
              <PuzzleBoard
                key={loadSeq}
                puzzle={puzzle}
                onOutcome={onOutcome}
                onPhase={(p, i) => {
                  setPhase(p);
                  setSolvedCount(i.solverIndex);
                  if (i.feedback) setFeedback(i.feedback);
                }}
                hintSignal={hint}
                onHintLevel={setHintLevel}
              />
            )
          ) : (
            <div className="board-placeholder glass">{error ? <div className="center pad">{error}</div> : <div className="spinner" />}</div>
          )}
          {phase === "solved" && (
            <div className="result-flash" key={loadSeq} aria-hidden>
              <span className="rf-icon">✓</span>
              <span className="rf-title">Gelöst!</span>
              {delta !== undefined && delta !== 0 && <span className="rf-delta">{delta > 0 ? `+${delta}` : delta}</span>}
            </div>
          )}
        </div>

        <div className="solution-strip">
          {reviewing ? (
            <>
              <button className="step-btn" onClick={() => step(-1)} disabled={ply <= 1} aria-label="Zug zurück">
                ◀
              </button>
              <div className="solution-moves">
                {line!.map((m, i) => (
                  <button
                    key={i}
                    ref={(el) => {
                      // Aktuellen Zug in der Leiste zentrieren (ohne scrollIntoView: das verschiebt am Handy die ganze Seite).
                      const box = el?.parentElement;
                      if (el && box && i + 1 === ply) box.scrollLeft = el.offsetLeft - box.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
                    }}
                    className={`sol-move ${i + 1 === ply ? "current" : ""} ${i === 0 ? "context" : i % 2 === 1 ? "mine" : ""}`}
                    onClick={() => setReviewPly(i + 1)}
                  >
                    {(m.white || i === 0 || i === 1) && <span className="sol-num">{m.number}{m.white ? "." : "…"}</span>}
                    {m.san}
                  </button>
                ))}
              </div>
              <button className="step-btn" onClick={() => step(1)} disabled={ply >= line!.length} aria-label="Zug vor">
                ▶
              </button>
            </>
          ) : puzzle ? (
            <div className="progress-dots" aria-label={`Zug ${Math.min(solvedCount + 1, puzzle.solver_moves)} von ${puzzle.solver_moves}`}>
              {Array.from({ length: puzzle.solver_moves }, (_, i) => (
                <span key={i} className={i < solvedCount ? "dot-step done" : i === solvedCount ? "dot-step now" : "dot-step"} />
              ))}
              <span className="muted small">
                {puzzle.solver_moves === 1 ? "1 Zug" : `${puzzle.solver_moves} Züge`} · Rating {puzzle.rating}
              </span>
            </div>
          ) : null}
        </div>

        <div className="action-bar">
          {!done ? (
            <>
              <button className="btn ghost" onClick={() => setHint((h) => h + 1)} disabled={phase !== "play" || hintLevel === 2}>
                💡 {hintLevel === 0 ? "Tipp" : "Zielfeld zeigen"}
              </button>
              <button className="btn ghost" onClick={showSolution} disabled={phase === "intro" || phase === "busy" || !puzzle}>
                👁 Lösung
              </button>
            </>
          ) : (
            <>
              <button className="btn ghost icon-only" onClick={reset} title="Nochmal versuchen" aria-label="Nochmal versuchen">
                ↺<span className="btn-label"> Nochmal</span>
              </button>
              <button className="btn ghost icon-only" onClick={analyse} disabled={!outcome?.solution} title="In der Analyse öffnen" aria-label="Analysieren">
                🔍<span className="btn-label"> Analyse</span>
              </button>
              <button className="btn primary next-btn" onClick={next}>
                Weiter →
              </button>
            </>
          )}
        </div>
      </div>

      {sheetOpen && <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />}
      <aside className={`side-panel glass puzzle-panel sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-head">
          <b>Puzzle-Optionen</b>
          <button className="sheet-close" onClick={() => setSheetOpen(false)} aria-label="Schließen">
            ✕
          </button>
        </div>
        <nav className="sheet-modes" aria-label="Puzzle-Modus">
          {TABS.map((t) => (
            <a key={t.id} href={href(t.path)} onClick={onLinkClick} className={(daily ? "daily" : mine ? "mine" : "train") === t.id ? "active" : ""}>
              {t.label}
            </a>
          ))}
        </nav>
        <RatingCard stats={stats} change={outcome?.rating} />
        {filterable && (
          <div className="puzzle-filters">
            <div className="section-label">Schwierigkeit</div>
            <div className="tc-chips">
              <button className={`chip ${filter.difficulty === "adaptive" ? "active" : ""}`} onClick={() => changeFilter({ difficulty: "adaptive" })}>
                Adaptiv
              </button>
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                <button key={d} className={`chip ${filter.difficulty === d ? "active" : ""}`} onClick={() => changeFilter({ difficulty: d })} disabled={catalog?.difficulties[d] === 0}>
                  {DIFFICULTIES[d].label}
                  {catalog && <span className="chip-count">{catalog.difficulties[d]}</span>}
                </button>
              ))}
            </div>
            <div className="muted small">Adaptiv wählt Puzzles passend zu deinem Rating.</div>
            <div className="section-label">Thema</div>
            <select value={filter.theme} onChange={(e) => changeFilter({ theme: e.target.value as PuzzleTheme | "" })}>
              <option value="">Alle Themen</option>
              {THEME_ORDER.filter((t) => catalog?.themes[t]).map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]} ({catalog!.themes[t]})
                </option>
              ))}
            </select>
          </div>
        )}
        {daily && puzzle && "daily" in puzzle && (
          <div className="muted small">Tagespuzzle vom {new Date(String((puzzle as PuzzlePublic & { daily: string }).daily)).toLocaleDateString("de-DE")}</div>
        )}
        {puzzle && (
          <div className="puzzle-info">
            <div className="muted small">
              Puzzle <a href={href(`/puzzles/${puzzle.id}`)} onClick={onLinkClick}>#{puzzle.id}</a> · Rating {puzzle.rating} · {DIFFICULTIES[difficultyOf(puzzle.rating)].label}
              {puzzle.source.startsWith("game:") && (
                <>
                  {" "}
                  · aus <a href={href(`/game/${puzzle.source.slice(5)}`)} onClick={onLinkClick}>deiner Partie</a>
                </>
              )}
            </div>
            {done && outcome?.themes && (
              <div className="theme-tags">
                {outcome.themes
                  .filter((t) => t in THEME_LABELS)
                  .map((t) => (
                    <span key={t} className="badge">
                      {THEME_LABELS[t as PuzzleTheme]}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
        {stats && <History stats={stats} />}
        <button className="btn primary sheet-done" onClick={() => setSheetOpen(false)}>
          Fertig{filterable ? ` · ${filterSummary}` : ""}
        </button>
      </aside>
    </div>
  );
}

function RatingCard({ stats, change }: { stats: PuzzleStats | null; change?: { delta: number } }) {
  if (!stats) return null;
  return (
    <div className="rating-card">
      <div>
        <div className="section-label">Puzzle-Rating</div>
        <div className="rating-value">
          {stats.rating}
          {change && change.delta !== 0 && <span className={`rating-delta ${change.delta > 0 ? "up" : "down"}`}>{change.delta > 0 ? `+${change.delta}` : change.delta}</span>}
        </div>
      </div>
      <div className="rating-side">
        <div>
          🔥 <b>{stats.streak}</b> <span className="muted small">Serie</span>
        </div>
        <div className="muted small">
          {stats.wins}/{stats.attempts} gelöst
        </div>
      </div>
    </div>
  );
}

function History({ stats }: { stats: PuzzleStats }) {
  if (!stats.history.length) return null;
  return (
    <div>
      <div className="section-label">Letzte Puzzles</div>
      <div className="history-dots">
        {stats.history
          .slice(0, 16)
          .reverse()
          .map((h, i) => (
            <a
              key={i}
              href={href(`/puzzles/${h.puzzle_id}`)}
              onClick={onLinkClick}
              className={`hdot ${h.win ? "win" : "loss"}`}
              aria-label={`${h.win ? "Gelöst" : "Nicht gelöst"}, Rating danach ${h.rating_after}`}
            >
              {h.win ? "✓" : "✗"}
            </a>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Puzzle-Sturm

const STORM_SECONDS = 180;

function Storm() {
  const [list, setList] = useState<Puzzle[] | null>(null);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{ score: number; best: number; new_record: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  const start = useCallback(() => {
    finished.current = false;
    setResult(null);
    setIndex(0);
    setScore(0);
    setStrikes(0);
    setCombo(0);
    setStartedAt(null);
    api.puzzles.storm(80).then(setList, (e) => setError((e as Error).message));
  }, []);
  useEffect(start, [start]);

  const left = startedAt ? Math.max(0, STORM_SECONDS * 1000 - (now - startedAt)) : STORM_SECONDS * 1000;
  const over = !!list && (left <= 0 || strikes >= 3 || index >= list.length);

  useEffect(() => {
    if (!startedAt || over) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [startedAt, over]);

  useEffect(() => {
    if (!over || finished.current || !list) return;
    finished.current = true;
    play("end");
    api.puzzles.stormResult(score).then(setResult, () => setResult({ score, best: score, new_record: false }));
  }, [over, score, list]);

  const current = list?.[index];
  const pub: PuzzlePublic | null = current
    ? {
        id: current.id,
        fen: current.fen,
        initial_move: current.moves[0]!,
        color: new Chess(current.fen).turn() === "w" ? "black" : "white",
        rating: current.rating,
        solver_moves: Math.floor(current.moves.length / 2),
        source: current.source,
      }
    : null;

  const onOutcome = (o: PuzzleOutcome) => {
    if (o.status === "solved") {
      setScore((s) => s + 1);
      setCombo((c) => c + 1);
    } else {
      setStrikes((s) => s + 1);
      setCombo(0);
    }
    setTimeout(() => setIndex((i) => i + 1), o.status === "solved" ? 150 : 500);
  };

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <div className="puzzle-layout">
      <div className="board-column puzzle-column">
        <div className="puzzle-statusbar storm-hud">
          <span className={`storm-clock ${left < 20_000 && startedAt ? "low" : ""}`}>
            {mm}:{String(ss).padStart(2, "0")}
          </span>
          <span className="storm-combo muted small">{combo >= 2 ? `Combo ${combo}` : pub ? `${pub.color === "white" ? "Weiß" : "Schwarz"} zieht` : ""}</span>
          <span className="strikes" aria-label={`${strikes} von 3 Fehlern`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={i < strikes ? "x on" : "x"}>
                ✕
              </span>
            ))}
          </span>
          <span className="storm-score" aria-label="Gelöste Puzzles">
            {score}
          </span>
        </div>
        <div className="puzzle-stage">
          {pub && !over ? (
            <PuzzleBoard key={pub.id} puzzle={pub} full={current} failFast introDelay={250} onOutcome={onOutcome} onPhase={(p) => p === "busy" && setStartedAt((t) => t ?? Date.now())} />
          ) : (
            <div className="board-placeholder glass">
              {error ? (
                <div className="center pad">{error}</div>
              ) : over ? (
                <div className="storm-result center">
                  <div className="result-trophy">⚡</div>
                  <h2>{score} gelöst</h2>
                  {result && <p className="muted">{result.new_record ? "Neuer Rekord!" : `Dein Rekord: ${result.best}`}</p>}
                  <button className="btn primary big" onClick={start}>
                    Nochmal
                  </button>
                </div>
              ) : (
                <div className="spinner" />
              )}
            </div>
          )}
        </div>
        <div className="solution-strip">
          <span className="muted small">3 Minuten · immer schwerer · 3 Fehler erlaubt · die Uhr startet mit deinem ersten Zug</span>
        </div>
      </div>
      <aside className="side-panel glass puzzle-panel storm-panel">
        <b>Puzzle-Sturm</b>
        <p className="muted small">
          Löse in 3 Minuten so viele Puzzles wie möglich. Sie werden immer schwerer. Ein Fehler kostet ein Leben, nach drei Fehlern ist Schluss. Der Sturm ist
          ungewertet, dein Rekord wird gespeichert.
        </p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ Aus eigenen Partien

function FromGames() {
  const toast = useToast();
  const account = useAccount();
  const [games, setGames] = useState<GameSnapshot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [training, setTraining] = useState(false);

  useEffect(() => {
    if (!account) return;
    api.myGames().then((g) => setGames(g.filter((x) => x.status === "ended" && x.san.length >= 6)), () => undefined);
    api.puzzles.stats().then(setStats, () => undefined);
  }, [account]);

  const scan = async (g: GameSnapshot) => {
    setBusy(g.id);
    try {
      const r = await api.puzzles.fromGame(g.id);
      setScanned((s) => ({ ...s, [g.id]: r.found }));
      toast(r.found ? `${r.found} ${r.found === 1 ? "Puzzle" : "Puzzles"} gefunden` : "Keine eindeutige Taktik gefunden");
      api.puzzles.stats().then(setStats, () => undefined);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (training) return <Trainer mine />;

  return (
    <div className="page narrow" style={{ padding: 0 }}>
      <section className="glass card">
        <h2>Puzzles aus deinen Partien</h2>
        <p className="muted">
          Stockfish sucht Züge, die die Partie gekippt haben, und behält nur Stellungen mit genau einer Gewinnfortsetzung. Das läuft{" "}
          {import.meta.env.VITE_STATIC === "1" ? "in deinem Browser" : "auf dem Server"} und dauert pro Partie etwa 10–60 Sekunden.
        </p>
        <button className="btn primary" disabled={!stats?.own_puzzles} onClick={() => setTraining(true)}>
          Meine Puzzles lösen ({stats?.own_puzzles ?? 0})
        </button>
      </section>
      <section className="glass card">
        <h2>Beendete Partien</h2>
        {games.length === 0 && (
          <p className="muted">
            Noch keine beendeten Partien. <a href={href("/")} onClick={onLinkClick}>Spiel eine Partie</a> oder importiere eine über chess.com.
          </p>
        )}
        <div className="game-list">
          {games.map((g) => (
            <div className="game-row scan-row" key={g.id}>
              <span className="gr-players">
                {g.white.username} <span className="muted">vs</span> {g.black.username}
                <span className="muted small"> · {g.san.length} Halbzüge · {g.result}</span>
              </span>
              {scanned[g.id] !== undefined ? (
                <span className="badge">{scanned[g.id]} gefunden</span>
              ) : (
                <button className="btn small ghost" disabled={!!busy} onClick={() => scan(g)}>
                  {busy === g.id ? "Suche läuft …" : "🔎 Durchsuchen"}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
