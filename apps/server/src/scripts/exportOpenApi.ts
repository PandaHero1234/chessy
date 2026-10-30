import { writeFileSync } from "node:fs";
import { buildApp } from "../app.ts";

const { app } = await buildApp({ webDist: null, engine: { bestMove: async () => "", analyse: async () => ({}) as never, close() {} } });
await app.ready();
const out = new URL("../../../../openapi.json", import.meta.url);
writeFileSync(out, JSON.stringify(app.swagger(), null, 2) + "\n");
console.log(`OpenAPI-Spezifikation geschrieben: ${out.pathname}`);
await app.close();
