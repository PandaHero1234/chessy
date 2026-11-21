import { useEffect, useState } from "react";
import type { GameSnapshot } from "@chessy/shared";
import { describeTimeControl, parseTimeControl, timeClassLabel } from "@chessy/shared";
import { TimeControlPicker } from "../components/TimeControlPicker.tsx";
import { Board } from "../components/Board.tsx";
import { api } from "../lib/api.ts";
import { navigate, onLinkClick } from "../lib/router.ts";
import { STATIC, href, pieceUrl } from "../lib/paths.ts";
import { useAccount, useToast } from "../App.tsx";

type Mode = "ai" | "online" | "friend" | "local";

const MODES: { id: Mode; title: string; text: string; icon: string }[] = [
  { id: "ai", title: "Computer", text: "Stockfish in 8 Stufen", icon: "🤖" },
  { id: "online", title: "Online", text: "Gegner in der Lobby finden", icon: "🌍" },
  { id: "friend", title: "Freund", text: "Per Link einladen", icon: "🔗" },
  { id: "local", title: "Lokal", text: "Zu zweit an einem Gerät", icon: "👥" },
];

const LEVEL_NAMES = ["", "Einsteiger", "Anfänger", "Gelegenheitsspieler", "Vereinsspieler", "Fortgeschritten", "Experte", "Meister", "Großmeister"];
const LEVEL_ELO = ["", "≈ 400", "≈ 800", "≈ 1100", "≈ 1400", "≈ 1700", "≈ 2000", "≈ 2400", "2800+"];

const HERO_FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5";

