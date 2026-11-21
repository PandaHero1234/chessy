# Puzzle-Bericht

Erzeugt mit `npm run puzzles:pack`: **102.400 Puzzles** in 26 Rating-Bändern (14.3 MB).

## Herkunft

| Quelle | Anzahl |
|---|---|
| Eigener Generator (Stockfish-Selbstspiel) | 1.024 |
| Lichess-Puzzle-Datenbank (CC0) | 101.376 |

Aus 6.193.530 Lichess-Puzzles bestehen 3.292.767 den Qualitätsfilter (mindestens 200 Lösungsversuche, Beliebtheit ≥ 80, Rating-Abweichung ≤ 90). Daraus wird je Rating-Band eine feste Zahl gezogen (Reihenfolge nach Hash der ID, also reproduzierbar). 0 Kandidaten fielen bei der Nachprüfung der Zugfolgen durch.

## Verteilung nach Stufe

| Stufe | Rating | Anzahl | Anteil |
|---|---|---|---|
| Einsteiger | 0–999 | 15.360 | 15 % |
| Leicht | 1000–1399 | 25.600 | 25 % |
| Mittel | 1400–1799 | 25.600 | 25 % |
| Schwer | 1800–2199 | 22.528 | 22 % |
| Meister | 2200– | 13.312 | 13 % |

## Rating-Bänder

```
0400–499 ████████████████ 2560
0500–599 ████████████████ 2560
0600–699 ████████████████ 2560
0700–799 ████████████████ 2560
0800–899 ████████████████ 2560
0900–999 ████████████████ 2560
1000–1099████████████████████████████████████████ 6400
1100–1199████████████████████████████████████████ 6400
1200–1299████████████████████████████████████████ 6400
1300–1399████████████████████████████████████████ 6400
1400–1499████████████████████████████████████████ 6400
1500–1599████████████████████████████████████████ 6400
1600–1699████████████████████████████████████████ 6400
1700–1799████████████████████████████████████████ 6400
1800–1899███████████████████████████████████ 5632
1900–1999███████████████████████████████████ 5632
2000–2099███████████████████████████████████ 5632
2100–2199███████████████████████████████████ 5632
2200–2299█████████████ 2094
2300–2399█████████████ 2094
2400–2499█████████████ 2093
2500–2599█████████████ 2093
2600–2699█████████████ 2093
2700–2799█████████████ 2093
2800–2899████ 666
2900+   █ 86
```

## Themen

| Thema | Anzahl |
|---|---|
| Matt (`mate`) | 27.411 |
| Matt in 1 (`mateIn1`) | 11.690 |
| Matt in 2 (`mateIn2`) | 11.297 |
| Matt in 3 (`mateIn3`) | 3.519 |
| Matt in 4 (`mateIn4`) | 687 |
| Matt in 5+ (`mateIn5`) | 218 |
| Grundreihenmatt (`backRankMate`) | 2.207 |
| Ersticktes Matt (`smotheredMate`) | 284 |
| Gabel (`fork`) | 12.597 |
| Fesselung (`pin`) | 6.961 |
| Spieß (`skewer`) | 2.222 |
| Abzugsangriff (`discoveredAttack`) | 5.641 |
| Doppelschach (`doubleCheck`) | 680 |
| Opfer (`sacrifice`) | 9.018 |
| Hängende Figur (`hangingPiece`) | 4.064 |
| Stiller Zug (`quietMove`) | 5.018 |
| Umwandlung (`promotion`) | 2.450 |
| Unterverwandlung (`underPromotion`) | 25 |
| En passant (`enPassant`) | 175 |
| Vorteil (`advantage`) | 32.274 |
| Entscheidender Vorteil (`crushing`) | 41.855 |
| Eröffnung (`opening`) | 5.294 |
| Mittelspiel (`middlegame`) | 47.208 |
| Endspiel (`endgame`) | 49.898 |
| Ein Zug (`oneMove`) | 12.437 |
| Kurz (2 Züge) (`short`) | 47.919 |
| Lang (3 Züge) (`long`) | 30.990 |
| Sehr lang (4+ Züge) (`veryLong`) | 10.208 |
| Ausgleich (`equality`) | 14 |
| Hinlenkung (`attraction`) | 4.513 |
| Ablenkung (`deflection`) | 4.920 |
| Zwischenzug (`intermezzo`) | 1.354 |
| Zugzwang (`zugzwang`) | 1.329 |
| Röntgenangriff (`xRayAttack`) | 426 |
| Verteidiger beseitigen (`capturingDefender`) | 847 |
| Gefangene Figur (`trappedPiece`) | 1.350 |
| Räumung (`clearance`) | 1.544 |
| Unterbrechung (`interference`) | 423 |
| Verteidigungszug (`defensiveMove`) | 6.924 |
| Ungeschützter König (`exposedKing`) | 3.621 |
| Angriff am Königsflügel (`kingsideAttack`) | 8.567 |
| Angriff am Damenflügel (`queensideAttack`) | 1.552 |
| Vorgerückter Bauer (`advancedPawn`) | 6.899 |
| Angriff auf f2/f7 (`attackingF2F7`) | 706 |
| Rochade (`castling`) | 41 |
| Bauernendspiel (`pawnEndgame`) | 4.375 |
| Turmendspiel (`rookEndgame`) | 5.230 |
| Damenendspiel (`queenEndgame`) | 1.256 |
| Läuferendspiel (`bishopEndgame`) | 1.643 |
| Springerendspiel (`knightEndgame`) | 903 |
| Dame-Turm-Endspiel (`queenRookEndgame`) | 546 |
| Anastasia-Matt (`anastasiaMate`) | 143 |
| Arabisches Matt (`arabianMate`) | 127 |
| Boden-Matt (`bodenMate`) | 51 |
| Läuferpaar-Matt (`doubleBishopMate`) | 47 |
| Schwalbenschwanz-Matt (`dovetailMate`) | 75 |
| Hakenmatt (`hookMate`) | 172 |

## Lösungslänge

| Lösungszüge | Anzahl |
|---|---|
| 1 | 12.460 |
| 2 | 48.320 |
| 3 | 31.312 |
| 4 | 7.304 |
| 5 | 2.065 |
| 6 | 615 |
| 7+ | 324 |

Feste Auswahlen: 800 Puzzles für den Puzzle-Sturm, 400 für das Tagespuzzle.
