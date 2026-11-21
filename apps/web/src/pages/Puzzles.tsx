import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { GameSnapshot } from "@chessy/shared";
import { DIFFICULTIES, THEME_LABELS, difficultyOf, type Difficulty, type Puzzle, type PuzzlePublic, type PuzzleTheme } from "@chessy/puzzles";
import { PuzzleBoard, type PuzzleOutcome, type PuzzlePhase } from "../components/PuzzleBoard.tsx";
import { api, type PuzzleCatalog, type PuzzleStats } from "../lib/api.ts";
import { navigate, onLinkClick } from "../lib/router.ts";
import { href } from "../lib/paths.ts";
import { play } from "../lib/sound.ts";
import { useAccount, useToast } from "../App.tsx";

type Mode = "train" | "daily" | "storm" | "mine";

const TABS: { id: Mode; label: string; path: string }[] = [
  { id: "train", label: "Training", path: "/puzzles" },
  { id: "daily", label: "Tagespuzzle", path: "/puzzles/daily" },
  { id: "storm", label: "Puzzle-Sturm", path: "/puzzles/storm" },
  { id: "mine", label: "Aus meinen Partien", path: "/puzzles/mine" },
];

/** Wichtigste Themen zuerst im Filter. */
const THEME_ORDER: PuzzleTheme[] = [
  "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "backRankMate", "smotheredMate", "fork", "pin", "skewer", "discoveredAttack",
  "doubleCheck", "sacrifice", "hangingPiece", "quietMove", "promotion", "underPromotion", "enPassant", "opening", "middlegame", "endgame",
  "oneMove", "short", "long", "veryLong",
];

