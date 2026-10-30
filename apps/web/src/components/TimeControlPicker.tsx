import { useState } from "react";
import { TIME_CONTROL_PRESETS, type TimeClass, formatTimeControl } from "@chessy/shared";

const CLASSES: { id: TimeClass; label: string; icon: string; hint: string }[] = [
  { id: "bullet", label: "Bullet", icon: "⚡", hint: "< 3 min" },
  { id: "blitz", label: "Blitz", icon: "🔥", hint: "3–8 min" },
  { id: "rapid", label: "Schnell", icon: "⏱", hint: "8–25 min" },
  { id: "classical", label: "Klassisch", icon: "🏛", hint: "> 25 min" },
  { id: "daily", label: "Daily", icon: "☀", hint: "Tage pro Zug" },
  { id: "unlimited", label: "Frei", icon: "∞", hint: "ohne Uhr" },
];

const MINUTE_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 45, 60, 90, 120, 180];

export function TimeControlPicker({ value, onChange, allowDaily = true }: { value: string; onChange: (tc: string) => void; allowDaily?: boolean }) {
  const [custom, setCustom] = useState(false);
  const [minIdx, setMinIdx] = useState(8);
  const [inc, setInc] = useState(3);
  const classes = CLASSES.filter((c) => allowDaily || (c.id !== "daily" && c.id !== "unlimited"));

  const applyCustom = (mi: number, i: number) => {
    setMinIdx(mi);
    setInc(i);
    onChange(`${Math.round(MINUTE_STEPS[mi]! * 60)}+${i}`);
  };

  return (
    <div className="tc-picker">
      {classes.map((c) => (
        <div className="tc-group" key={c.id}>
          <div className="tc-group-label">
            <span className="tc-icon">{c.icon}</span> {c.label} <span className="muted small">{c.hint}</span>
          </div>
          <div className="tc-chips">
            {TIME_CONTROL_PRESETS[c.id].map((p) => {
              const id = formatTimeControl(p.timeControl);
              return (
                <button
                  key={id}
                  className={`chip ${!custom && value === id ? "active" : ""}`}
                  onClick={() => {
                    setCustom(false);
                    onChange(id);
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="tc-group">
        <button
          className={`chip wide ${custom ? "active" : ""}`}
          onClick={() => {
            setCustom(true);
            applyCustom(minIdx, inc);
          }}
        >
          ✎ Eigener Zeitmodus
        </button>
        {custom && (
          <div className="tc-custom">
            <label>
              Minuten pro Spieler: <b>{MINUTE_STEPS[minIdx]! < 1 ? `${MINUTE_STEPS[minIdx]! * 60} s` : MINUTE_STEPS[minIdx]}</b>
              <input type="range" min={0} max={MINUTE_STEPS.length - 1} value={minIdx} onChange={(e) => applyCustom(Number(e.target.value), inc)} />
            </label>
            <label>
              Inkrement in Sekunden: <b>{inc}</b>
              <input type="range" min={0} max={60} value={inc} onChange={(e) => applyCustom(minIdx, Number(e.target.value))} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
