import { rng, gaussian } from "../dsp/rand";

export const SPEC_SR = 48000;

export interface Specimen {
  id: string;
  name: string;
  note: string;
  make: () => Float32Array[]; // [left, right]
}

const secs = (s: number) => Math.floor(s * SPEC_SR);

/** Two-pole resonator, the classic formant filter. */
function resonator(x: Float32Array, f: number | ((i: number) => number), bw: number) {
  const y = new Float32Array(x.length);
  let y1 = 0, y2 = 0;
  const r = Math.exp((-Math.PI * bw) / SPEC_SR);
  for (let i = 0; i < x.length; i++) {
    const fc = typeof f === "number" ? f : f(i);
    const c = 2 * r * Math.cos((2 * Math.PI * fc) / SPEC_SR);
    const v = (1 - r) * x[i] + c * y1 - r * r * y2;
    y[i] = v; y2 = y1; y1 = v;
  }
  return y;
}

function finish(l: Float32Array, r = l, peak = 0.8): Float32Array[] {
  let m = 0;
  for (let i = 0; i < l.length; i++) m = Math.max(m, Math.abs(l[i]), Math.abs(r[i]));
  const g = m > 0 ? peak / m : 1;
  const L = l.map((v) => v * g);
  return [L, r === l ? L : r.map((v) => v * g)];
}

/** "ah — ee — oo": a glottal buzz shaped by three moving formants. Speech without words. */
function vowels(): Float32Array[] {
  const n = secs(3.2);
  const rand = rng(4);
  const src = new Float32Array(n);
  let phase = 0;
  const targets = [
    [730, 1090, 2440], // a
    [270, 2290, 3010], // i
    [300, 870, 2240], // u
  ];
  const seg = n / 3;
  const formant = (j: number) => (i: number) => {
    const a = Math.min(2, Math.floor(i / seg));
    const u = (i - a * seg) / seg;
    const prev = targets[Math.max(0, a - 1)][j], cur = targets[a][j];
    return prev + (cur - prev) * Math.min(1, u / 0.15);
  };
  for (let i = 0; i < n; i++) {
    const t = i / SPEC_SR;
    const f0 = 118 + 22 * Math.sin(t * 1.9) + 3 * Math.sin(t * 31);
    phase += f0 / SPEC_SR;
    if (phase >= 1) phase -= 1;
    const pulse = phase < 0.4 ? Math.sin((Math.PI * phase) / 0.4) ** 2 : 0; // Rosenberg-ish glottal pulse
    const syl = (i % seg) / seg;
    const amp = Math.min(1, syl * 12) * Math.min(1, (1 - syl) * 8);
    src[i] = (pulse - 0.2) * amp + 0.02 * gaussian(rand) * amp;
  }
  const f1 = resonator(src, formant(0), 90);
  const f2 = resonator(src, formant(1), 110);
  const f3 = resonator(src, formant(2), 160);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f1[i] + 0.6 * f2[i] + 0.35 * f3[i];
  return finish(out);
}

/** A struck C-major chord: four notes, each with a dozen decaying harmonics. */
function chord(): Float32Array[] {
  const n = secs(3.4);
  const l = new Float32Array(n), r = new Float32Array(n);
  const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
  notes.forEach((f, ni) => {
    const start = secs(ni * 0.12);
    const pan = 0.2 + 0.6 * (ni / (notes.length - 1));
    for (let h = 1; h <= 14; h++) {
      const fh = f * h * (1 + 0.0004 * h * h); // slight inharmonicity, like a real string
      if (fh > 20000) break;
      const a = 0.5 / h ** 1.1;
      const decay = 1.6 / (1 + h * 0.35);
      for (let i = start; i < n; i++) {
        const t = (i - start) / SPEC_SR;
        const v = a * Math.sin(2 * Math.PI * fh * t) * Math.exp(-t / decay) * Math.min(1, t * 400);
        l[i] += v * (1 - pan);
        r[i] += v * pan;
      }
    }
  });
  return finish(l, r);
}

/** Fast chirps sweeping 4–11 kHz. Most of this lives above what speech models keep. */
function birdsong(): Float32Array[] {
  const n = secs(3);
  const l = new Float32Array(n), r = new Float32Array(n);
  const rand = rng(9);
  let t0 = 0.05;
  while (t0 < 2.8) {
    const dur = 0.04 + rand() * 0.09;
    const f1 = 4000 + rand() * 4000, f2 = 6500 + rand() * 5000;
    const pan = rand();
    const start = secs(t0), len = secs(dur);
    let ph = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const u = i / len;
      const f = f1 + (f2 - f1) * u + 400 * Math.sin(u * 40);
      ph += (2 * Math.PI * f) / SPEC_SR;
      const v = Math.sin(ph) * Math.sin(Math.PI * u) ** 2 * 0.6;
      l[start + i] += v * (1 - pan);
      r[start + i] += v * pan;
    }
    t0 += dur + (rand() < 0.3 ? 0.25 : 0.03 + rand() * 0.05);
  }
  return finish(l, r);
}

