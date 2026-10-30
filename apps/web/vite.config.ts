import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Stockfish-WASM für den Browser (statische Demo) nach public/engine kopieren. */
function stockfishAssets(): Plugin {
  return {
    name: "chessy-stockfish-assets",
    buildStart() {
      const bin = join(dirname(require.resolve("stockfish/package.json")), "bin");
      const out = join(here, "public/engine");
      mkdirSync(out, { recursive: true });
      for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
        if (!existsSync(join(out, f))) copyFileSync(join(bin, f), join(out, f));
      }
    },
  };
}

/** GitHub Pages: unbekannte Pfade (z. B. /chessy/game/abc) landen auf 404.html → dieselbe App ausliefern. */
function spaFallback(): Plugin {
  return {
    name: "chessy-spa-fallback",
    apply: "build",
    closeBundle() {
      const dist = join(here, "dist");
      if (existsSync(join(dist, "index.html"))) copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), stockfishAssets(), spaFallback()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", ws: true },
      "/docs": { target: "http://localhost:3000" },
    },
  },
});
