import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const { app } = await buildApp({ dbPath: process.env.CHESSY_DB ?? "data/chessy.db", logger: true });
await app.listen({ port, host });
console.log(`♞ Chessy läuft auf http://localhost:${port}  –  API-Doku: http://localhost:${port}/docs`);

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void app.close().then(() => process.exit(0)));
