// Radix-2 complex FFT, in place. Length must be a power of two.
const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

export function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step];
        const a = i + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

export function ifft(re: Float32Array | Float64Array, im: Float32Array | Float64Array) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

export function hann(n: number, periodic = true): Float32Array {
  const w = new Float32Array(n);
  const d = periodic ? n : n - 1;
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
  return w;
}

/** Magnitude spectrum (n/2+1 bins) of one frame, windowed and zero-padded to nFft. */
export function magSpectrum(frame: ArrayLike<number>, nFft: number, win?: Float32Array): Float32Array {
  const re = new Float32Array(nFft), im = new Float32Array(nFft);
  const len = Math.min(frame.length, nFft);
  for (let i = 0; i < len; i++) re[i] = frame[i] * (win ? win[i] : 1);
  fft(re, im);
  const out = new Float32Array(nFft / 2 + 1);
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

const dftCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

/**
 * Direct DFT of a real frame for lengths that aren't powers of two (Whisper uses 400).
 * O(n²), fine for n of a few hundred. Writes bins 0..n/2 into re/im.
 */
export function rdft(x: ArrayLike<number>, n: number, re: Float32Array, im: Float32Array) {
  let t = dftCache.get(n);
  if (!t) {
    const cos = new Float64Array(n), sin = new Float64Array(n);
    for (let i = 0; i < n; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    t = { cos, sin };
    dftCache.set(n, t);
  }
  const half = Math.floor(n / 2);
  for (let k = 0; k <= half; k++) {
    let a = 0, b = 0, idx = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      if (v !== 0) { a += v * t.cos[idx]; b -= v * t.sin[idx]; }
      idx += k;
      if (idx >= n) idx -= n;
    }
    re[k] = a; im[k] = b;
  }
}

export const isPow2 = (n: number) => (n & (n - 1)) === 0;

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
