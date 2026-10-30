import { ApiError } from "../game/service.ts";

/**
 * Schlanker Client für die chess.com Published-Data API (https://www.chess.com/news/view/published-data-api).
 * Nur lesend. Antworten werden zwischengespeichert, Anfragen seriell abgearbeitet (chess.com erlaubt
 * parallele Anfragen nur eingeschränkt) und mit aussagekräftigem User-Agent gesendet.
 */
export class ChessComClient {
  private cache = new Map<string, { at: number; data: unknown }>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.chess.com/pub",
    private readonly ttlMs = 10 * 60_000,
    private readonly userAgent = "chessy/0.1 (+https://github.com/PandaHero1234/chessy)",
  ) {}

  player(username: string) {
    return this.get(`/player/${encodeUsername(username)}`);
  }

  stats(username: string) {
    return this.get(`/player/${encodeUsername(username)}/stats`);
  }

  archives(username: string) {
    return this.get(`/player/${encodeUsername(username)}/games/archives`);
  }

  monthlyGames(username: string, year: string, month: string) {
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) throw new ApiError(400, "invalid_date", "Jahr/Monat ungültig");
    return this.get(`/player/${encodeUsername(username)}/games/${year}/${month}`);
  }

  private get(path: string): Promise<unknown> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < this.ttlMs) return Promise.resolve(hit.data);
    const run = async () => {
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseUrl + path, { headers: { "User-Agent": this.userAgent, Accept: "application/json" } });
      } catch {
        throw new ApiError(502, "chesscom_unreachable", "chess.com ist nicht erreichbar");
      }
      if (res.status === 404) throw new ApiError(404, "chesscom_not_found", "Bei chess.com nicht gefunden");
      if (res.status === 429) throw new ApiError(429, "chesscom_rate_limited", "chess.com drosselt Anfragen, bitte kurz warten");
      if (!res.ok) throw new ApiError(502, "chesscom_error", `chess.com antwortete mit ${res.status}`);
      const data = await res.json();
      this.cache.set(path, { at: Date.now(), data });
      return data;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }
}

function encodeUsername(u: string) {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(u)) throw new ApiError(400, "invalid_username", "Ungültiger chess.com-Benutzername");
  return u.toLowerCase();
}
