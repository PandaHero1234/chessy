import { useState } from "react";
import { api, type ChessComGame, type ChessComPlayer, type ChessComStats } from "../lib/api.ts";
import { navigate } from "../lib/router.ts";
import { useToast } from "../App.tsx";

const STAT_LABELS: [keyof ChessComStats, string, string][] = [
  ["chess_bullet", "Bullet", "⚡"],
  ["chess_blitz", "Blitz", "🔥"],
  ["chess_rapid", "Schnell", "⏱"],
  ["chess_daily", "Daily", "☀"],
];

/** chess.com-Profil, Ratings und Partien über die Published-Data API (Proxy über unseren Server). */
export function ChessCom() {
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [player, setPlayer] = useState<ChessComPlayer | null>(null);
  const [stats, setStats] = useState<ChessComStats | null>(null);
  const [archives, setArchives] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (u: string) => {
    setLoading(true);
    setError(null);
    setPlayer(null);
    setGames([]);
    try {
      const [p, s, a] = await Promise.all([api.chesscom.player(u), api.chesscom.stats(u), api.chesscom.archives(u)]);
      setPlayer(p);
      setStats(s);
      const list = [...a.archives].reverse();
      setArchives(list);
      if (list[0]) await loadMonth(u, list[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadMonth = async (u: string, url: string) => {
    const [y, m] = url.split("/").slice(-2) as [string, string];
    setMonth(url);
    try {
      const r = await api.chesscom.month(u, y, m);
      setGames([...r.games].reverse().filter((g) => g.rules === "chess"));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const replay = async (g: ChessComGame) => {
    if (!g.pgn) return toast("Diese Partie enthält kein PGN");
    try {
      const imported = await api.importPgn(g.pgn);
      navigate(`/game/${imported.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="page narrow">
      <section className="glass card">
        <h2>chess.com verbinden</h2>
        <p className="muted">
          Lade Profil, Ratings und Partien eines chess.com-Accounts über die offizielle Published-Data API und spiel sie mit Engine-Analyse nach.
        </p>
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) void load(username.trim());
          }}
        >
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="chess.com-Benutzername, z. B. hikaru" />
          <button className="btn primary" disabled={loading}>
            {loading ? "Lade…" : "Laden"}
          </button>
        </form>
        {error && <div className="error-box">{error}</div>}
      </section>

      {player && (
        <section className="glass card">
          <div className="cc-profile">
            {player.avatar ? <img src={player.avatar} alt="" className="cc-avatar" /> : <div className="cc-avatar placeholder">♞</div>}
            <div>
              <h2>
                {player.title && <span className="title-badge">{player.title}</span>} {player.username}
              </h2>
              <div className="muted">
                {player.name && `${player.name} · `}
                {player.followers !== undefined && `${player.followers.toLocaleString("de-DE")} Follower · `}
                {player.joined && `dabei seit ${new Date(player.joined * 1000).getFullYear()}`}
              </div>
            </div>
          </div>
          {stats && (
            <div className="stat-grid">
              {STAT_LABELS.map(([key, label, icon]) => {
                const s = stats[key] as { last?: { rating: number }; best?: { rating: number }; record?: { win: number; loss: number; draw: number } } | undefined;
                if (!s?.last) return null;
                return (
                  <div className="stat" key={key}>
                    <div className="stat-label">
                      {icon} {label}
                    </div>
                    <div className="stat-value">{s.last.rating}</div>
                    <div className="muted small">
                      Bestwert {s.best?.rating ?? "–"}
                      {s.record && ` · ${s.record.win}/${s.record.draw}/${s.record.loss}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {archives.length > 0 && player && (
        <section className="glass card">
          <div className="row-between">
            <h2>Partien</h2>
            <select value={month ?? ""} onChange={(e) => loadMonth(player.username, e.target.value)}>
              {archives.map((a) => {
                const [y, m] = a.split("/").slice(-2);
                return (
                  <option key={a} value={a}>
                    {new Date(Number(y), Number(m) - 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="game-list">
            {games.length === 0 && <div className="muted">Keine Partien in diesem Monat.</div>}
            {games.map((g) => {
              const me = g.white.username.toLowerCase() === player.username.toLowerCase() ? g.white : g.black;
              const res = me.result === "win" ? "win" : ["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"].includes(me.result) ? "draw" : "loss";
              return (
                <button className="game-row" key={g.url} onClick={() => replay(g)}>
                  <span className={`dot ${res}`} />
                  <span className="gr-players">
                    {g.white.username} <span className="muted">({g.white.rating})</span> <span className="muted">vs</span> {g.black.username}{" "}
                    <span className="muted">({g.black.rating})</span>
                  </span>
                  <span className="muted small cap">{g.time_class}</span>
                  <span className="muted small">{new Date(g.end_time * 1000).toLocaleDateString("de-DE")}</span>
                  <span className={`gr-result ${res}`}>{res === "win" ? "Sieg" : res === "draw" ? "Remis" : "Niederlage"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
