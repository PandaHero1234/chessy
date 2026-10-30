import { getToken } from "./api.ts";

/** Event-Quelle der statischen Demo (der GameService im Browser). */
interface LocalEvents {
  on(event: string, fn: (payload: never) => void): void;
  off(event: string, fn: (payload: never) => void): void;
}

type Listener = (msg: Record<string, unknown> & { type: string }) => void;

/**
 * Eine WebSocket-Verbindung pro Tab. Kanäle: "user", "lobby", "game:<id>".
 * Abonnements werden nach einem Verbindungsabbruch automatisch erneuert.
 */
class LiveConnection {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private games = new Map<string, number>();
  private lobby = 0;
  private retry = 0;
  private pingSent = 0;
  /** Gemessene Round-Trip-Zeit in ms (für Lag-Kompensation). */
  rtt = 0;
  private statusListeners = new Set<(online: boolean) => void>();
  online = false;
  private local: { events: LocalEvents; userId: string } | null = null;

  /** Statische Demo: Events kommen direkt vom GameService im Browser statt per WebSocket. */
  useLocal(events: LocalEvents, userId: string) {
    this.local = { events, userId };
    this.setOnline(true);
  }

  connect() {
    if (this.ws || this.local) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/ws?token=${encodeURIComponent(getToken() ?? "")}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setOnline(true);
      for (const id of this.games.keys()) ws.send(JSON.stringify({ type: "subscribe", game_id: id }));
      if (this.lobby) ws.send(JSON.stringify({ type: "lobby" }));
      this.ping();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "pong") {
        this.rtt = performance.now() - this.pingSent;
        return;
      }
      for (const l of this.listeners.get(msg.channel) ?? []) l(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.setOnline(false);
      setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  /** Nach Token-Wechsel neu verbinden. */
  reconnect() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.connect();
  }

  private ping() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pingSent = performance.now();
    this.ws.send(JSON.stringify({ type: "ping" }));
    setTimeout(() => this.ping(), 10_000);
  }

  private setOnline(v: boolean) {
    this.online = v;
    for (const l of this.statusListeners) l(v);
  }

  onStatus(fn: (online: boolean) => void) {
    this.statusListeners.add(fn);
    return () => void this.statusListeners.delete(fn);
  }

  on(channel: string, fn: Listener) {
    if (this.local) {
      const { events, userId } = this.local;
      const name = channel === "user" ? `user:${userId}` : channel;
      const wrapped = (e: object) => fn({ channel, ...(e as { type: string }) });
      events.on(name, wrapped as (p: never) => void);
      return () => events.off(name, wrapped as (p: never) => void);
    }
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
    this.listeners.get(channel)!.add(fn);
    return () => void this.listeners.get(channel)?.delete(fn);
  }

  subscribeGame(id: string, fn: Listener) {
    if (this.local) return this.on(`game:${id}`, fn);
    const off = this.on(`game:${id}`, fn);
    const n = this.games.get(id) ?? 0;
    this.games.set(id, n + 1);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "subscribe", game_id: id }));
    return () => {
      off();
      const left = (this.games.get(id) ?? 1) - 1;
      if (left <= 0) {
        this.games.delete(id);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "unsubscribe", game_id: id }));
      } else this.games.set(id, left);
    };
  }

  subscribeLobby(fn: Listener) {
    if (this.local) return this.on("lobby", fn);
    const off = this.on("lobby", fn);
    this.lobby++;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "lobby" }));
    return () => {
      off();
      this.lobby--;
    };
  }
}

export const live = new LiveConnection();
