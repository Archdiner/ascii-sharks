/** Windowed-sinc low-pass FIR, cutoff as a fraction of the sample rate (0..0.5). */
export function lowpassKernel(cutoff: number, taps = 63): Float32Array {
  const h = new Float32Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const y = new Float32Array(x.length);
  const m = (h.length - 1) >> 1;
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < h.length; k++) {
      const j = i + m - k;
      if (j >= 0 && j < x.length) s += x[j] * h[k];
    }
    y[i] = s;
  }
  return y;
}

/**
 * Change sample rate. With antialias, a low-pass removes everything above the new Nyquist
 * first (what a real ADC / resampler does). Without it, high frequencies fold back as aliases.
 */
export function resample(x: Float32Array, srIn: number, srOut: number, antialias = true): Float32Array {
  if (srIn === srOut) return x.slice();
  let src = x;
  if (antialias && srOut < srIn) src = convolve(x, lowpassKernel((0.5 * srOut * 0.94) / srIn, 127));
  const n = Math.floor((x.length * srOut) / srIn);
  const y = new Float32Array(n);
  const ratio = srIn / srOut;
  for (let i = 0; i < n; i++) {
    const t = i * ratio;
    if (!antialias) { y[i] = src[Math.min(src.length - 1, Math.round(t))]; continue; }
    const i0 = Math.floor(t), f = t - i0;
    const a = src[i0] ?? 0, b = src[i0 + 1] ?? a;
    y[i] = a + (b - a) * f;
  }
  return y;
}

/** Round each sample to one of 2^bits levels across [-1, 1]. */
export function quantize(x: Float32Array, bits: number): Float32Array {
  const levels = 2 ** bits;
  const step = 2 / levels;
  // mid-rise: levels sit at the centres of 2^bits equal cells, symmetric about zero
  return x.map((v) => {
    const idx = Math.max(0, Math.min(levels - 1, Math.floor((v + 1) / step)));
    return -1 + (idx + 0.5) * step;
  });
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

export function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m < 1e-9) return x;
  const g = peak / m;
  return x.map((v) => v * g);
}

export function mixMono(chans: Float32Array[]): Float32Array {
  if (chans.length === 1) return chans[0].slice();
  const n = chans[0].length;
  const y = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) y[i] += c[i] / chans.length;
  return y;
}
