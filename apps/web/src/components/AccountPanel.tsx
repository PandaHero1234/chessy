import { useEffect, useState } from "react";
import type { Account } from "@chessy/shared";
import { api, auth, renameByNewGuest } from "../lib/api.ts";
import { live } from "../lib/live.ts";
import { STATIC } from "../lib/paths.ts";
import { useAccount, useSetAccount, useToast } from "../App.tsx";

const PASSWORD_MIN = 8;

/** Passwortfeld mit Ein-/Ausblenden (am Handy wichtig, weil man sich leicht vertippt). */
function PasswordInput({ id, value, onChange, autoComplete, label }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="pw-row">
        <input
          id={id}
          name={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"} aria-pressed={show}>
          {show ? "🙈" : "👁"}
        </button>
      </span>
    </label>
  );
}

function UsernameInput({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <label className="field" htmlFor="acc-username">
      <span className="field-label">Benutzername</span>
      <input
        id="acc-username"
        name="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={20}
        required
      />
    </label>
  );
}

/**
 * Konto-Bereich der Einstellungen. Login ist optional: Ohne Anmeldung spielt man als Gast weiter.
 * - Gast: Konto anlegen (Fortschritt bleibt) oder mit bestehendem Konto anmelden
 * - Angemeldet: Abmelden (dieses Gerät oder überall), Passwort ändern
 */
