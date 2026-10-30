/**
 * Beispiel-Bot: sucht in der Lobby einen Gegner und spielt zufällige legale Züge.
 * Zeigt, wie wenig Code ein API-Client braucht.
 *
 *   npm run bot:random -- [--url http://localhost:3000] [--tc 180+2]
 */
import { parseArgs } from "node:util";
import { Chess } from "chess.js";
import { ChessyClient } from "@chessy/board-adapters";

const { values } = parseArgs({
  options: { url: { type: "string", default: "http://localhost:3000" }, tc: { type: "string", default: "180+2" }, token: { type: "string" } },
});

let token = values.token;
if (!token) {
  const r = await fetch(`${values.url}/api/v1/auth/bot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  token = ((await r.json()) as { token: string }).token;
}
const client = new ChessyClient(values.url!, token);
const me = await client.account();
console.log(`🤖 ${me.username} sucht eine Partie (${values.tc}) …`);
await client.seek(values.tc!);

for await (const event of client.streamEvents()) {
  if (event.type !== "gameStart") continue;
  const { id, color } = event.game;
  console.log(`▶ Partie ${values.url}/game/${id} als ${color}`);
  for await (const e of client.streamGame(id)) {
    if (e.type !== "gameFull" && e.type !== "gameState") continue;
    const state = e.type === "gameFull" ? e.game : e;
    if (state.status !== "started") {
      console.log(`■ Ende: ${state.result}`);
      break;
    }
    const chess = new Chess(state.fen);
    if ((chess.turn() === "w") !== (color === "white")) continue;
    const moves = chess.moves({ verbose: true });
    const m = moves[Math.floor(Math.random() * moves.length)]!;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    await client.move(id, m.from + m.to + (m.promotion ?? "")).catch((err: Error) => console.warn(err.message));
  }
  await client.seek(values.tc!);
}
