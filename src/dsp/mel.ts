import { stft, magnitudes } from "./stft";

// Slaney-style mel scale, as used by librosa and Whisper.
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOGSTEP = Math.log(6.4) / 27;

export function hzToMel(f: number) {
  return f < MIN_LOG_HZ ? f / F_SP : MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP;
}
export function melToHz(m: number) {
  return m < MIN_LOG_MEL ? m * F_SP : MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL));
}

export interface MelBank {
  nMels: number;
  bins: number;
  sr: number;
  nFft: number;
  /** centre/edge frequencies in Hz, length nMels + 2 */
  edges: Float32Array;
  /** triangles with peak 1 (for display and inversion) */
  tri: Float32Array[];
  /** slaney-normalised weights (area-normalised, what Whisper uses) */
  weights: Float32Array[];
}

const bankCache = new Map<string, MelBank>();

export function melBank(sr: number, nFft: number, nMels: number, fmin = 0, fmax = sr / 2): MelBank {
  const key = `${sr}|${nFft}|${nMels}|${fmin}|${fmax}`;
  const hit = bankCache.get(key);
  if (hit) return hit;
  const bins = nFft / 2 + 1;
  const mMin = hzToMel(fmin), mMax = hzToMel(fmax);
  const edges = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) edges[i] = melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1));
  const tri: Float32Array[] = [], weights: Float32Array[] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m], c = edges[m + 1], hi = edges[m + 2];
    const t = new Float32Array(bins), w = new Float32Array(bins);
    const enorm = 2 / (hi - lo);
    for (let k = 0; k < bins; k++) {
      const f = (k * sr) / nFft;
      const v = Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c)));
      t[k] = v;
      w[k] = v * enorm;
    }
    tri.push(t);
    weights.push(w);
  }
  const bank = { nMels, bins, sr, nFft, edges, tri, weights };
  bankCache.set(key, bank);
  return bank;
}

/** Power spectrum frames -> mel power frames. */
export function toMel(power: Float32Array[], bank: MelBank, normalised = true): Float32Array[] {
  const W = normalised ? bank.weights : bank.tri;
  return power.map((p) => {
    const out = new Float32Array(bank.nMels);
    for (let m = 0; m < bank.nMels; m++) {
      const w = W[m];
      let s = 0;
      for (let k = 0; k < p.length; k++) if (w[k]) s += w[k] * p[k];
      out[m] = s;
    }
    return out;
  });
}

/** Approximate inverse: spread each band's (peak-1 triangle) power back across its bins. */
export function fromMel(melPow: Float32Array[], bank: MelBank): Float32Array[] {
  const area = bank.tri.map((t) => t.reduce((a, b) => a + b, 0) || 1);
  return melPow.map((mp) => {
    const out = new Float32Array(bank.bins);
    for (let m = 0; m < bank.nMels; m++) {
      const t = bank.tri[m];
      const v = mp[m] / area[m];
      for (let k = 0; k < bank.bins; k++) if (t[k]) out[k] += t[k] * v;
    }
    return out;
  });
}

export interface LogMel {
  frames: Float32Array[]; // T x nMels, Whisper-scaled (roughly -1..1)
  raw: Float32Array[]; // T x nMels, log10 power before scaling
  sr: number;
  hop: number;
  nFft: number;
  bank: MelBank;
}

/**
 * Whisper's front end, step for step: 400-point Hann window and FFT (25 ms), hop 160 (10 ms),
 * power, Slaney mel filters 0–8 kHz, log10, clamp to 8 below the max (80 dB), then (x + 4) / 4.
 * Whisper drops the last STFT frame, so 30 s gives exactly 3000 frames.
 */
export function whisperLogMel(x16k: Float32Array, nMels = 80): LogMel {
  return logMel(x16k, 16000, nMels, 400, 160);
}

/** The same recipe at any rate / window / hop, for the pipeline settings. */
export function logMel(x: Float32Array, sr: number, nMels: number, win: number, hop: number): LogMel {
  // exact-length DFT for short windows (Whisper's 400); zero-pad long ones to a power of two for speed
  const nFft = win <= 512 ? win : 2 ** Math.ceil(Math.log2(win));
  const s = stft(x, sr, nFft, hop, win);
  const power = magnitudes(s).slice(0, -1).map((m) => m.map((v) => v * v));
  const bank = melBank(sr, nFft, nMels, 0, sr / 2);
  const mel = toMel(power, bank, true);
  const raw = mel.map((f) => f.map((v) => Math.log10(Math.max(v, 1e-10))));
  let max = -Infinity;
  for (const f of raw) for (const v of f) if (v > max) max = v;
  const frames = raw.map((f) => f.map((v) => (Math.max(v, max - 8) + 4) / 4));
  return { frames, raw, sr, hop, nFft, bank };
}