interface Prefs {
  mode: Mode;
  tc: string;
  level: number;
  color: "white" | "random" | "black";
}
const PREFS_KEY = "chessy.newGame";
function loadPrefs(): Prefs {
  const d: Prefs = { mode: "ai", tc: "600+5", level: 3, color: "random" };
  try {
    const p = { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") } as Prefs;
    parseTimeControl(p.tc);
    if (!MODES.some((m) => m.id === p.mode) || (STATIC && (p.mode === "online" || p.mode === "friend"))) p.mode = "ai";
    if (!(p.level >= 1 && p.level <= 8)) p.level = d.level;
    if (!["white", "random", "black"].includes(p.color)) p.color = d.color;
    return p;
  } catch {
    return d;
  }
}

export function Home() {
  const account = useAccount();
  const toast = useToast();
  // Die letzte Auswahl wird gemerkt, damit der Schnellstart mit einem Tipp funktioniert.
  const [prefs, setPrefs] = useState(loadPrefs);
  const { mode, tc, level, color } = prefs;
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* privater Modus */
      }
      return next;
    });
  const setMode = (m: Mode) => update({ mode: m });
  const setTc = (t: string) => update({ tc: t });
  const setLevel = (l: number) => update({ level: l });
  const setColor = (c: Prefs["color"]) => update({ color: c });
  const [busy, setBusy] = useState(false);
  const [games, setGames] = useState<GameSnapshot[]>([]);

  useEffect(() => {
    if (account) api.myGames().then(setGames, () => undefined);
  }, [account]);

  const start = async () => {
    setBusy(true);
    try {
      if (mode === "online") {
        const r = await api.seek(tc, color);
        if (r.game) navigate(`/game/${r.game.id}`);
        else navigate("/lobby");
        return;
      }
      const opp = mode === "ai" ? { type: "ai" as const, level } : mode === "local" ? { type: "local" as const } : { type: "friend" as const };
      const g = await api.createGame(opp, tc, color);
      navigate(`/game/${g.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const quickAi = async () => {
    setBusy(true);
    try {
      const g = await api.createGame({ type: "ai", level }, tc, color);
      navigate(`/game/${g.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const running = games.filter((g) => g.status === "started" || g.status === "waiting");
  const finished = games.filter((g) => g.status === "ended").slice(0, 8);

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <h1>
            Schach, <span className="accent">wunderschön</span> gespielt.
          </h1>
          <p className="lead">
            Bullet bis Daily, gegen Stockfish oder echte Gegner. Die offene API verbindet auch Bots, andere Apps und elektronische Bretter.
          </p>
          <div className="hero-links">
            <a href={href("/puzzles")} onClick={onLinkClick} className="btn primary">
              🧩 Puzzles lösen
            </a>
            <a href={href("/developers")} onClick={onLinkClick} className="btn ghost">
              ⌘ API &amp; Boards verbinden
            </a>
            <a href={href("/chesscom")} onClick={onLinkClick} className="btn ghost">
              ♞ chess.com-Profil laden
            </a>
          </div>
        </div>
        <div className="hero-board" aria-hidden>
          <Board fen={HERO_FEN} orientation="white" movable={null} dests={new Map()} lastMove={["f1", "c4"]} />
        </div>
      </section>

      <section className="quick-start" aria-label="Schnellstart">
        {running[0] && (
          <a className="quick-tile" href={href(`/game/${running[0].id}`)} onClick={onLinkClick}>
            <span className="quick-icon">▶</span>
            <span className="quick-text">
              <b>Partie fortsetzen</b>
              <span className="muted small">
                {running[0].white.username} vs {running[0].black.username}
              </span>
            </span>
          </a>
        )}
        <button className="quick-tile" onClick={quickAi} disabled={busy || !account}>
          <span className="quick-icon">🤖</span>
          <span className="quick-text">
            <b>Gegen den Computer</b>
            <span className="muted small">
              Sofort los · {describeTimeControl(parseTimeControl(tc))} · Stufe {level}
            </span>
          </span>
        </button>
        <a className="quick-tile" href={href("/puzzles")} onClick={onLinkClick}>
          <span className="quick-icon">🧩</span>
          <span className="quick-text">
            <b>Puzzle lösen</b>
            <span className="muted small">Passend zu deinem Rating</span>
          </span>
        </a>
      </section>

      <section className="glass card new-game">
        <h2>Neue Partie</h2>
        <div className="mode-grid">
          {MODES.map((m) => {
            const needsServer = STATIC && (m.id === "online" || m.id === "friend");
            return (
              <button
                key={m.id}
                className={`mode-card ${mode === m.id ? "active" : ""}`}
                onClick={() => setMode(m.id)}
                disabled={needsServer}
                title={needsServer ? "Benötigt den Chessy-Server (npm start)" : undefined}
              >
                <span className="mode-icon">{m.icon}</span>
                <span className="mode-title">{m.title}</span>
                <span className="mode-text">{needsServer ? "Nur mit Server" : m.text}</span>
              </button>
            );
          })}
        </div>

        <div className="new-game-grid">
          <div>
            <h3 className="section-label">Zeitmodus</h3>
            <TimeControlPicker value={tc} onChange={setTc} />
          </div>
          <div className="new-game-options">
            {mode === "ai" && (
              <div className="option-block">
                <h3 className="section-label">Spielstärke</h3>
                <div className="level-display">
                  <span className="level-num">{level}</span>
                  <div>
                    <div className="level-name">{LEVEL_NAMES[level]}</div>
                    <div className="muted small">Elo {LEVEL_ELO[level]}</div>
                  </div>
                </div>
                <input type="range" min={1} max={8} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="level-range" />
                <div className="level-ticks">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
                    <button key={l} className={l === level ? "on" : ""} onClick={() => setLevel(l)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mode !== "local" && (
              <div className="option-block">
                <h3 className="section-label">Deine Farbe</h3>
                <div className="segmented">
                  {(["white", "random", "black"] as const).map((c) => (
                    <button key={c} className={color === c ? "active" : ""} onClick={() => setColor(c)} title={c}>
                      {c === "random" ? (
                        <span className="color-dot half" />
                      ) : (
                        <img src={pieceUrl(c === "white" ? "wK" : "bK")} alt="" />
                      )}
                      {c === "white" ? "Weiß" : c === "black" ? "Schwarz" : "Zufall"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="play-bar">
              <div className="summary muted">
                {MODES.find((m) => m.id === mode)!.title} · {describeTimeControl(parseTimeControl(tc))}
                {mode === "ai" && ` · Stufe ${level}`}
              </div>
              <button className="btn primary big full start-btn" disabled={busy || !account} onClick={start}>
                {mode === "online" ? "Gegner suchen" : mode === "friend" ? "Einladung erstellen" : "Spielen"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {(running.length > 0 || finished.length > 0) && (
        <section className="glass card">
          <h2>Deine Partien</h2>
          <div className="game-list">
            {[...running, ...finished].map((g) => (
              <GameRow key={g.id} g={g} me={account?.id} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function GameRow({ g, me }: { g: GameSnapshot; me?: string }) {
  const myColor = g.white.id === me && g.white.kind !== "local" ? "white" : g.black.id === me ? "black" : null;
  const outcome =
    g.status === "started" ? "läuft" : g.status === "waiting" ? "wartet" : g.status === "aborted" ? "abgebr." : !g.winner ? "½–½" : myColor && g.source === "live" ? (g.winner === myColor ? "Sieg" : "Niederlage") : g.result;
  return (
    <a className="game-row" href={href(`/game/${g.id}`)} onClick={onLinkClick}>
      <span className={`dot ${g.status}`} />
      <span className="gr-players">
        {g.white.username} <span className="muted">vs</span> {g.black.username}
      </span>
      <span className="muted small cap">{timeClassLabel(g.time_class)}</span>
      <span className={`gr-result ${outcome === "Sieg" ? "win" : outcome === "Niederlage" ? "loss" : ""}`}>{outcome}</span>
    </a>
  );
}
