import { getSettings } from "./settings.ts";

/** Kleine, synthetische Sounds über WebAudio – keine Audiodateien nötig. */
let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

function blip(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.18, delay = 0) {
  const a = audio();
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + duration);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function knock(gain: number) {
  const a = audio();
  const len = Math.floor(a.sampleRate * 0.06);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

export type SoundName = "move" | "capture" | "check" | "castle" | "start" | "end" | "lowtime" | "illegal";

export function play(name: SoundName) {
  if (!getSettings().sound) return;
  try {
    switch (name) {
      case "move":
        knock(0.9);
        break;
      case "capture":
        knock(1.3);
        blip(220, 0.08, "triangle", 0.08);
        break;
      case "castle":
        knock(0.9);
        setTimeout(() => knock(0.7), 90);
        break;
      case "check":
        knock(1);
        blip(880, 0.12, "sine", 0.08);
        break;
      case "start":
        blip(523, 0.12, "sine", 0.12);
        blip(784, 0.18, "sine", 0.12, 0.1);
        break;
      case "end":
        blip(784, 0.15, "sine", 0.12);
        blip(523, 0.25, "sine", 0.12, 0.14);
        break;
      case "lowtime":
        blip(1200, 0.05, "square", 0.04);
        break;
      case "illegal":
        blip(160, 0.12, "sawtooth", 0.05);
        break;
    }
  } catch {
    /* Audio nicht verfügbar */
  }
}
