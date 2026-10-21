import { audio, type Clip } from "./audio/engine";
import { SPECIMENS } from "./audio/specimens";
import { resample, mixMono, quantize } from "./dsp/signal";
import { logMel, whisperLogMel, type LogMel } from "./dsp/mel";
import { rng, gaussian } from "./dsp/rand";
import { rvq, rvqEncode, type Vec } from "./dsp/vq";
import { heatmap } from "./ui/dom";
import { derive, type Pipe } from "./pipeline";
import { bus } from "./scene/bus";

const memo = new Map<string, unknown>();
export function cached<T>(key: string, fn: () => T): T {
  if (!memo.has(key)) {
    if (memo.size > 80) memo.delete(memo.keys().next().value!);
    memo.set(key, fn());
  }
  return memo.get(key) as T;
}

const pipeKey = (p: Pipe) => `${p.sr}|${p.bits}|${p.winMs}|${p.hopMs}|${p.nMels}|${p.encStride}`;

/** One channel at a given rate, properly low-pass filtered first. */
export const monoAt = (c: Clip, sr: number) => cached(`mono:${c.id}:${sr}`, () => resample(mixMono(c.channels), c.sr, sr));

/** Whisper's exact front end on a clip (16 kHz, 400/160, 80 bands). */
export const whisper = (c: Clip, nMels = 80) => cached(`whisper:${c.id}:${nMels}`, () => whisperLogMel(monoAt(c, 16000), nMels));

/** Map Whisper-scaled log-mel to 0..1 for display (Whisper keeps 2.0 = 80 dB below the peak). */
export function melDisplay(frames: Float32Array[], span = 2): Float32Array[] {
  let mx = -Infinity;
  for (const f of frames) for (const v of f) if (v > mx) mx = v;
  return frames.map((f) => f.map((v) => Math.max(0, (v - mx + span) / span)));
}

// ---------------------------------------------------------------- encoder (real arithmetic, seeded weights)

const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));

export function conv1d(X: Float32Array[], cOut: number, k: number, stride: number, seed: number): Float32Array[] {
  const cIn = X[0].length, T = X.length;
  const r = rng(seed);
  const scale = Math.sqrt(2 / (cIn * k));
  const W = Array.from({ length: cOut }, () => Array.from({ length: k }, () => Float32Array.from({ length: cIn }, () => gaussian(r) * scale)));
  const out: Float32Array[] = [];
  for (let t = 0; t * stride < T; t++) {
    const o = new Float32Array(cOut);
    for (let c = 0; c < cOut; c++) {
      let s = 0;
      for (let j = 0; j < k; j++) {
        const src = X[t * stride + j - (k >> 1)];
        if (!src) continue;
        const w = W[c][j];
        for (let i = 0; i < cIn; i++) s += w[i] * src[i];
      }
      o[c] = gelu(s);
    }
    out.push(o);
  }
  return out;
}

function standardise(H: Float32Array[]) {
  const d = H[0].length;
  const mean = new Float32Array(d), sd = new Float32Array(d);
  for (const v of H) for (let i = 0; i < d; i++) mean[i] += v[i] / H.length;
  for (const v of H) for (let i = 0; i < d; i++) sd[i] += (v[i] - mean[i]) ** 2 / H.length;
  return H.map((v) => v.map((x, i) => (x - mean[i]) / (Math.sqrt(sd[i]) + 1e-6)));
}

/** softmax(Q Kᵀ / τ) with Q = K = the (row-normalised) features themselves. */
export function selfAttention(Z: Float32Array[], sharp = 9, causal = false, noSelf = false): Float32Array[] {
  const N = Z.map((z) => { const n = Math.hypot(...z) || 1; return z.map((x) => x / n); });
  return N.map((q, a) => {
    const row = new Float32Array(N.length);
    let mx = -Infinity;
    for (let b = 0; b < N.length; b++) {
      // masking the token itself would leave the very first token of a causal sequence nothing to read
      if ((causal && b > a) || (noSelf && a === b && N.length > 1 && !(causal && a === 0))) { row[b] = -Infinity; continue; }
      let s = 0;
      for (let i = 0; i < q.length; i++) s += q[i] * N[b][i];
      row[b] = s * sharp;
      mx = Math.max(mx, row[b]);
    }
    let sum = 0;
    for (let b = 0; b < row.length; b++) { row[b] = row[b] === -Infinity ? 0 : Math.exp(row[b] - mx); sum += row[b]; }
    for (let b = 0; b < row.length; b++) row[b] /= sum;
    return row;
  });
}

export interface Encoded {
  /** per layer, T x C activations (standardised) */
  layers: Float32Array[][];
  names: string[];
  att: Float32Array[];
  T: number;
}

/**
 * Whisper-shaped encoder on the clip: conv (k=3) → conv (k=3, stride) → sinusoidal positions →
 * three attention blocks. Weights are seeded random numbers, not trained ones; the attention uses
 * the features as their own queries/keys/values, so it groups frames that sound alike.
 */
