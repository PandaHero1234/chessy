# Bretter, Bots und Apps verbinden

Chessy hat keine Sonderschnittstelle für das Web-Frontend: Jeder Client spricht dieselbe API.
Diese Anleitung zeigt drei Wege, von „ein paar curl-Befehle“ bis „echtes DGT-Brett“.

## 1. Token besorgen

```bash
curl -X POST http://localhost:3000/api/v1/auth/board -H 'content-type: application/json' -d '{"username":"Wohnzimmerbrett"}'
# → { "account": { "id": "…", "username": "Wohnzimmerbrett", "kind": "board" }, "token": "chy_…" }
```

Alternativ im Web unter **API → Bot oder Brett verbinden**. Alle weiteren Requests senden `Authorization: Bearer chy_…`
(Streams und WebSocket akzeptieren auch `?token=`).

## 2. Das Protokoll

Ein Client braucht genau zwei Streams und einen Endpunkt zum Ziehen:

1. **`GET /api/v1/stream/events`** (NDJSON) meldet `{"type":"gameStart","game":{"id","color","opponent","time_control"}}`.
   Laufende Partien werden beim Verbinden sofort gemeldet.
2. **`GET /api/v1/games/{id}/stream`** (NDJSON) beginnt mit `gameFull` (kompletter Snapshot) und liefert danach bei jeder Änderung `gameState`:
   ```json
   {"type":"gameState","moves":"e2e4 c7c5","fen":"…","last_move":"c7c5","last_san":"c5","status":"started",
    "clock":{"white":299120,"black":300000,"increment":0,"running":true,"at":1793354419721},
    "draw_offer":null,"takeback_offer":null,"result":"*","winner":null,"termination":null}
   ```
   Leere Zeilen sind Keep-alives.
3. **`POST /api/v1/games/{id}/move/{move}`** mit UCI (`e2e4`, `e7e8q`) oder SAN (`Nf3`, `O-O`).
   Fehler kommen als `{"error":"illegal_move","message":"…"}` mit Status 400/409.

Partien starten per `POST /api/v1/games` (Computer, lokal, Einladung) oder `POST /api/v1/seeks` (Lobby).

## 3. Mit dem Board-Adapter-Paket

`packages/board-adapters` kapselt das Protokoll:

```ts
import { ChessyClient, ApiBridge, type BoardAdapter } from "@chessy/board-adapters";

class MeinBrett implements BoardAdapter {
  name = "mein-brett";
  async connect() { /* Hardware öffnen */ }
  onMove(cb: (move: string) => void) { /* bei erkanntem Zug cb("e2e4") aufrufen */ }
  setPosition({ fen, lastMove, myTurn }) { /* LEDs/Display aktualisieren */ }
  showMessage(text: string) { /* Status anzeigen */ }
  async close() {}
}

await new ApiBridge(new ChessyClient("http://localhost:3000", TOKEN), new MeinBrett()).start();
```

Für Sensor-Bretter, die nur Belegungen melden, hilft `detectMove(fen, placement)`: Die Funktion findet den legalen Zug, der
zur physischen Stellung führt, inklusive Rochade, en passant und Umwandlung.

### Mitgelieferte Adapter

| Adapter | Aufruf | Status |
|---|---|---|
| Terminal | `npm run board -- --token T --ai 3` | stabil |
| DGT (USB/Seriell) | `npm run board -- --token T --adapter dgt --port /dev/ttyUSB0 [--flipped]` | experimentell: Protokoll + Zugerkennung per Unit-Test geprüft, ohne echte Hardware getestet. Benötigt `npm install serialport`. |

Optionen der CLI: `--url`, `--ai <1-8>`, `--tc <"600+5">`, `--color <white|black|random>`, `--seek <tc>`.

Beim DGT-Brett werden eigene Züge automatisch erkannt, sobald die Stellung einem legalen Zug entspricht.
Der Zug des Gegners muss am Brett nachgezogen werden; bis dahin wird nichts gesendet.

## 4. Weitere Brett-Typen

Neue Hardware braucht nur einen `BoardAdapter`. Für Chessnut (Bluetooth LE), Millennium oder Square Off kann ein Adapter die
Belegung in einen FEN-Figurenteil übersetzen und `detectMove` nutzen. Für Browser-Clients bietet sich WebSerial/WebBluetooth
an; `ChessyClient` läuft dank `fetch` auch im Browser.
