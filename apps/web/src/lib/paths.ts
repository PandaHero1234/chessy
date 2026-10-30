/** Basis-Pfad der App ("/" oder z. B. "/chessy/" auf GitHub Pages). */
export const BASE = import.meta.env.BASE_URL;

/** Statische Demo ohne Server: Spiellogik und Stockfish laufen im Browser. */
export const STATIC = import.meta.env.VITE_STATIC === "1";

/** App-interner Pfad ("/lobby") → URL mit Basis ("/chessy/lobby"). */
export const href = (path: string) => BASE.replace(/\/$/, "") + path;

/** URL → App-interner Pfad. */
export function stripBase(pathname: string) {
  const base = BASE.replace(/\/$/, "");
  return base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
}

export const pieceUrl = (code: string) => `${BASE}pieces/cburnett/${code}.svg`;
