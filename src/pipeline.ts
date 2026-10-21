/**
 * The settings of the listening pipeline, shared by every lesson. Changing the sample rate in the
 * ADC lesson changes what the mel printer, the encoder and the end-to-end view show later.
 */
export interface Pipe {
  /** samples per second after the ADC / resampler */
  sr: number;
  /** bits per sample */
  bits: number;
  /** analysis window and hop, milliseconds */
  winMs: number;
  hopMs: number;
  /** mel bands */
  nMels: number;
  /** encoder downsampling: spectrogram frames per encoder frame */
  encStride: number;
  /** encoder output width */
  encDim: number;
  /** projector pooling: encoder frames per LM token */
  pool: number;
  /** LM embedding width */
  lmDim: number;
  /** codec settings (Mimi-style tokens) */
  codecHz: number;
  codebooks: number;
  codebookSize: number;
}

export const DEFAULT_PIPE: Pipe = {
  sr: 16000, bits: 16, winMs: 25, hopMs: 10, nMels: 80, encStride: 2, encDim: 1280, pool: 2, lmDim: 3584,
  codecHz: 12.5, codebooks: 8, codebookSize: 2048,
};

export const PRESETS: Record<string, { label: string; note: string; pipe: Partial<Pipe> }> = {
  whisper: { label: "Whisper", note: "16 kHz, 80 mel bands, 50 vectors/s", pipe: { sr: 16000, bits: 16, winMs: 25, hopMs: 10, nMels: 80, encStride: 2, encDim: 1280, pool: 1 } },
  qwen: { label: "Qwen2-Audio", note: "Whisper-large-v3 encoder, pooled to 25 tokens/s", pipe: { sr: 16000, bits: 16, winMs: 25, hopMs: 10, nMels: 128, encStride: 2, encDim: 1280, pool: 2, lmDim: 4096 } },
  phone: { label: "Telephone", note: "8 kHz, 8-bit: the old phone network", pipe: { sr: 8000, bits: 8, winMs: 25, hopMs: 10, nMels: 40, encStride: 2, pool: 2 } },
  hifi: { label: "Full band", note: "48 kHz, 24-bit, 128 bands", pipe: { sr: 48000, bits: 24, winMs: 25, hopMs: 10, nMels: 128, encStride: 2, pool: 2 } },
};

let pipe: Pipe = { ...DEFAULT_PIPE };
const subs = new Set<(p: Pipe) => void>();

export const getPipe = () => pipe;
export function setPipe(patch: Partial<Pipe>) {
  pipe = { ...pipe, ...patch };
  subs.forEach((f) => f(pipe));
}
export function onPipe(f: (p: Pipe) => void) { subs.add(f); return () => subs.delete(f); }

/** Derived numbers for any stage of the pipeline. */
export function derive(p: Pipe) {
  const melFps = 1000 / p.hopMs;
  const encHz = melFps / p.encStride;
  const lmHz = encHz / p.pool;
  return {
    melFps,
    encHz,
    lmHz,
    nyquist: p.sr / 2,
    pcmBps: p.sr * p.bits,
    melBps: p.nMels * melFps * 32,
    encBps: p.encDim * encHz * 16,
    lmBps: p.lmDim * lmHz * 16,
    codecBps: p.codecHz * p.codebooks * Math.log2(p.codebookSize),
    winSamples: Math.round((p.winMs / 1000) * p.sr),
    hopSamples: Math.round((p.hopMs / 1000) * p.sr),
  };
}

export function describe(p: Pipe) {
  const d = derive(p);
  return `${p.sr / 1000} kHz · ${p.bits} bit · ${p.nMels} mel · ${+d.lmHz.toFixed(1)}/s`;
}