export function encode(melFrames: Float32Array[], stride: number, key: string): Encoded {
  return cached(`enc:${key}:${stride}`, () => {
    const h1 = conv1d(melFrames, 48, 3, 1, 1);
    const h2 = conv1d(h1, 48, 3, stride, 2);
    const d = h2[0].length;
    let H = standardise(h2.map((v, t) => v.map((x, i) => x + 0.3 * (i % 2 ? Math.cos(t / 10000 ** ((i - 1) / d)) : Math.sin(t / 10000 ** (i / d))))));
    const layers = [standardise(h1), standardise(h2)];
    let att: Float32Array[] = [];
    for (let l = 0; l < 3; l++) {
      att = selfAttention(H, 9);
      H = standardise(H.map((h, a) => { const o = h.slice(); att[a].forEach((w, b) => { if (w > 1e-4) for (let i = 0; i < d; i++) o[i] += w * H[b][i]; }); return o; }));
      layers.push(H);
    }
    return { layers, names: ["conv 1", `conv 2 (stride ${stride})`, "block 1", "block 2", "block 3"], att, T: H.length };
  });
}

export const layerImage = (L: Float32Array[]) => heatmap(L.map((f) => f.map((v) => 0.5 + v * 0.22)), L[0].length);

// ---------------------------------------------------------------- toy Mimi-rate codec (12.5 Hz, 8 residual codebooks)

const POOL = 8; // 8 × 10 ms Whisper frames = 80 ms = one Mimi frame

function pooled(frames: Float32Array[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i + POOL <= frames.length; i += POOL) {
    const v = new Float32Array(frames[0].length);
    for (let j = i; j < i + POOL; j++) for (let k = 0; k < v.length; k++) v[k] += frames[j][k] / POOL;
    out.push(v);
  }
  return out.length ? out : [frames[0]];
}

export const CODEC_K = 32;

/** Codebooks trained on every built-in sound, so any clip can be encoded with the same "vocabulary". */
export function sharedBooks(trainOn: "all" | "speech" = "all") {
  return cached(`books:${trainOn}`, () => {
    const ids = trainOn === "speech" ? ["voice"] : SPECIMENS.map((s) => s.id);
    const data = ids.flatMap((id) => pooled(whisper(audio.specimen(id)).frames));
    return rvq(data, CODEC_K, 8, 17);
  });
}

export function codecCodes(c: Clip, trainOn: "all" | "speech" = "all") {
  return cached(`codes:${c.id}:${trainOn}`, () => {
    const frames = pooled(whisper(c).frames);
    const { codes, recon } = rvqEncode(frames, sharedBooks(trainOn).books);
    return { frames, codes: codes.map((r) => Array.from(r)), recon };
  });
}

// ---------------------------------------------------------------- tiny label head

export interface Label { id: string; name: string; logit: number }

function embedding(c: Clip): Float32Array {
  return cached(`emb:${c.id}`, () => {
    const f = whisper(c).frames;
    const F = f[0].length;
    const mean = new Float32Array(F), sd = new Float32Array(F);
    for (const v of f) for (let k = 0; k < F; k++) mean[k] += v[k] / f.length;
    for (const v of f) for (let k = 0; k < F; k++) sd[k] += (v[k] - mean[k]) ** 2 / f.length;
    const e = new Float32Array(2 * F);
    for (let k = 0; k < F; k++) { e[k] = mean[k]; e[F + k] = Math.sqrt(sd[k]) * 2; }
    return e;
  });
}

/**
 * An LM head in miniature: one weight row per output label (here, the average embedding of each
 * built-in sound). Logit = dot(row, clip embedding) after centring and normalising.
 */
export function labelLogits(c: Clip): Label[] {
  return cached(`labels:${c.id}`, () => {
    const protos = SPECIMENS.map((s) => ({ s, e: embedding(audio.specimen(s.id)) }));
    const dim = protos[0].e.length;
    const centre = new Float32Array(dim);
    protos.forEach((p) => p.e.forEach((v, i) => (centre[i] += v / protos.length)));
    const unit = (e: Float32Array) => { const z = e.map((v, i) => v - centre[i]); const n = Math.hypot(...z) || 1; return z.map((v) => v / n); };
    const q = unit(embedding(c));
    return protos.map(({ s, e }) => {
      const w = unit(e);
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += w[i] * q[i];
      return { id: s.id, name: s.name, logit: dot * 6 };
    });
  });
}

// ---------------------------------------------------------------- whole-pipeline analysis of a clip

export interface Analysis {
  clip: Clip;
  pipe: Pipe;
  /** mono, at the pipeline's sample rate, rounded to its bit depth */
  x: Float32Array;
  mel: LogMel;
  melDisp: Float32Array[];
  enc: Encoded;
  codes: number[][];
  labels: Label[];
}

export function analyse(c: Clip, p: Pipe): Analysis {
  return cached(`an:${c.id}:${pipeKey(p)}`, () => {
    const d = derive(p);
    const x = quantize(monoAt(c, p.sr), p.bits);
    const mel = logMel(x, p.sr, p.nMels, d.winSamples, d.hopSamples);
    const enc = encode(mel.frames, p.encStride, `${c.id}:${pipeKey(p)}`);
    return { clip: c, pipe: p, x, mel, melDisp: melDisplay(mel.frames), enc, codes: codecCodes(c).codes, labels: labelLogits(c) };
  });
}

/** Push an analysis into the scene so the stations show this clip. */
export function feedScene(a: Analysis) {
  bus.mel = a.melDisp;
  bus.enc = a.enc.layers.map(layerImage);
  bus.codes = a.codes;
  bus.codeK = CODEC_K;
}
