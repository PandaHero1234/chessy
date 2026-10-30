import { useEffect, useState } from "react";
import type { GameSnapshot } from "@chessy/shared";
import { describeTimeControl, parseTimeControl } from "@chessy/shared";
import { TimeControlPicker } from "../components/TimeControlPicker.tsx";
import { Board } from "../components/Board.tsx";
import { api } from "../lib/api.ts";
import { navigate, onLinkClick } from "../lib/router.ts";
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

export function Home() {
  const account = useAccount();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("ai");
  const [tc, setTc] = useState("600+5");
  const [level, setLevel] = useState(3);
  const [color, setColor] = useState<"white" | "random" | "black">("random");
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
            <a href="/developers" onClick={onLinkClick} className="btn ghost">
              ⌘ API &amp; Boards verbinden
            </a>
            <a href="/chesscom" onClick={onLinkClick} className="btn ghost">
              ♞ chess.com-Profil laden
            </a>
          </div>
        </div>
        <div className="hero-board" aria-hidden>
          <Board fen={HERO_FEN} orientation="white" movable={null} dests={new Map()} lastMove={["f1", "c4"]} />
        </div>
      </section>

      <section className="glass card new-game">
        <h2>Neue Partie</h2>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-card ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>
              <span className="mode-icon">{m.icon}</span>
              <span className="mode-title">{m.title}</span>
              <span className="mode-text">{m.text}</span>
            </button>
          ))}
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
                        <img src={`/pieces/cburnett/${c === "white" ? "w" : "b"}K.svg`} alt="" />
                      )}
                      {c === "white" ? "Weiß" : c === "black" ? "Schwarz" : "Zufall"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="summary muted">
              {MODES.find((m) => m.id === mode)!.title} · {describeTimeControl(parseTimeControl(tc))}
              {mode === "ai" && ` · Stufe ${level}`}
            </div>
            <button className="btn primary big full" disabled={busy || !account} onClick={start}>
              {mode === "online" ? "Gegner suchen" : mode === "friend" ? "Einladung erstellen" : "Spielen"}
            </button>
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
    <a className="game-row" href={`/game/${g.id}`} onClick={onLinkClick}>
      <span className={`dot ${g.status}`} />
      <span className="gr-players">
        {g.white.username} <span className="muted">vs</span> {g.black.username}
      </span>
      <span className="muted small cap">{g.time_class}</span>
      <span className={`gr-result ${outcome === "Sieg" ? "win" : outcome === "Niederlage" ? "loss" : ""}`}>{outcome}</span>
    </a>
  );
}
