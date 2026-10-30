import { useEffect, useRef, useState } from "react";
import type { ClockSnapshot, Color } from "@chessy/shared";
import { play } from "../lib/sound.ts";

export function formatClock(ms: number, perMove?: number): string {
  if (perMove) {
    const h = Math.floor(ms / 3_600_000);
    if (h >= 24) return `${Math.floor(h / 24)} T ${h % 24} h`;
    if (h >= 1) return `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`;
  }
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  if (total < 10_000) return `${m}:${String(s).padStart(2, "0")}.${Math.floor((total % 1000) / 100)}`;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Zeigt die Restzeit an und zählt lokal herunter (Server bleibt maßgeblich). */
export function ClockView({ clock, color, turn, active, receivedAt }: { clock: ClockSnapshot; color: Color; turn: Color; active: boolean; receivedAt: number }) {
  const ticking = active && clock.running && turn === color;
  const [now, setNow] = useState(performance.now());
  const warned = useRef(false);
  useEffect(() => {
    if (!ticking) return;
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ticking]);
  const ms = ticking ? clock[color] - (now - receivedAt) : clock[color];
  const low = !clock.per_move && ms < Math.min(20_000, (clock.white + clock.black) / 20 + 10_000) && ms < 30_000;
  useEffect(() => {
    if (ticking && low && !warned.current) {
      warned.current = true;
      play("lowtime");
    }
    if (!low) warned.current = false;
  }, [ticking, low]);
  return (
    <div className={`clock ${ticking ? "ticking" : ""} ${low ? "low" : ""}`} aria-label={`Restzeit ${color === "white" ? "Weiß" : "Schwarz"}`}>
      {formatClock(ms, clock.per_move)}
    </div>
  );
}