export function Puzzles({ path }: { path: string }) {
  const sub = path.replace(/^\/puzzles\/?/, "");
  const mode: Mode = sub === "daily" ? "daily" : sub === "storm" ? "storm" : sub === "mine" ? "mine" : "train";
  const puzzleId = mode === "train" && sub ? sub : null;
  return (
    <div className="page puzzles-page">
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
  const [puzzle, setPuzzle] = useState<PuzzlePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PuzzlePhase>("intro");
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const [outcome, setOutcome] = useState<PuzzleOutcome | null>(null);
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [catalog, setCatalog] = useState<PuzzleCatalog | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | "adaptive">("adaptive");
  const [theme, setTheme] = useState<PuzzleTheme | "">("");
  const [hint, setHint] = useState(0);
  const [solution, setSolution] = useState(0);
  /** Zählt jedes Laden hoch: Auch dasselbe Puzzle wird so neu aufgebaut. */
  const [loadSeq, setLoadSeq] = useState(0);

  const refreshStats = useCallback(() => api.puzzles.stats().then(setStats, () => undefined), []);

  const load = useCallback(async () => {
    setError(null);
    setOutcome(null);
    setFeedback(null);
    try {
      const p = daily
        ? await api.puzzles.daily()
        : puzzleId
          ? await api.puzzles.get(puzzleId)
          : await api.puzzles.next({ difficulty: difficulty === "adaptive" ? undefined : difficulty, theme: theme || undefined, mine });
      setPuzzle(p);
      setLoadSeq((n) => n + 1);
    } catch (e) {
      setPuzzle(null);
      setError((e as Error).message);
    }
  }, [daily, puzzleId, difficulty, theme, mine]);

  useEffect(() => {
    if (!account) return;
    void load();
    void refreshStats();
  }, [account, load, refreshStats]);

  useEffect(() => {
    api.puzzles.catalog().then(setCatalog, () => undefined);
  }, []);

  const onOutcome = (o: PuzzleOutcome) => {
    setOutcome((prev) => ({ ...prev, ...o, rating: o.rating ?? prev?.rating, clean: o.status === "solved" ? o.clean : false }));
    if (o.status === "solved") play("end");
    void refreshStats();
  };

  const next = () => {
    if (puzzleId) navigate("/puzzles");
    else void load();
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

  const colorName = puzzle?.color === "white" ? "Weiß" : "Schwarz";
  const done = phase === "solved" || phase === "failed";
  const status = !puzzle
    ? null
    : phase === "intro"
      ? { cls: "", title: "Achte auf den Zug des Gegners …", text: "" }
      : phase === "solved"
        ? { cls: "good", title: outcome?.clean ? "Gelöst!" : "Gelöst – im zweiten Anlauf", text: "" }
        : phase === "failed"
          ? { cls: "bad", title: "Lösung angezeigt", text: "Spiel die Varianten in der Analyse nach." }
          : feedback === "bad"
            ? { cls: "bad", title: "Das ist nicht der beste Zug", text: "Versuch es nochmal – das Puzzle zählt als nicht gelöst." }
            : feedback === "good"
              ? { cls: "good", title: "Richtig! Weiter …", text: `Finde den nächsten Zug für ${colorName}.` }
              : { cls: "", title: `Du bist am Zug: ${colorName}`, text: `Finde den besten Zug. Lösung: ${puzzle.solver_moves} ${puzzle.solver_moves === 1 ? "Zug" : "Züge"}.` };

  return (
    <div className="puzzle-layout">
      <div className="board-column">
        {puzzle ? (
          <PuzzleBoard
            key={loadSeq}
            puzzle={puzzle}
            onOutcome={onOutcome}
            onPhase={(p, i) => {
              setPhase(p);
              if (i.feedback) setFeedback(i.feedback);
            }}
            hintSignal={hint}
            solutionSignal={solution}
          />
        ) : (
          <div className="board-placeholder glass">{error ? <div className="center pad">{error}</div> : <div className="spinner" />}</div>
        )}
      </div>
      <aside className="side-panel glass puzzle-panel">
        <RatingCard stats={stats} change={outcome?.rating} />
        {!daily && !puzzleId && !mine && (
          <div className="puzzle-filters">
            <div className="section-label">Schwierigkeit</div>
            <div className="tc-chips">
              <button className={`chip ${difficulty === "adaptive" ? "active" : ""}`} onClick={() => setDifficulty("adaptive")} title="Passend zu deinem Rating">
                Adaptiv
              </button>
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                <button key={d} className={`chip ${difficulty === d ? "active" : ""}`} onClick={() => setDifficulty(d)} disabled={catalog?.difficulties[d] === 0}>
                  {DIFFICULTIES[d].label}
                  {catalog && <span className="chip-count">{catalog.difficulties[d]}</span>}
                </button>
              ))}
            </div>
            <div className="section-label">Thema</div>
            <select value={theme} onChange={(e) => setTheme(e.target.value as PuzzleTheme | "")}>
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
        {status && (
          <div className={`puzzle-status ${status.cls}`}>
            <div className="puzzle-status-title">{status.title}</div>
            {status.text && <div className="small">{status.text}</div>}
            {puzzle && done && (
              <div className="small muted">
                Puzzle-Rating {puzzle.rating} · {DIFFICULTIES[difficultyOf(puzzle.rating)].label}
              </div>
            )}
          </div>
        )}
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
        <div className="actions">
          {!done ? (
            <>
              <button className="btn ghost" onClick={() => setHint((h) => h + 1)} disabled={phase !== "play"} title="Markiert die Figur, die ziehen muss">
                💡 Tipp
              </button>
              <button className="btn ghost" onClick={() => setSolution((s) => s + 1)} disabled={phase === "intro" || phase === "busy"}>
                👁 Lösung
              </button>
            </>
          ) : (
            <>
              {!daily && (
                <button className="btn primary" onClick={next}>
                  Weiter →
                </button>
              )}
              <button className="btn ghost" onClick={analyse}>
                🔍 Analysieren
              </button>
            </>
          )}
        </div>
        {puzzle && (
          <div className="muted small">
            Puzzle <a href={href(`/puzzles/${puzzle.id}`)} onClick={onLinkClick}>#{puzzle.id}</a>
            {puzzle.source.startsWith("game:") && (
              <>
                {" "}
                · aus <a href={href(`/game/${puzzle.source.slice(5)}`)} onClick={onLinkClick}>deiner Partie</a>
              </>
            )}
          </div>
        )}
        {stats && <History stats={stats} />}
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
          .slice(0, 20)
          .reverse()
          .map((h, i) => (
            <a
              key={i}
              href={href(`/puzzles/${h.puzzle_id}`)}
              onClick={onLinkClick}
              className={`hdot ${h.win ? "win" : "loss"}`}
              title={`${h.win ? "Gelöst" : "Nicht gelöst"} · Rating danach ${h.rating_after}`}
            />
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
      <div className="board-column">
        {pub && !over ? (
          <PuzzleBoard
            key={pub.id}
            puzzle={pub}
            full={current}
            failFast
            introDelay={250}
            onOutcome={onOutcome}
            onPhase={(p) => p === "busy" && setStartedAt((t) => t ?? Date.now())}
          />
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
      <aside className="side-panel glass puzzle-panel">
        <div className="storm-head">
          <div className={`storm-clock ${left < 20_000 && startedAt ? "low" : ""}`}>
            {mm}:{String(ss).padStart(2, "0")}
          </div>
          <div className="storm-score">{score}</div>
        </div>
        <div className="storm-meta">
          <span>
            Combo <b>{combo}</b>
          </span>
          <span className="strikes">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i < strikes ? "x on" : "x"}>
                ✕
              </span>
            ))}
          </span>
        </div>
        <p className="muted small">
          3 Minuten, die Puzzles werden immer schwerer. Ein Fehler kostet ein Leben, nach drei Fehlern ist Schluss. Die Uhr startet mit deinem ersten Zug. Ungewertet.
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
        <div className="row-between">
          <div>
            <h2>Puzzles aus deinen Partien</h2>
            <p className="muted">
              Derselbe Algorithmus wie beim Puzzle-Generator: Stockfish sucht Züge, die die Partie gekippt haben, und behält nur Stellungen mit genau einer
              Gewinnfortsetzung. Läuft {import.meta.env.VITE_STATIC === "1" ? "in deinem Browser" : "auf dem Server"} und dauert pro Partie ca. 10–60 Sekunden.
            </p>
          </div>
        </div>
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
            <div className="game-row" key={g.id}>
              <span className="gr-players">
                {g.white.username} <span className="muted">vs</span> {g.black.username}
              </span>
              <span className="muted small">{g.san.length} Halbzüge</span>
              <span className="muted small">{g.result}</span>
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
