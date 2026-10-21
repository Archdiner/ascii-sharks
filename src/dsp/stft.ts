import { fft, ifft, hann, rdft, isPow2 } from "./fft";
import { rng } from "./rand";

/** Short-time Fourier transform. Frames are centred (reflect-free zero padding of n/2). */
export interface Spec {
  nFft: number;
  win: number;
  hop: number;
  sr: number;
  re: Float32Array[];
  im: Float32Array[];
}

export function stft(x: Float32Array, sr: number, nFft: number, hop: number, winLen = nFft): Spec {
  const w = hann(winLen);
  const pad = nFft >> 1;
  const frames = Math.max(1, Math.floor((x.length + 2 * pad - nFft) / hop) + 1);
  const re: Float32Array[] = [], im: Float32Array[] = [];
  const off = (nFft - winLen) >> 1;
  const bins = Math.floor(nFft / 2) + 1;
  const pow2 = isPow2(nFft);
  // centred frames with reflect padding at both ends (torch.stft / librosa default)
  const at = (i: number) => {
    if (x.length < 2) return x[0] ?? 0;
    while (i < 0 || i >= x.length) i = i < 0 ? -i : 2 * (x.length - 1) - i;
    return x[i];
  };
  for (let f = 0; f < frames; f++) {
    const r = new Float32Array(nFft), i = new Float32Array(nFft);
    const start = f * hop - pad + off;
    for (let k = 0; k < winLen; k++) r[k + off] = at(start + k) * w[k];
    if (pow2) fft(r, i);
    else rdft(r.slice(), nFft, r, i);
    re.push(r.slice(0, bins));
    im.push(i.slice(0, bins));
  }
  return { nFft, win: winLen, hop, sr, re, im };
}

export function magnitudes(s: Spec): Float32Array[] {
  return s.re.map((r, f) => {
    const m = new Float32Array(r.length);
    const im = s.im[f];
    for (let k = 0; k < r.length; k++) m[k] = Math.hypot(r[k], im[k]);
    return m;
  });
}

/** Inverse STFT by weighted overlap-add. */
export function istft(re: Float32Array[], im: Float32Array[], nFft: number, hop: number, length: number): Float32Array {
  const w = hann(nFft);
  const pad = nFft >> 1;
  const out = new Float32Array(length + 2 * pad + nFft);
  const norm = new Float32Array(out.length);
  const fr = new Float32Array(nFft), fi = new Float32Array(nFft);
  const half = nFft / 2;
  for (let f = 0; f < re.length; f++) {
    for (let k = 0; k <= half; k++) { fr[k] = re[f][k]; fi[k] = im[f][k]; }
    for (let k = 1; k < half; k++) { fr[nFft - k] = re[f][k]; fi[nFft - k] = -im[f][k]; }
    ifft(fr, fi);
    const start = f * hop;
    for (let k = 0; k < nFft; k++) {
      out[start + k] += fr[k] * w[k];
      norm[start + k] += w[k] * w[k];
    }
  }
  const y = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const n = norm[i + pad];
    y[i] = n > 1e-6 ? out[i + pad] / n : 0;
  }
  return y;
}

/** Rebuild a waveform from magnitudes alone by iteratively guessing the phase. */
export function griffinLim(mag: Float32Array[], sr: number, nFft: number, hop: number, length: number, iters = 32, seed = 7): Float32Array {
  const bins = nFft / 2 + 1;
  let y = randomPhase(mag, nFft, hop, length, seed);
  let re: Float32Array[], im: Float32Array[];
  for (let it = 0; it < iters; it++) {
    const s = stft(y, sr, nFft, hop);
    const n = Math.min(s.re.length, mag.length);
    re = []; im = [];
    for (let f = 0; f < n; f++) {
      const r = new Float32Array(bins), i = new Float32Array(bins);
      for (let k = 0; k < bins; k++) {
        const a = s.re[f][k], b = s.im[f][k];
        const len = Math.hypot(a, b) || 1;
        r[k] = (mag[f][k] * a) / len;
        i[k] = (mag[f][k] * b) / len;
      }
      re.push(r); im.push(i);
    }
    y = istft(re, im, nFft, hop, length);
  }
  return y;
}

/** Same magnitudes, random phase: what "throwing away phase" sounds like with no clever repair. */
export function randomPhase(mag: Float32Array[], nFft: number, hop: number, length: number, seed = 3): Float32Array {
  const rand = rng(seed);
  const re = mag.map((m) => new Float32Array(m.length));
  const im = mag.map((m) => new Float32Array(m.length));
  mag.forEach((m, f) => {
    for (let k = 0; k < m.length; k++) {
      const p = rand() * 2 * Math.PI;
      re[f][k] = m[k] * Math.cos(p);
      im[f][k] = m[k] * Math.sin(p);
    }
  });
  return istft(re, im, nFft, hop, length);
}
