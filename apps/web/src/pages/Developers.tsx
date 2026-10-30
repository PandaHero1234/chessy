import { useState } from "react";
import { api } from "../lib/api.ts";
import { useToast } from "../App.tsx";
import { STATIC } from "../lib/paths.ts";

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/api/v1/auth/{guest|bot|board}", "Account anlegen, Token erhalten"],
  ["POST", "/api/v1/games", "Partie: Computer, lokal oder Einladung"],
  ["POST", "/api/v1/seeks", "Lobby: Gegner suchen"],
  ["GET", "/api/v1/stream/events", "NDJSON: gameStart, gameFinish …"],
  ["GET", "/api/v1/games/{id}/stream", "NDJSON: gameFull, gameState, chatLine"],
  ["POST", "/api/v1/games/{id}/move/{uci}", "Zug ausführen (e2e4, e7e8q oder SAN)"],
  ["POST", "/api/v1/games/{id}/{resign|abort}", "Aufgeben / Abbrechen"],
  ["POST", "/api/v1/games/{id}/draw/{offer|accept|decline}", "Remis"],
  ["GET", "/api/v1/games/{id}/pgn", "Partie als PGN"],
  ["GET", "/api/v1/analysis?fen=…", "Stockfish-Bewertung"],
  ["GET", "/api/v1/chesscom/player/{name}/…", "chess.com Public API (Proxy)"],
  ["GET", "/api/v1/ws?token=…", "WebSocket mit denselben Events"],
];

export function Developers() {
  const toast = useToast();
  const [token, setToken] = useState<{ kind: string; token: string; username: string } | null>(null);
  const [name, setName] = useState("");
  const origin = location.origin;

  const create = async (kind: "bot" | "board") => {
    try {
      const r = await api.createToken(kind, name.trim() || undefined);
      setToken({ kind, token: r.token, username: r.account.username });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const curl = `# 1) Token holen
curl -X POST ${origin}/api/v1/auth/bot -H 'content-type: application/json' -d '{"username":"MeinBot"}'

# 2) Partie gegen Stockfish (Stufe 5, 5+3) erstellen
curl -X POST ${origin}/api/v1/games -H "authorization: Bearer $TOKEN" \\
  -H 'content-type: application/json' \\
  -d '{"opponent":{"type":"ai","level":5},"time_control":"300+3","color":"white"}'

# 3) Partie live verfolgen (NDJSON)
curl -N ${origin}/api/v1/games/$GAME/stream

# 4) Zug senden
curl -X POST ${origin}/api/v1/games/$GAME/move/e2e4 -H "authorization: Bearer $TOKEN"`;

  return (
    <div className="page narrow">
      <section className="glass card">
        <h2>API first</h2>
        <p className="muted">
          Diese Oberfläche ist selbst nur ein Client der öffentlichen Chessy-API. Alles, was du hier tun kannst, können auch Bots, andere Apps und elektronische
          Schachbretter, mit denselben Endpunkten. Das Datenformat lehnt sich an die chess.com Public API an, die Echtzeit-Streams an die Lichess Board API.
        </p>
        {STATIC && (
          <div className="offer" style={{ marginBottom: 14 }}>
            <span>
              Das hier ist die Browser-Demo auf GitHub Pages: Die Spiellogik läuft lokal, die API selbst gibt es nur mit dem Server (<code>npm start</code>).
            </span>
          </div>
        )}
        <div className="dev-links">
          <a className="btn primary" href={STATIC ? "https://github.com/PandaHero1234/chessy/blob/main/openapi.json" : "/docs"} target="_blank" rel="noreferrer">
            📖 {STATIC ? "OpenAPI-Spezifikation" : "Interaktive API-Doku (OpenAPI)"}
          </a>
          <a className="btn ghost" href={STATIC ? "https://github.com/PandaHero1234/chessy/blob/main/docs/connect-a-board.md" : "/docs/json"} target="_blank" rel="noreferrer">
            {STATIC ? "Boards verbinden" : "openapi.json"}
          </a>
        </div>
      </section>

      <section className="glass card">
        <h2>Endpunkte</h2>
        <div className="endpoints">
          {ENDPOINTS.map(([m, p, d]) => (
            <div className="endpoint" key={m + p}>
              <span className={`method ${m.toLowerCase()}`}>{m}</span>
              <code>{p}</code>
              <span className="muted small">{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="glass card">
        <h2>Bot oder Brett verbinden</h2>
        <p className="muted">
          Erzeuge ein Token für einen Bot oder ein elektronisches Brett. Mit dem Board-Adapter (<code>npm run board</code>) verbindest du z. B. ein DGT-Brett oder
          spielst im Terminal.
        </p>
        <div className="search-row" hidden={STATIC}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={20} />
          <button className="btn ghost" onClick={() => create("bot")}>
            🤖 Bot-Token
          </button>
          <button className="btn ghost" onClick={() => create("board")}>
            ♟ Board-Token
          </button>
        </div>
        {token && (
          <div className="token-box">
            <div className="small muted">
              {token.kind === "bot" ? "Bot" : "Board"} <b>{token.username}</b>, das Token wird nur einmal angezeigt:
            </div>
            <div className="copy-row">
              <input readOnly value={token.token} onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={() => (navigator.clipboard?.writeText(token.token), toast("Token kopiert"))}>
                Kopieren
              </button>
            </div>
            <pre className="code small">npm run board -- --url {origin} --token {token.token} --adapter console</pre>
          </div>
        )}
      </section>

      <section className="glass card">
        <h2>Schnellstart mit curl</h2>
        <pre className="code">{curl}</pre>
      </section>
    </div>
  );
}
