// Lädt die ausgelieferte Puzzle-Sammlung (alle Rating-Bänder) für die Browser-Tests: Map von ID auf Puzzle.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "../packages/puzzles/data/bands");
const byId = new Map();
for (const f of fs.readdirSync(dir)) {
  for (const [id, fen, moves, rating] of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) byId.set(id, { id, fen, moves: moves.split(" "), rating });
}
module.exports = { byId };
