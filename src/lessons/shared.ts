import type { AudioEngine, Clip } from "../audio/engine";
import { stft, magnitudes, griffinLim } from "../dsp/stft";
import { melBank, toMel, fromMel, whisperLogMel, hzToMel, melToHz, type LogMel } from "../dsp/mel";
import { resample, mixMono, normalize } from "../dsp/signal";
import { rvq, type RVQ } from "../dsp/vq";
import { heatmap, label, PALETTE } from "../ui/dom";

const memo = new Map<string, unknown>();
export function cached<T>(key: string, fn: () => T): T {
  if (!memo.has(key)) {
    if (memo.size > 40) memo.delete(memo.keys().next().value!);
    memo.set(key, fn());
  }
  return memo.get(key) as T;
}

export const mel16 = (a: AudioEngine): LogMel => cached(`mel16:${a.clip.id}`, () => whisperLogMel(a.mono(16000)));

/** Whisper-scaled log-mel → 0..1 for display. Whisper keeps a window of 2.0 (= 80 dB) below its max. */
export function melDisplay(frames: Float32Array[], span = 2): Float32Array[] {
  let mx = -Infinity;
  for (const f of frames) for (const v of f) if (v > mx) mx = v;
  return frames.map((f) => f.map((v) => Math.max(0, (v - mx + span) / span) * 0.96));
}

/** Normalised dB magnitude frames (0..1 over `range` dB below the peak). */
export function specDb(x: Float32Array, sr: number, nFft = 1024, hop = nFft / 4, range = 65): Float32Array[] {
  const mags = magnitudes(stft(x, sr, nFft, hop));
  let max = 1e-9;
  for (const f of mags) for (const v of f) if (v > max) max = v;
  return mags.map((f) => f.map((v) => 1 + (20 * Math.log10(Math.max(v / max, 1e-9))) / range));
}

/** Fraction of the height (0 = bottom) at which a frequency sits on a mel-spaced display axis. */
export const melFrac = (hz: number, maxHz: number) => hzToMel(Math.max(0, hz)) / hzToMel(maxHz);

/**
 * Spectrogram image from 0 to maxHz on a mel-spaced axis, so low detail and the top octaves
 * both stay visible. Anything above the signal's own Nyquist is drawn as hatched void.
 */
export function specImage(x: Float32Array, sr: number, maxHz = 24000, rows = 200, nFft = sr > 30000 ? 2048 : 512): HTMLCanvasElement {
  const frames = specDb(x, sr, nFft, nFft / 4);
  const bins = nFft / 2 + 1;
  const mMax = hzToMel(maxHz);
  return heatmap(frames, rows, (y, R) => {
    const hz = melToHz(((R - 1 - y) / (R - 1)) * mMax);
    const b = (hz / (sr / 2)) * (bins - 1);
    return b > bins - 1 ? -1 : b;
  });
}

export function drawImage(g: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, smooth = true) {
  g.save();
  g.imageSmoothingEnabled = smooth;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, x, y, w, h);
  g.restore();
}

export function freqAxis(g: CanvasRenderingContext2D, x: number, y: number, h: number, maxHz: number, ticks = [0, 500, 1000, 2000, 4000, 8000, 16000, 24000]) {
  for (const t of ticks) {
    if (t > maxHz) continue;
    const py = y + h - melFrac(t, maxHz) * h;
    g.fillStyle = PALETTE.line;
    g.fillRect(x - 4, py, 4, 1);
    label(g, t >= 1000 ? `${t / 1000}k` : String(t), x - 6, py + 3, { align: "right", size: 10, mono: true, color: PALETTE.faint, weight: 400 });
  }
}

// ---------------------------------------------------------------- the lossy chain

export interface ChainOpts {
  mono: boolean;
  sr16: boolean;
  phase: boolean;
  mel: boolean;
  pool: boolean;
}

export interface ChainOut {
  channels: Float32Array[];
  sr: number;
}

function poolFrames(frames: Float32Array[], n: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < frames.length; i += n) {
    const avg = new Float32Array(frames[0].length);
    const end = Math.min(frames.length, i + n);
    for (let j = i; j < end; j++) for (let k = 0; k < avg.length; k++) avg[k] += frames[j][k] / (end - i);
    for (let j = i; j < end; j++) out.push(avg);
  }
  return out;
}

/** Apply the steps a typical speech front end applies, then turn it back into sound. */
export function lossyChain(clip: Clip, o: ChainOpts): ChainOut {
  let chs = o.mono ? [mixMono(clip.channels)] : clip.channels.map((c) => c.slice());
  let sr = clip.sr;
  if (o.sr16) { chs = chs.map((c) => resample(c, sr, 16000)); sr = 16000; }
  if (o.phase || o.mel || o.pool) {
    const nFft = sr > 30000 ? 2048 : 512;
    const hop = nFft / 4;
    chs = chs.map((c) => {
      let mag = magnitudes(stft(c, sr, nFft, hop));
      if (o.mel || o.pool) {
        const bank = melBank(sr, nFft, 80, 0, sr / 2);
        let m = toMel(mag.map((f) => f.map((v) => v * v)), bank, false);
        if (o.pool) {
          const lm = m.map((f) => f.map((v) => Math.log(v + 1e-12)));
          m = poolFrames(lm, Math.max(1, Math.round((0.08 * sr) / hop))).map((f) => f.map((v) => Math.exp(v)));
        }
        if (!o.mel) {
          // pooling alone: keep fine frequency detail but smear it in time
          mag = poolFrames(mag.map((f) => f.map((v) => Math.log(v + 1e-9))), Math.max(1, Math.round((0.08 * sr) / hop))).map((f) => f.map((v) => Math.exp(v)));
        } else {
          mag = fromMel(m, bank).map((f) => f.map((v) => Math.sqrt(Math.max(0, v))));
        }
      }
      return normalize(griffinLim(mag, sr, nFft, hop, c.length, sr > 30000 ? 16 : 28), 0.8);
    });
  }
  if (chs.length === 1) chs = [chs[0], chs[0]];
  return { channels: chs, sr };
}

// ---------------------------------------------------------------- toy neural-codec stand-in

export interface ToyCodec {
  K: number;
  frames: Float32Array[]; // log-mel, 80 dims, 125 fps @16 kHz
  q: RVQ;
  hop: number;
  nFft: number;
  length: number;
}

/** RVQ over log-mel frames of the clip. Not a neural codec, but the same idea: codes per frame, stacked residually. */
export function toyCodec(a: AudioEngine, K: number, stages = 8): ToyCodec {
  return cached(`toy:${a.clip.id}:${K}:${stages}`, () => {
    const x = a.mono(16000);
    const nFft = 512, hop = 128;
    const bank = melBank(16000, nFft, 80, 0, 8000);
    const mel = toMel(magnitudes(stft(x, 16000, nFft, hop)).map((f) => f.map((v) => v * v)), bank, false);
    const frames = mel.map((f) => f.map((v) => Math.log10(v + 1e-8)));
    return { K, frames, q: rvq(frames, K, stages), hop, nFft, length: x.length };
  });
}

export function toyDecode(t: ToyCodec, stages: number): Float32Array {
  const bank = melBank(16000, t.nFft, 80, 0, 8000);
  const recon = stages <= 0 ? t.frames : t.q.recon[Math.min(stages, t.q.recon.length) - 1];
  const mag = fromMel(recon.map((f) => f.map((v) => 10 ** v)), bank).map((f) => f.map((v) => Math.sqrt(Math.max(0, v))));
  return normalize(griffinLim(mag, 16000, t.nFft, t.hop, t.length, 28), 0.8);
}

export const p = (html: string) => html;