export function AccountPanel() {
  const account = useAccount();
  const setAccount = useSetAccount();
  const toast = useToast();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ games: number; puzzles: number } | null>(null);
  const [changePw, setChangePw] = useState(false);

  // Für den Hinweis beim Anmelden: Hat dieser Gast schon etwas, das verloren ginge?
  useEffect(() => {
    if (STATIC || account?.kind !== "guest") return;
    Promise.all([api.myGames(), api.puzzles.stats()]).then(
      ([g, s]) => setProgress({ games: g.length, puzzles: s.attempts }),
      () => undefined,
    );
  }, [account]);

  useEffect(() => {
    setError(null);
    setPassword("");
    setPassword2("");
  }, [mode, account?.kind]);

  const switchTo = (acc: Account, message: string) => {
    setAccount(acc);
    live.reconnect();
    toast(message);
    setUsername("");
    setPassword("");
    setPassword2("");
    setOldPw("");
    setChangePw(false);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;

  // ---------------- Pages-Demo: keine Konten über Geräte hinweg
  if (STATIC) {
    return (
      <section className="glass card account-card" id="account">
        <h2>Konto</h2>
        <p className="muted">
          Du spielst als <b>{account.username}</b>. In dieser Demo bleibt dein Fortschritt in diesem Browser. Anmelden und Konten für mehrere Geräte gibt es mit dem
          Chessy-Server (<code>npm start</code>).
        </p>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => switchTo(await renameByNewGuest(username.trim()), `Willkommen, ${username.trim()}!`));
          }}
        >
          <label className="field" htmlFor="acc-rename">
            <span className="field-label">Anzeigename ändern</span>
            <input id="acc-rename" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3–20 Zeichen" minLength={3} maxLength={20} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary" disabled={busy || username.trim().length < 3}>
            Übernehmen
          </button>
        </form>
      </section>
    );
  }

  // ---------------- Angemeldet
  if (account.kind === "user") {
    return (
      <section className="glass card account-card" id="account">
        <h2>Konto</h2>
        <div className="account-who">
          <span className="account-avatar">{account.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <div>
              Angemeldet als <b>{account.username}</b>
            </div>
            <div className="muted small">Partien und Puzzle-Fortschritt sind auf allen Geräten verfügbar, auf denen du dich anmeldest.</div>
          </div>
        </div>
        <div className="account-actions">
          <button className="btn ghost" disabled={busy} onClick={() => run(async () => switchTo(await auth.logout(false), "Abgemeldet. Du spielst jetzt als Gast."))}>
            Abmelden
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => run(async () => switchTo(await auth.logout(true), "Auf allen Geräten abgemeldet."))}
            title="Beendet die Anmeldung auf allen Geräten, auch auf diesem"
          >
            Überall abmelden
          </button>
          <button className="btn ghost" onClick={() => setChangePw((v) => !v)} aria-expanded={changePw}>
            Passwort ändern
          </button>
        </div>
        {changePw && (
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== password2) return setError("Die neuen Passwörter stimmen nicht überein");
              void run(async () => {
                const r = await auth.changePassword(oldPw, password);
                switchTo(account, r.ended ? `Passwort geändert. ${r.ended} andere ${r.ended === 1 ? "Sitzung wurde" : "Sitzungen wurden"} abgemeldet.` : "Passwort geändert.");
              });
            }}
          >
            <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
            <PasswordInput id="acc-old" label="Bisheriges Passwort" value={oldPw} onChange={setOldPw} autoComplete="current-password" />
            <PasswordInput id="acc-new" label={`Neues Passwort (mind. ${PASSWORD_MIN} Zeichen)`} value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordInput id="acc-new2" label="Neues Passwort wiederholen" value={password2} onChange={setPassword2} autoComplete="new-password" />
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn primary" disabled={busy || password.length < PASSWORD_MIN || !oldPw}>
              Passwort speichern
            </button>
          </form>
        )}
        {!changePw && error && <div className="form-error" role="alert">{error}</div>}
      </section>
    );
  }

  // ---------------- Gast
  const hasProgress = !!progress && progress.games + progress.puzzles > 0;
  return (
    <section className="glass card account-card" id="account">
      <h2>Konto</h2>
      <p className="muted">
        Du spielst als Gast <b>{account.username}</b>. Das reicht zum Spielen. Mit einem Konto kannst du deinen Fortschritt auf anderen Geräten nutzen und verlierst ihn
        nicht, wenn der Browser-Speicher gelöscht wird.
      </p>
      <div className="segmented account-tabs" role="tablist">
        <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Konto anlegen
        </button>
        <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          Anmelden
        </button>
      </div>

      {mode === "register" ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== password2) return setError("Die Passwörter stimmen nicht überein");
            void run(async () => {
              const acc = await auth.register(username.trim(), password);
              switchTo(acc, `Konto angelegt. Willkommen, ${acc.username}!`);
            });
          }}
        >
          <p className="small muted">
            {hasProgress
              ? `Deine ${progress!.games} ${progress!.games === 1 ? "Partie" : "Partien"} und ${progress!.puzzles} gelöste${progress!.puzzles === 1 ? "s Puzzle" : " Puzzles"} bleiben erhalten.`
              : "Alles, was du als Gast gespielt hast, bleibt erhalten."}
          </p>
          <UsernameInput value={username} onChange={setUsername} autoComplete="username" />
          <PasswordInput id="acc-pw" label={`Passwort (mind. ${PASSWORD_MIN} Zeichen)`} value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordInput id="acc-pw2" label="Passwort wiederholen" value={password2} onChange={setPassword2} autoComplete="new-password" />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy || username.trim().length < 3 || password.length < PASSWORD_MIN || !password2}>
            {busy ? "Lege an …" : "Konto anlegen"}
          </button>
        </form>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const acc = await auth.login(username.trim(), password);
              switchTo(acc, `Angemeldet als ${acc.username}.`);
            });
          }}
        >
          {hasProgress && (
            <div className="form-note">
              Du hast als Gast {progress!.games} {progress!.games === 1 ? "Partie" : "Partien"} und {progress!.puzzles} Puzzles gespielt. Beim Anmelden bleibt dieser
              Fortschritt beim Gast-Konto zurück. Willst du ihn behalten, lege stattdessen ein Konto an.
            </div>
          )}
          <UsernameInput value={username} onChange={setUsername} autoComplete="username" />
          <PasswordInput id="acc-login-pw" label="Passwort" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy || !username.trim() || !password}>
            {busy ? "Melde an …" : "Anmelden"}
          </button>
        </form>
      )}
    </section>
  );
}