/** Kick, snare and hats at 120 bpm. All about attacks a few milliseconds long. */
function drums(): Float32Array[] {
  const n = secs(3);
  const l = new Float32Array(n), r = new Float32Array(n);
  const rand = rng(21);
  const beat = 0.25;
  const hit = (t: number, fn: (i: number) => number, len: number, pan = 0.5) => {
    const s = secs(t), L = secs(len);
    for (let i = 0; i < L && s + i < n; i++) { const v = fn(i); l[s + i] += v * (1 - pan); r[s + i] += v * pan; }
  };
  for (let b = 0; b < 12; b++) {
    const t = 0.05 + b * beat;
    if (b % 4 === 0 || b === 10) {
      let ph = 0;
      hit(t, (i) => { const u = i / SPEC_SR; ph += (2 * Math.PI * (45 + 110 * Math.exp(-u * 30))) / SPEC_SR; return Math.sin(ph) * Math.exp(-u * 9); }, 0.4);
    }
    if (b % 4 === 2) {
      hit(t, (i) => { const u = i / SPEC_SR; return (0.6 * gaussian(rand) * Math.exp(-u * 22) + 0.5 * Math.sin(2 * Math.PI * 185 * u) * Math.exp(-u * 30)); }, 0.3);
    }
    let prev = 0;
    hit(t, (i) => { const u = i / SPEC_SR; const w = gaussian(rand); const hp = w - prev; prev = w; return 0.25 * hp * Math.exp(-u * 60); }, 0.08, 0.7);
    prev = 0;
    hit(t + 0.125, (i) => { const u = i / SPEC_SR; const w = gaussian(rand); const hp = w - prev; prev = w; return 0.15 * hp * Math.exp(-u * 80); }, 0.06, 0.3);
  }
  return finish(l, r);
}

/** Rain on a roof: wide decorrelated noise plus scattered droplets, different in each ear. */
function rain(): Float32Array[] {
  const n = secs(3);
  const rand = rng(33);
  const chan = (seed: number) => {
    const rr = rng(seed);
    const x = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = gaussian(rr);
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.05;
    }
    return x;
  };
  const l = chan(1), r = chan(2);
  for (let d = 0; d < 260; d++) {
    const s = Math.floor(rand() * (n - 2000));
    const f = 2000 + rand() * 6000, pan = rand(), a = 0.2 + rand() * 0.5;
    for (let i = 0; i < 1200; i++) {
      const u = i / SPEC_SR;
      const v = a * Math.sin(2 * Math.PI * f * u * (1 + u * 30)) * Math.exp(-u * 600);
      l[s + i] += v * (1 - pan); r[s + i] += v * pan;
    }
  }
  return finish(l, r, 0.7);
}

/** A marimba-like note bouncing hard left, hard right. Pure space. */
function pingpong(): Float32Array[] {
  const n = secs(3);
  const l = new Float32Array(n), r = new Float32Array(n);
  const notes = [440, 554.37, 659.25, 880, 659.25, 554.37];
  for (let k = 0; k < 12; k++) {
    const s = secs(0.05 + k * 0.24);
    const f = notes[k % notes.length];
    const target = k % 2 ? r : l;
    for (let i = 0; i < secs(0.5) && s + i < n; i++) {
      const u = i / SPEC_SR;
      target[s + i] += (Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(2 * Math.PI * f * 4 * u) * Math.exp(-u * 30)) * Math.exp(-u * 7) * 0.6;
    }
  }
  return finish(l, r);
}

/** Logarithmic sweep from 30 Hz to 22 kHz: a ruler for everything else. */
function sweep(): Float32Array[] {
  const n = secs(4);
  const x = new Float32Array(n);
  const f0 = 30, f1 = 22000, T = n / SPEC_SR;
  const k = Math.log(f1 / f0);
  for (let i = 0; i < n; i++) {
    const t = i / SPEC_SR;
    const ph = (2 * Math.PI * f0 * T * (Math.exp((t / T) * k) - 1)) / k;
    x[i] = 0.5 * Math.sin(ph) * Math.min(1, t * 20, (T - t) * 20);
  }
  return finish(x);
}

export const SPECIMENS: Specimen[] = [
  { id: "voice", name: "Vowels", note: "ah · ee · oo — a synthetic voice", make: vowels },
  { id: "chord", name: "Piano chord", note: "five notes, rich harmonics", make: chord },
  { id: "birds", name: "Birdsong", note: "chirps from 4 to 11 kHz", make: birdsong },
  { id: "drums", name: "Drum loop", note: "sharp attacks, 120 bpm", make: drums },
  { id: "rain", name: "Rain", note: "wide stereo texture", make: rain },
  { id: "pingpong", name: "Ping-pong", note: "hard left · hard right", make: pingpong },
  { id: "sweep", name: "Sweep", note: "30 Hz → 22 kHz", make: sweep },
];
