# ♞ Chessy

**API-first Schachplattform.** Bullet bis Daily, gegen Stockfish, gegen Freunde per Link, über die Lobby oder zu zweit an einem Gerät.
Das Web-Frontend ist nur *ein* Client der öffentlichen API. Bots, andere Apps und elektronische Schachbretter nutzen exakt dieselben Endpunkte.

- **Datenformat** angelehnt an die [chess.com Published-Data API](https://www.chess.com/news/view/published-data-api): `time_control` (`"180+2"`, `"1/86400"`, `"-"`), `time_class`, `fen`, `pgn`, Ergebniscodes wie `checkmated`, `resigned`, `timevsinsufficient`.
- **Echtzeit** im Stil der [Lichess Board API](https://lichess.org/api#tag/Board): NDJSON-Streams (`gameFull` / `gameState` / `chatLine`) und Züge per `POST …/move/e2e4`. Dieselben Events gibt es auch per WebSocket.
- **chess.com-Anbindung:** Profile, Ratings und Monatsarchive über einen Proxy laden und als nachspielbare Partie importieren. Die chess.com-API ist nur lesend; gespielt wird deshalb auf dem eigenen Server.

## Schnellstart

```bash
npm install
npm run build      # Web-Frontend bauen
npm start          # Server + Frontend auf http://localhost:3000, API-Doku unter /docs
```

Entwicklung mit Hot-Reload (Vite auf :5173, API auf :3000):

```bash
npm run dev
```

Voraussetzung: Node.js ≥ 22.5. SQLite kommt über das eingebaute `node:sqlite`, Stockfish als WASM aus npm, native Builds sind nicht nötig.

## Funktionen

| | |
|---|---|
| **Zeitmodi** | Bullet (1+0, 1+1, 2+1), Blitz (3+0, 3+2, 5+0, 5+3), Schnell (10+0, 10+5, 15+10), Klassisch (30+0, 30+20), Daily (1/3/7 Tage pro Zug), unbegrenzt, frei einstellbar. Serverautoritative Uhr mit Inkrement und Lag-Ausgleich (max. 300 ms). |
| **Gegner** | Stockfish in 8 Stufen · Online-Lobby mit Matchmaking · Einladungslink · Lokal (zwei Spieler, ein Gerät) |
| **Regeln** | Matt, Patt, dreifache Wiederholung, 50 Züge, ungenügendes Material, Zeit gegen ungenügendes Material, Abbruch vor dem ersten Zug, Remis- und Rücknahmeangebote |
| **Brett** | Eigenes Brett: Drag & Drop + Klick, animierte Figuren, Pfeile/Kreise per Rechtsklick, Umwandlungsauswahl, 6 Farbschemata, Sounds |
| **Analyse** | Bewertungsbalken + Hauptvariante (Stockfish), Nachspielen per Pfeiltasten, PGN-Export |
| **chess.com** | Profil, Ratings, Archive; Partien importieren und analysieren |
| **Boards** | `BoardAdapter`-Schnittstelle, Terminal-Brett, DGT-E-Board-Adapter (experimentell) |

## Architektur

```
packages/shared          Typen (GameSnapshot, Events), Zeitmodi + Presets
apps/server              Fastify: REST, NDJSON-Streams, WebSocket, OpenAPI (/docs), Stockfish-Pool, SQLite
  src/game/clock.ts      Schachuhr (rein, testbar)
  src/game/game.ts       Partie: Regeln (chess.js), Ergebnis, PGN
  src/game/service.ts    Lebenszyklus, Lobby, KI-Züge, Event-Bus
  src/ai/stockfish.ts    Stockfish-WASM als Kindprozesse (UCI), Spielstufen 1–8
  src/chesscom/          Client für die chess.com Published-Data API (Cache, serielle Anfragen)
apps/web                 React + Vite, ausschließlich über die öffentliche API
packages/board-adapters  ChessyClient, ApiBridge, ConsoleAdapter, DgtAdapter, CLI
examples/random-bot.ts   Bot in ~50 Zeilen
openapi.json             Generierte Spezifikation (npm run openapi)
```

Alle Transporte (REST-Antworten, NDJSON, WebSocket) hängen an einem gemeinsamen Event-Bus im `GameService`. Ein neuer Transport (z. B. MQTT für LED-Bretter) braucht deshalb keine Änderung an der Spiellogik.

## API in 30 Sekunden

```bash
# Token holen (guest | bot | board)
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/bot -H 'content-type: application/json' -d '{"username":"MeinBot"}' | jq -r .token)

# Partie gegen Stockfish Stufe 5, 5+3, als Weiß
GAME=$(curl -s -X POST localhost:3000/api/v1/games -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"opponent":{"type":"ai","level":5},"time_control":"300+3","color":"white"}' | jq -r .id)

# Live mitlesen
curl -N localhost:3000/api/v1/games/$GAME/stream

# Ziehen (UCI oder SAN)
curl -X POST localhost:3000/api/v1/games/$GAME/move/e2e4 -H "authorization: Bearer $TOKEN"
```

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/auth/{guest,bot,board}` | Account + Token |
| `GET` | `/api/v1/account` | Eigener Account |
| `POST` | `/api/v1/games` | Partie: `opponent` = `{type:"ai",level}` · `{type:"local"}` · `{type:"friend"}` |
| `POST` | `/api/v1/games/{id}/join` | Einladung annehmen |
| `GET` | `/api/v1/games/{id}` · `/pgn` · `/chat` | Snapshot, PGN, Chat |
| `GET` | `/api/v1/games/{id}/stream` | NDJSON: `gameFull`, `gameState`, `chatLine` |
| `POST` | `/api/v1/games/{id}/move/{uci}` | Zug (`?lag=ms` optional) |
| `POST` | `/api/v1/games/{id}/{resign,abort}` | Aufgeben / Abbrechen |
| `POST` | `/api/v1/games/{id}/{draw,takeback}/{offer,accept,decline}` | Angebote |
| `POST` | `/api/v1/games/import` | PGN importieren |
| `GET/POST/DELETE` | `/api/v1/seeks` | Lobby |
| `GET` | `/api/v1/stream/events` | NDJSON: `gameStart`, `gameFinish`, `seekRemoved` |
| `GET` | `/api/v1/ws?token=` | WebSocket (`subscribe`/`unsubscribe`/`lobby`) |
| `GET` | `/api/v1/analysis?fen=&depth=` | Stockfish-Bewertung |
| `GET` | `/api/v1/chesscom/player/{name}[/stats, /games/archives, /games/{yyyy}/{mm}]` | chess.com-Proxy |

Die vollständige, interaktive Doku liegt unter **`/docs`** (Swagger UI), die Spezifikation unter `/docs/json` bzw. in `openapi.json`.

## Bretter & Bots verbinden

Siehe [docs/connect-a-board.md](docs/connect-a-board.md). Kurzfassung:

```bash
# Terminal-Brett gegen Stockfish Stufe 3
npm run board -- --token <BOARD_TOKEN> --ai 3 --tc 600+5

# DGT-Brett über USB (benötigt: npm install serialport)
npm run board -- --token <BOARD_TOKEN> --adapter dgt --port /dev/ttyUSB0 --seek 900+10

# Zufalls-Bot in der Lobby
npm run bot:random -- --tc 180+2
```

## Tests

```bash
npm test           # Vitest: Uhr, Regeln, REST-API, NDJSON-Stream, Lobby, Import, DGT-Protokoll, Zugerkennung
npm run typecheck
node e2e/smoke.cjs    # Playwright: Partie gegen Computer, Screenshots (Server muss laufen)
node e2e/online.cjs   # Playwright: zwei Browser spielen online + Lobby-Paarung
```

## Konfiguration

| Variable | Standard | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `CHESSY_DB` | `data/chessy.db` | SQLite-Datei; laufende Partien überstehen Neustarts |

## Lizenz

GPL-3.0-or-later (siehe [LICENSE](LICENSE)).
Stockfish ist GPLv3 (The Stockfish developers, WASM-Build von [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)).
Figurensatz „cburnett“ von [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), GPLv2+.
