import type { AccountEvent, GameSnapshot, GameStreamEvent, TimeControl } from "@chessy/shared";

/** Schlanker Node/Browser-Client für die Chessy-API (REST + NDJSON-Streams). */
export class ChessyClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
    return data as T;
  }

  account() {
    return this.req<{ id: string; username: string }>("GET", "/account");
  }
  createAiGame(level: number, timeControl: string | TimeControl, color: "white" | "black" | "random" = "random") {
    return this.req<GameSnapshot>("POST", "/games", { opponent: { type: "ai", level }, time_control: timeControl, color });
  }
  seek(timeControl: string | TimeControl) {
    return this.req<{ seek?: { id: string }; game?: GameSnapshot }>("POST", "/seeks", { time_control: timeControl });
  }
  move(gameId: string, move: string) {
    return this.req<GameSnapshot>("POST", `/games/${gameId}/move/${encodeURIComponent(move)}`);
  }
  resign(gameId: string) {
    return this.req<GameSnapshot>("POST", `/games/${gameId}/resign`);
  }

  streamEvents(signal?: AbortSignal): AsyncGenerator<AccountEvent> {
    return this.ndjson<AccountEvent>("/stream/events", signal);
  }
  streamGame(gameId: string, signal?: AbortSignal): AsyncGenerator<GameStreamEvent> {
    return this.ndjson<GameStreamEvent>(`/games/${gameId}/stream`, signal);
  }

  private async *ndjson<T>(path: string, signal?: AbortSignal): AsyncGenerator<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${this.token}` }, signal });
    if (!res.ok || !res.body) throw new Error(`Stream ${path}: HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
  }
}
