# Schach-Puzzles: wie sie entstehen

Chessy erzeugt seine Puzzles selbst, mit nachvollziehbaren Algorithmen, ohne KI-Dienste und ohne API-Keys.
Die einzige „Intelligenz“ ist Stockfish, der auch als Computergegner dient und lokal läuft
(Server: Kindprozess, Pages-Demo: WebAssembly im Browser).

> Stockfish bewertet Stellungen intern mit einem kleinen neuronalen Netz (NNUE). Das ist Teil der Engine
> selbst, läuft offline und braucht keinen externen Dienst.

## Datenformat

Wie die offene [Lichess-Puzzle-Datenbank](https://database.lichess.org/#puzzles), damit sich deren Puzzles später importieren lassen:

```json
{ "id": "1xsewmo1tt", "fen": "<Stellung VOR dem Fehler>", "moves": ["<Fehler des Gegners>", "<Lösung>", "<Antwort>", "<Lösung>"],
  "rating": 1050, "themes": ["fork", "long", "middlegame"], "source": "selfplay" }
```

`moves[0]` wird vorgespielt, danach wechseln sich Lösungszüge und erzwungene Antworten ab. Die Lösung endet immer mit einem eigenen Zug.

## 1. Generator (`npm run puzzles:generate`)

1. **Selbstspiel:** Stockfish spielt in den Stufen 4–8 gegen sich selbst. Die Eröffnung kommt aus einem kleinen Buch (26 gängige Eröffnungen), danach spielt die Engine. So entstehen realistische Stellungen.
2. **Fehler einbauen:** An zufälligen Stellungen bewertet eine MultiPV-Suche (bis zu 40 Varianten) fast alle legalen Züge. Fehler-Kandidaten sind Züge, deren Gewinnchance¹ um mindestens 0,4 unter dem besten Zug liegt und die die eigene Seite klar in Nachteil bringen. Bevorzugt werden die plausibelsten, also die Züge, die die Engine selbst weit oben einordnet: Sie sehen gut aus und führen zu schwereren Puzzles.
3. **Lösung suchen und Eindeutigkeit prüfen** (`solveFrom` in `packages/puzzles/src/mining.ts`):
   - Für jeden Lösungszug läuft eine MultiPV-2-Suche (700.000 Knoten). Der beste Zug muss **eindeutig** sein:
     - Matt: Der zweitbeste Zug darf kein Matt sein. Matt in 1 ist immer gültig, beim Prüfen zählt jedes Matt.
     - Sonst: Der beste Zug muss mindestens +2 Bauern bringen, und seine Gewinnchance muss mindestens 0,35 über der des zweitbesten liegen.
   - Danach folgt die beste Verteidigung des Gegners, und die Prüfung wiederholt sich (max. 6 Lösungszüge). Die Lösung endet, sobald die Fortsetzung nicht mehr eindeutig ist.
   - **Greifbarer Gewinn:** Ohne Matt muss nach der besten Antwort des Gegners mindestens 2 Bauerneinheiten Material gewonnen sein. Reine Stellungsvorteile werden verworfen.
   - **Gegenprüfung:** Der erste Zug wird mit 2 Mio. Knoten erneut geprüft und muss eindeutig bleiben.
   - Eine billige Vorprüfung (1/5 der Knoten) verwirft offensichtlich mehrdeutige Kandidaten früh.
4. **Bauen** (`--build`): Doppelte Stellungen entfernen, Themen und Rating aus den gespeicherten Merkmalen neu berechnen, `packages/puzzles/data/puzzles.json` und [`docs/puzzles-report.md`](puzzles-report.md) schreiben.

Der Generator ist fortsetzbar: Funde landen sofort in `puzzles.raw.jsonl` (mit Merkmalen), ein Abbruch kostet nichts.

¹ Gewinnchance = `2 / (1 + e^(−0,00368 · cp)) − 1` (Skala −1…1, Formel wie bei Lichess).

## 2. Themen (`themes.ts`)

Rein regelbasiert: Die Lösung wird Zug für Zug auf dem Brett nachgespielt.

| Thema | Regel |
|---|---|
| Matt in n | Lösung endet mit Matt, n = Anzahl Lösungszüge |
| Grundreihenmatt | König auf eigener Grundreihe, Matt durch Turm/Dame auf dieser Reihe, Fluchtfelder davor von eigenen Figuren besetzt |
| Ersticktes Matt | Springermatt, alle Nachbarfelder des Königs von eigenen Figuren besetzt |
| Gabel | Gezogene Figur greift ≥ 2 wertvollere (oder ungedeckte) Figuren bzw. den König an, eine davon fällt später |
| Fesselung / Spieß | Langschrittfigur greift Figur an, dahinter steht eine wertvollere (Fesselung) bzw. weniger wertvolle (Spieß), die später fällt |
| Abzugsangriff | Eine andere eigene Figur greift durch den Zug neu König oder wertvolle Figur an |
| Doppelschach | König nach dem Zug von zwei Figuren angegriffen |
| Opfer | Figur zieht auf ein Feld, auf dem sie mit Materialverlust geschlagen werden kann |
| Hängende Figur | Einzüger, der eine ungedeckte Figur schlägt |
| Stiller Zug | Erster Lösungszug ist weder Schach noch Schlagen noch Umwandlung |
| Umwandlung, Unterverwandlung, en passant | Zug-Flags |
| Eröffnung / Mittelspiel / Endspiel | Zugnummer bzw. ≤ 6 Figuren (ohne Könige und Bauern) |
| Kurz / lang | Anzahl Lösungszüge |

## 3. Schwierigkeit (`difficulty.ts`)

Startrating aus Merkmalen der Lösung:

- Anzahl Lösungszüge (+280 je weiterem Zug)
- **Entdeckungstiefe:** ab welcher Suchtiefe die Engine den Lösungszug stabil als besten *und* klar gewinnenden Zug sieht (+70 je Tiefe über 3). Das ist ein guter Gradmesser dafür, wie weit ein Mensch rechnen muss.
- Stiller erster Zug +300, Opfer +180, Unterverwandlung +250
- Schlagzug −100, Schach −50, hängende Figur −300, Matt in 1 −150
- Verführungen (andere Schach-/Schlagzüge in der Startstellung) +20 je Zug
- Knapper Abstand zum zweitbesten Zug: bis +120

| Stufe | Rating |
|---|---|
| Einsteiger | < 1000 |
| Leicht | 1000–1399 |
| Mittel | 1400–1799 |
| Schwer | 1800–2199 |
| Meister | ≥ 2200 |

## 4. Ratings beim Spielen (`rating.ts`)

Elo-System: Erwartung `1 / (1 + 10^((Puzzle − Spieler) / 400))`.

- **Spieler:** K = 40 in den ersten 20 Versuchen, danach 24, ab 100 Versuchen 16.
- **Puzzle:** Auf dem Server passt sich auch das Puzzle-Rating an (K = 16, nach 10 Versuchen 8). So korrigieren echte Lösungsversuche die berechneten Startwerte.
- Gewertet wird der **erste** Versuch: Der erste Fehler zählt als nicht gelöst, „Lösung zeigen“ ebenso. Mit Tipp gelöst zählt als Versuch, ändert das Rating aber nicht.
- **Adaptiv:** Gewählt werden Puzzles innerhalb von ±100 um das eigene Rating. Gibt es weniger als 5, wird das Fenster schrittweise erweitert. Schon versuchte Puzzles kommen erst wieder, wenn alle passenden durch sind.

## 5. Modi

- **Training:** Stufe oder adaptiv, optional nach Thema
- **Tagespuzzle:** deterministisch aus dem Datum (UTC), Rating 1300–2100, mindestens 2 Lösungszüge
- **Puzzle-Sturm:** 3 Minuten, Schwierigkeit steigt von ~600 auf ~2400, 3 Leben, ungewertet. Hier wird lokal geprüft, deshalb schickt der Server die Lösungen mit.
- **Aus eigenen Partien:** Derselbe Algorithmus läuft über eine beendete eigene Partie, diesmal ohne eingebaute Fehler. Er sucht echte Züge, die die Partie gekippt haben, mit geringeren Knotenzahlen (Server: eigener Stockfish-Prozess, Demo: im Browser).

## API

| Methode | Pfad | |
|---|---|---|
| `GET` | `/api/v1/puzzles/catalog` | Anzahl je Stufe und Thema |
| `GET` | `/api/v1/puzzles/next?difficulty=&theme=&mine=` | Nächstes Puzzle (ohne Lösung) |
| `GET` | `/api/v1/puzzles/daily` | Tagespuzzle |
| `GET` | `/api/v1/puzzles/{id}` | Bestimmtes Puzzle |
| `POST` | `/api/v1/puzzles/{id}/check` | `{"moves": ["d5c7", …]}`: alle bisherigen eigenen Züge, Antwort `correct` (+ Gegenzug) / `wrong` / `solved` |
| `POST` | `/api/v1/puzzles/{id}/hint` | Tipp in zwei Stufen: `{"solved": 0}` nennt das Startfeld, mit `"level": 2` zusätzlich das Zielfeld |
| `POST` | `/api/v1/puzzles/{id}/solution` | Lösung (zählt als nicht gelöst) |
| `GET` | `/api/v1/puzzles/stats` | Rating, Serie, Verlauf, Themen-Statistik |
| `GET` | `/api/v1/puzzles/storm` · `POST …/storm/result` | Puzzle-Sturm |
| `POST` | `/api/v1/puzzles/from-game/{gameId}` | Eigene Partie durchsuchen |

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/bot -H 'content-type: application/json' -d '{}' | jq -r .token)
P=$(curl -s "localhost:3000/api/v1/puzzles/next?difficulty=medium" -H "authorization: Bearer $TOKEN")
curl -s -X POST localhost:3000/api/v1/puzzles/$(echo $P | jq -r .id)/check \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"moves":["e2e4"]}'
```

## Aktueller Stand und Grenzen

Die ausgelieferte Sammlung umfasst **1024 Puzzles** aus 128 Selbstspiel-Partien (98 Minuten auf 4 Kernen). Verteilung, Themen und Lösungslängen stehen in [puzzles-report.md](puzzles-report.md). Verworfen wurden 7820 Kandidaten wegen mehrdeutiger Lösung, 839 ohne greifbaren Materialgewinn und 57 in der Gegenprüfung. 1024 sehr leichte Funde fielen der Quote zum Opfer.

- **Schwere Stufen sind dünn besetzt** (Schwer 9, Meister 1). Im Selbstspiel entstehen selten tiefe, eindeutige Kombinationen. Die Ratings bleiben bewusst unverändert, statt sie künstlich anzuheben.
  - Mehr schwere Puzzles bringt ein längerer Generatorlauf; die Mattangriff-Suche liefert die meisten.
  - Alternativ lässt sich die Lichess-Datenbank importieren, das Format ist kompatibel.
- **Startratings sind Schätzungen.** Auf dem Server gleichen echte Lösungsversuche die Puzzle-Ratings per Elo an.
