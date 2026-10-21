import { bus } from "./bus";
import { S, screenBg, screenText } from "./screen";
import type { Draw } from "./screen";

/** Waveform polyline helper for screens. */
export function trace(g: CanvasRenderingContext2D, x: ArrayLike<number>, bx: number, by: number, bw: number, bh: number, color: string, lw: number, gain = 1) {
  const n = x.length;
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.beginPath();
  if (n > bw * 2) {
    for (let px = 0; px < bw; px++) {
      const a = Math.floor((px / bw) * n), b = Math.floor(((px + 1) / bw) * n);
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < Math.max(a + 1, b); i++) { const v = x[i] ?? 0; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      g.moveTo(bx + px, by + bh / 2 - hi * gain * (bh / 2));
      g.lineTo(bx + px, by + bh / 2 - lo * gain * (bh / 2) + 1);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const px = bx + (i / Math.max(1, n - 1)) * bw, py = by + bh / 2 - (x[i] ?? 0) * gain * (bh / 2);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
  }
  g.stroke();
}

const title = (g: CanvasRenderingContext2D, w: number, h: number, text: string, right?: string) => {
  const u = h / 100;
  screenText(g, text.toUpperCase(), 5 * u, 11 * u, 7.5 * u, S.dim);
  if (right) screenText(g, right, w - 5 * u, 11 * u, 7.5 * u, S.teal, "right", true);
};

const gainFor = (x: Float32Array) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m > 0.02 ? Math.min(6, 0.8 / m) : 1; };

export const DEFAULTS: Record<string, Draw> = {
  source: (g, w, h) => {
    screenBg(g, w, h);
    title(g, w, h, "Air pressure", bus.live ? "live" : "");
    const u = h / 100;
    trace(g, bus.time.subarray(bus.time.length - 1400), 5 * u, 18 * u, w - 10 * u, 76 * u, S.teal, 0.8 * u, gainFor(bus.time));
  },
  mic: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Voltage", `${(20 * Math.log10(Math.max(bus.level, 1e-4) * 0.5)).toFixed(0)} dB`);
    trace(g, bus.time.subarray(bus.time.length - 900), 5 * u, 18 * u, w - 22 * u, 76 * u, S.ink, 0.9 * u, gainFor(bus.time));
    const lv = Math.min(1, bus.level * 1.4);
    g.fillStyle = "#2c3a5e"; g.fillRect(w - 12 * u, 18 * u, 6 * u, 76 * u);
    g.fillStyle = lv > 0.85 ? S.red : S.teal; g.fillRect(w - 12 * u, 18 * u + 76 * u * (1 - lv), 6 * u, 76 * u * lv);
  },
  adc: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Samples", `${(bus.sr / 1000).toFixed(1)} kHz`);
    const n = 48, step = 6;
    const x = bus.time, gain = gainFor(x);
    const x0 = 6 * u, ww = w - 12 * u, mid = 58 * u, amp = 34 * u;
    g.strokeStyle = S.grid; g.lineWidth = 0.5 * u; g.beginPath(); g.moveTo(x0, mid); g.lineTo(x0 + ww, mid); g.stroke();
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, (x[x.length - (n - i) * step] ?? 0) * gain));
      const px = x0 + (i / (n - 1)) * ww, py = mid - v * amp;
      g.strokeStyle = S.dim; g.lineWidth = 0.4 * u; g.beginPath(); g.moveTo(px, mid); g.lineTo(px, py); g.stroke();
      g.fillStyle = S.orange; g.beginPath(); g.arc(px, py, 1.4 * u, 0, 7); g.fill();
    }
  },
  fft: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "One 21 ms frame × window");
    const n = 1024, x = bus.time.subarray(bus.time.length - n), gain = gainFor(x);
    const win = Float32Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
    trace(g, x, 5 * u, 18 * u, w - 10 * u, 76 * u, "#4a5880", 0.6 * u, gain);
    trace(g, win, 5 * u, 18 * u, w - 10 * u, 76 * u, S.teal, 0.8 * u, gain);
  },
  mel: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Mel bands", bus.mel ? `${bus.mel[0].length} bands` : "");
    const m = bus.mel;
    if (!m) return;
    const F = m[0].length, T = m.length;
    const t = bus.head >= 0 ? Math.min(T - 1, Math.floor(bus.head * T)) : Math.floor(T / 2);
    const bw = (w - 10 * u) / F;
    for (let f = 0; f < F; f++) {
      const v = Math.max(0, Math.min(1, m[t][f]));
      g.fillStyle = v > 0.8 ? S.orange : S.teal;
      g.fillRect(5 * u + f * bw, 94 * u - v * 74 * u, Math.max(1, bw - 0.6 * u), v * 74 * u);
    }
  },
  encoder: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Encoder output");
    const im = bus.enc[bus.enc.length - 1];
    if (im) { g.imageSmoothingEnabled = false; g.drawImage(im, 5 * u, 18 * u, w - 10 * u, 76 * u); }
  },
  tokens: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Codes, frame by frame");
    const c = bus.codes;
    if (!c) return;
    const T = c[0].length;
    const t = bus.head >= 0 ? Math.min(T - 1, Math.floor(bus.head * T)) : 0;
    g.font = S.mono(9 * u); g.textAlign = "left";
    for (let r = 0; r < Math.min(8, c.length); r++) {
      g.fillStyle = r === 0 ? S.orange : S.ink;
      g.fillText(c[r].slice(t, t + 8).map((v) => String(v).padStart(4)).join(""), 5 * u, (26 + r * 9.2) * u);
    }
  },
  projector: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Into the LM");
    screenText(g, "audio frames → LM tokens", 5 * u, 40 * u, 10 * u, S.ink);
    screenText(g, "50 / s → 25 / s", 5 * u, 64 * u, 14 * u, S.teal, "left", true);
  },
  lm: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Layers");
    for (let i = 0; i < 8; i++) {
      const on = (bus.glow.get("lm") ?? 0) > 0 && Math.floor(performance.now() / 160) % 8 === i;
      g.fillStyle = on ? S.orange : "#33426a";
      g.fillRect(8 * u, (88 - i * 9) * u, w - 16 * u, 7 * u);
    }
  },
  head: (g, w, h) => {
    screenBg(g, w, h);
    const u = h / 100;
    title(g, w, h, "Output");
    screenText(g, "waiting for audio…", 6 * u, 50 * u, 10 * u, S.dim);
  },
};
