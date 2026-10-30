#!/usr/bin/env -S npx tsx
/**
 * Verbindet ein Brett mit einem Chessy-Server.
 *
 *   npm run board -- --token <TOKEN> [--url http://localhost:3000] [--adapter console|dgt] [--port /dev/ttyUSB0]
 *                    [--ai 3 --tc 300+3 --color white] [--seek 300+3]
 */
import { parseArgs } from "node:util";
import { ApiBridge } from "./bridge.ts";
import { ChessyClient } from "./client.ts";
import { ConsoleAdapter } from "./adapters/console.ts";
import { DgtAdapter, type ByteTransport } from "./adapters/dgt.ts";
import type { BoardAdapter } from "./types.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: process.env.CHESSY_URL ?? "http://localhost:3000" },
    token: { type: "string", default: process.env.CHESSY_TOKEN },
    adapter: { type: "string", default: "console" },
    port: { type: "string" },
    flipped: { type: "boolean", default: false },
    ai: { type: "string" },
    seek: { type: "string" },
    tc: { type: "string", default: "600+5" },
    color: { type: "string", default: "random" },
  },
});

if (!values.token) {
  console.error("Token fehlt. Erzeuge eins unter /developers oder per:\n  curl -X POST <url>/api/v1/auth/board");
  process.exit(1);
}

async function serialTransport(path: string): Promise<ByteTransport> {
  let mod: { SerialPort: new (o: { path: string; baudRate: number }) => NodeJS.ReadWriteStream & { close(): void } };
  try {
    mod = (await import(/* @vite-ignore */ "serialport" as string)) as typeof mod;
  } catch {
    console.error('Für DGT-Bretter wird das Paket "serialport" benötigt:  npm install serialport');
    process.exit(1);
  }
  const port = new mod.SerialPort({ path, baudRate: 9600 });
  return {
    write: (b) => void port.write(Buffer.from(b)),
    onData: (cb) => void port.on("data", (d: Buffer) => cb(new Uint8Array(d))),
    close: () => port.close(),
  };
}

const client = new ChessyClient(values.url!, values.token);
let adapter: BoardAdapter;
if (values.adapter === "dgt") {
  if (!values.port) {
    console.error("--port fehlt, z. B. --port /dev/ttyUSB0 oder COM3");
    process.exit(1);
  }
  adapter = new DgtAdapter(await serialTransport(values.port), { flipped: values.flipped });
} else adapter = new ConsoleAdapter();

const bridge = new ApiBridge(client, adapter);
process.on("SIGINT", () => void bridge.stop().then(() => process.exit(0)));

if (values.ai) {
  const g = await client.createAiGame(Number(values.ai), values.tc!, values.color as "white" | "black" | "random");
  console.log(`Partie gegen Stockfish Stufe ${values.ai} erstellt: ${values.url}/game/${g.id}`);
} else if (values.seek) {
  const r = await client.seek(values.seek);
  console.log(r.game ? `Gegner gefunden: ${values.url}/game/${r.game.id}` : `Gesuch ${values.seek} erstellt, warte auf Gegner…`);
}
await bridge.start();
