import { BOARD_THEMES, type BoardTheme, updateSettings, useSettings } from "../lib/settings.ts";
import { AccountPanel } from "../components/AccountPanel.tsx";

export function SettingsPage() {
  const s = useSettings();

  const toggle = (key: "sound" | "coordinates" | "legalMoves" | "animation" | "autoQueen" | "autoNext" | "haptics", label: string) => (
    <label className="toggle">
      <input type="checkbox" checked={s[key]} onChange={(e) => updateSettings({ [key]: e.target.checked })} />
      <span className="toggle-track" />
      {label}
    </label>
  );

  return (
    <div className="page narrow">
      <AccountPanel />
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
          {toggle("haptics", "Vibration bei Puzzle-Feedback (nur Android)")}
          {toggle("autoNext", "Puzzles: nach dem Lösen automatisch weiter")}
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

    </div>
  );
}
