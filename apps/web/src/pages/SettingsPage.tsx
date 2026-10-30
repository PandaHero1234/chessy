import { useState } from "react";
import { BOARD_THEMES, type BoardTheme, updateSettings, useSettings } from "../lib/settings.ts";
import { renameByNewGuest } from "../lib/api.ts";
import { live } from "../lib/live.ts";
import { useAccount, useSetAccount, useToast } from "../App.tsx";

export function SettingsPage() {
  const s = useSettings();
  const account = useAccount();
  const setAccount = useSetAccount();
  const toast = useToast();
  const [name, setName] = useState("");

  const toggle = (key: "sound" | "coordinates" | "legalMoves" | "animation" | "autoQueen", label: string) => (
    <label className="toggle">
      <input type="checkbox" checked={s[key]} onChange={(e) => updateSettings({ [key]: e.target.checked })} />
      <span className="toggle-track" />
      {label}
    </label>
  );

  return (
    <div className="page narrow">
      <section className="glass card">
        <h2>Brett</h2>
        <div className="theme-grid">
          {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((k) => {
            const t = BOARD_THEMES[k];
            return (
              <button key={k} className={`theme-swatch ${s.boardTheme === k ? "active" : ""}`} onClick={() => updateSettings({ boardTheme: k })}>
                <span className="swatch" style={{ background: `conic-gradient(${t.dark} 0 25%, ${t.light} 0 50%, ${t.dark} 0 75%, ${t.light} 0)` }} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="toggles">
          {toggle("coordinates", "Koordinaten anzeigen")}
          {toggle("legalMoves", "Legale Züge markieren")}
          {toggle("animation", "Figuren animieren")}
          {toggle("autoQueen", "Automatisch zur Dame umwandeln")}
          {toggle("sound", "Sounds")}
        </div>
      </section>
      <section className="glass card">
        <h2>Darstellung</h2>
        <div className="segmented">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} className={s.appTheme === t ? "active" : ""} onClick={() => updateSettings({ appTheme: t })}>
              {t === "dark" ? "🌙 Dunkel" : t === "light" ? "☀️ Hell" : "🖥 System"}
            </button>
          ))}
        </div>
      </section>
      <section className="glass card">
        <h2>Account</h2>
        <p className="muted">
          Du spielst als <b>{account?.username}</b> (Gast). Für einen neuen Namen wird ein neuer Gast-Account angelegt.
        </p>
        <form
          className="search-row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const acc = await renameByNewGuest(name.trim());
              setAccount(acc);
              live.reconnect();
              toast(`Willkommen, ${acc.username}!`);
              setName("");
            } catch (err) {
              toast((err as Error).message);
            }
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neuer Name (3–20 Zeichen)" minLength={3} maxLength={20} />
          <button className="btn primary">Übernehmen</button>
        </form>
      </section>
    </div>
  );
}
