import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Account } from "@chessy/shared";
import { ApiError, type GameService } from "./game/service.ts";
import type { Store, StoredUser } from "./db/store.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** scrypt-Parameter (OWASP-Empfehlung: N=2^17 ist das Ziel, 2^15 ein guter Kompromiss für kleine Server). */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split("$");
  if (algo !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Damit unbekannte Benutzernamen genauso lange brauchen wie falsche Passwörter. */
let dummyHash: Promise<string> | null = null;

const RESERVED = /^(gast|guest|bot|board|system|admin|stockfish)([-_]|$)/i;
export const PASSWORD_MIN = 8;

export function validateUsername(name: string): string {
  const n = name.trim();
  if (n.length < 3 || n.length > 20) throw new ApiError(400, "invalid_username", "Der Benutzername muss 3 bis 20 Zeichen lang sein");
  if (!/^[\p{L}\p{N}_-]+$/u.test(n)) throw new ApiError(400, "invalid_username", "Erlaubt sind Buchstaben, Ziffern, - und _");
  if (RESERVED.test(n)) throw new ApiError(400, "invalid_username", "Dieser Name ist reserviert, bitte wähle einen anderen");
  return n;
}

export function validatePassword(pw: string) {
  if (pw.length < PASSWORD_MIN) throw new ApiError(400, "weak_password", `Das Passwort muss mindestens ${PASSWORD_MIN} Zeichen lang sein`);
  if (pw.length > 200) throw new ApiError(400, "weak_password", "Das Passwort ist zu lang (höchstens 200 Zeichen)");
}

/** Begrenzt fehlgeschlagene Anmeldungen je Benutzername+IP und je IP. */
class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly perKey: number,
    private readonly perIp: number,
    private readonly now: () => number,
  ) {}

  private recent(key: string) {
    const t = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((x) => x > t);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  check(ip: string, username: string) {
    const k = `${ip}|${username.toLowerCase()}`;
    const a = this.recent(k);
    const b = this.recent(ip);
    if (a.length >= this.perKey || b.length >= this.perIp) {
      const oldest = Math.min(...(a.length >= this.perKey ? a : b));
      const min = Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 60_000));
      throw new ApiError(429, "too_many_attempts", `Zu viele Fehlversuche. Bitte in ${min} ${min === 1 ? "Minute" : "Minuten"} erneut versuchen.`);
    }
  }

  fail(ip: string, username: string) {
    const t = this.now();
    for (const k of [`${ip}|${username.toLowerCase()}`, ip]) this.hits.set(k, [...this.recent(k), t]);
  }

  clear(ip: string, username: string) {
    this.hits.delete(`${ip}|${username.toLowerCase()}`);
  }
}

const newToken = () => `chy_${randomBytes(24).toString("base64url")}`;
export const toAccount = (u: StoredUser): Account => ({ id: u.id, username: u.username, kind: u.kind, created_at: u.created_at });

/**
 * Optionales Login. Ohne Anmeldung spielt man als Gast (Token nur auf diesem Gerät).
 * - Registrieren macht aus dem aktuellen Gast ein Konto: Partien, Puzzle-Rating und Verlauf bleiben erhalten.
 * - Anmelden auf einem anderen Gerät erzeugt dort eine eigene Sitzung.
 * - Abmelden beendet nur die Sitzung dieses Geräts (oder auf Wunsch alle).
 */
export class AuthService {
  private limiter: FailureLimiter;

  constructor(
    private readonly store: Store,
    private readonly games: GameService,
    now: () => number = Date.now,
  ) {
    this.limiter = new FailureLimiter(15 * 60_000, 10, 50, now);
  }

  async register(current: StoredUser | undefined, username: string, password: string): Promise<{ account: Account; token: string }> {
    const name = validateUsername(username);
    validatePassword(password);
    if (current && current.kind === "user") throw new ApiError(409, "already_registered", "Du bist bereits angemeldet");
    if (current && current.kind !== "guest") throw new ApiError(403, "not_allowed", "Bot- und Board-Zugänge können kein Konto anlegen");
    const taken = this.store.credentialsByUsername(name);
    if (taken && taken.user.id !== current?.id) throw new ApiError(409, "username_taken", "Dieser Benutzername ist schon vergeben");

    const hash = await hashPassword(password);
    // Ohne Gast-Konto (z. B. per API) wird zuerst eines angelegt; danach immer derselbe Weg.
    const guest = current ?? this.games.createAccount("guest");
    this.store.upgradeToUser(guest.id, name, hash, newToken());
    this.games.renamePlayer(guest.id, name);
    const token = newToken();
    this.store.createSession(guest.id, token);
    return { account: toAccount(this.store.userById(guest.id)!), token };
  }

  async login(username: string, password: string, ip: string): Promise<{ account: Account; token: string }> {
    const name = username.trim();
    this.limiter.check(ip, name);
    const cred = this.store.credentialsByUsername(name);
    const ok = cred?.passwordHash ? await verifyPassword(password, cred.passwordHash) : (await verifyPassword(password, await (dummyHash ??= hashPassword("x".repeat(12)))), false);
    if (!cred || !ok || cred.user.kind !== "user") {
      this.limiter.fail(ip, name);
      throw new ApiError(401, "invalid_credentials", "Benutzername oder Passwort ist falsch");
    }
    this.limiter.clear(ip, name);
    const token = newToken();
    this.store.createSession(cred.user.id, token);
    return { account: toAccount(cred.user), token };
  }

  /** Beendet die Sitzung dieses Tokens, mit `everywhere` alle Sitzungen des Kontos. */
  logout(user: StoredUser, token: string, everywhere = false): { ended: number } {
    if (user.kind !== "user") throw new ApiError(409, "not_logged_in", "Gäste können sich nicht abmelden");
    if (everywhere) return { ended: this.store.deleteSessionsOf(user.id) };
    return { ended: this.store.deleteSession(token) ? 1 : 0 };
  }

  /** Neues Passwort; alle anderen Sitzungen werden beendet, diese bleibt angemeldet. */
  async changePassword(user: StoredUser, token: string, oldPassword: string, newPassword: string): Promise<{ ended: number }> {
    if (user.kind !== "user") throw new ApiError(409, "not_logged_in", "Nur angemeldete Konten haben ein Passwort");
    const stored = this.store.passwordHashOf(user.id);
    if (!stored || !(await verifyPassword(oldPassword, stored))) throw new ApiError(403, "wrong_password", "Das bisherige Passwort stimmt nicht");
    validatePassword(newPassword);
    this.store.setPasswordHash(user.id, await hashPassword(newPassword));
    return { ended: this.store.deleteSessionsOf(user.id, token) };
  }
}
