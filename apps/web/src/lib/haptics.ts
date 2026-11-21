import { getSettings } from "./settings.ts";

/** Kurze Vibration als Rückmeldung. iOS-Browser unterstützen das nicht; dort passiert nichts. */
export function haptic(kind: "good" | "bad" | "tap") {
  if (!getSettings().haptics) return;
  try {
    navigator.vibrate?.(kind === "good" ? [18, 40, 18] : kind === "bad" ? 70 : 10);
  } catch {
    /* nicht verfügbar */
  }
}
