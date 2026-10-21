import { S, screenBg, screenText } from "../scene/screen";
import { trace } from "../scene/defaults";
import { derive, type Pipe } from "../pipeline";
import type { Analysis } from "../analysis";
import { codecCodes, CODEC_K, whisper, cached, sharedBooks } from "../analysis";
import { melBank, fromMel, toMel, hzToMel, melToHz } from "../dsp/mel";
import { griffinLim, stft, magnitudes } from "../dsp/stft";
import { normalize, resample, mixMono } from "../dsp/signal";
import type { Clip } from "../audio/engine";

export { S, screenBg, screenText, trace };

/** Screen units: 1u = 1% of the screen height, so drawings scale from the monitor to the enlarged view. */
export const unit = (h: number) => h / 100;

export function head(g: CanvasRenderingContext2D, w: number, h: number, title: string, right?: string, rightColor = S.teal) {
  const u = unit(h);
  screenBg(g, w, h);
  let rw = 0;
  if (right) { g.font = S.mono(6.4 * u); rw = g.measureText(right).width; screenText(g, right, w - 4 * u, 10 * u, 6.4 * u, rightColor, "right", true); }
  // shrink the title until it clears the right-hand value
  let px = 7 * u;
  const room = w - 12 * u - rw;
  g.font = S.font(px);
  const tw = g.measureText(title.toUpperCase()).width;
  if (tw > room) px *= Math.max(0.5, room / tw);
  screenText(g, title.toUpperCase(), 4 * u, 10 * u, px, S.dim);
}

// Dark-screen colour ramp: glass → deep teal → teal → pale → paper → amber for the loudest.
const STOPS: [number, number[]][] = [[0, [29, 39, 66]], [0.3, [30, 78, 104]], [0.55, [26, 163, 161]], [0.78, [150, 218, 206]], [0.93, [243, 234, 216]], [1, [244, 178, 79]]];
const RAMP = (() => {
  const r = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
    const [t0, c0] = STOPS[j], [t1, c1] = STOPS[j + 1];
    const k = (t - t0) / (t1 - t0);
    for (let c = 0; c < 3; c++) r[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * k;
  }
  return r;
})();

export const rampCss = (v: number) => { const i = Math.round(Math.max(0, Math.min(1, v)) * 255) * 3; return `rgb(${RAMP[i]},${RAMP[i + 1]},${RAMP[i + 2]})`; };

/**
 * T x F values in 0..1 → image, time left to right, row 0 at the bottom.
 * rowMap(y, H) returns the source row for output row y (top = 0), or -1 for "nothing here".
 */
export function heat(data: ArrayLike<number>[], H = 160, rowMap?: (y: number, H: number) => number): HTMLCanvasElement {
  const T = Math.max(1, data.length), F = data[0]?.length ?? 1;
  const c = document.createElement("canvas");
  c.width = T; c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(T, H);
  for (let y = 0; y < H; y++) {
    const src = rowMap ? rowMap(y, H) : ((H - 1 - y) / (H - 1)) * (F - 1);
    for (let t = 0; t < T; t++) {
      const o = (y * T + t) * 4;
      if (src < 0) { const hatch = (t + y) % 5 === 0 ? 52 : 36; img.data[o] = hatch; img.data[o + 1] = hatch + 6; img.data[o + 2] = hatch + 24; img.data[o + 3] = 255; continue; }
      const v = Math.max(0, Math.min(1, data[t][Math.min(F - 1, Math.floor(src))] ?? 0));
      const ci = Math.round(v * 255) * 3;
      img.data[o] = RAMP[ci]; img.data[o + 1] = RAMP[ci + 1]; img.data[o + 2] = RAMP[ci + 2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function blit(g: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, smooth = true) {
  g.save();
  g.imageSmoothingEnabled = smooth;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, x, y, w, h);
  g.restore();
}

export function fmtHz(f: number) { return f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`; }
export function fmtBits(bps: number) {
  if (!isFinite(bps)) return "∞";
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mb/s`;
  if (bps >= 1e3) return `${+(bps / 1e3).toFixed(bps >= 1e4 ? 0 : 1)} kb/s`;
  return `${Math.round(bps)} b/s`;
}
export const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");

// ---------------------------------------------------------------- the whole pipeline, stage by stage, for one sound

export interface Stage { station: string; name: string; holds: string; shape: string; perSec: string; bps: number; gone: string }

export function stages(a: Analysis, p: Pipe): Stage[] {
  const d = derive(p);
  const dur = a.clip.channels[0].length / a.clip.sr;
  const T = a.mel.frames.length;
  const Tenc = a.enc.T;
  const Tlm = Math.ceil(Tenc / p.pool);
  const Tcodec = a.codes[0]?.length ?? 0;
  const ch = a.clip.channels[0] === a.clip.channels[1] ? 1 : 2;
  return [
    { station: "source", name: "Air", holds: "pressure waves", shape: `${dur.toFixed(1)} s of sound`, perSec: "continuous", bps: Infinity, gone: "nothing yet" },
    { station: "mic", name: "Microphone", holds: "a voltage", shape: `${ch === 2 ? "2 channels" : "1 channel"}`, perSec: "continuous", bps: Infinity, gone: "direction (one point in space per mic)" },
    { station: "adc", name: "ADC", holds: "numbers", shape: `${fmtN(a.x.length)} samples`, perSec: `${fmtN(p.sr)} samples`, bps: d.pcmBps, gone: `everything above ${fmtHz(p.sr / 2)}, detail below ${p.bits}-bit` },
    { station: "fft", name: "Frames + FFT", holds: "frequencies per slice", shape: `${fmtN(T)} × ${Math.floor((d.winSamples <= 512 ? d.winSamples : 2 ** Math.ceil(Math.log2(d.winSamples))) / 2) + 1}`, perSec: `${d.melFps} frames`, bps: d.melFps * (d.winSamples / 2 + 1) * 32, gone: "phase (the exact wave shape)" },
    { station: "mel", name: "Mel bands", holds: "loudness per band", shape: `${fmtN(T)} × ${p.nMels}`, perSec: `${fmtN(d.melFps * p.nMels)} numbers`, bps: d.melBps, gone: "fine pitch in the upper bands" },
    { station: "encoder", name: "Encoder", holds: "feature vectors", shape: `${fmtN(Tenc)} × ${p.encDim}`, perSec: `${+d.encHz.toFixed(1)} vectors`, bps: d.encBps, gone: "whatever training didn't reward" },
    { station: "tokens", name: "Codec tokens", holds: "integers", shape: `${Tcodec} × 8`, perSec: `${p.codecHz} frames`, bps: p.codecHz * 8 * Math.log2(CODEC_K), gone: "anything between codebook entries" },
    { station: "projector", name: "Projector", holds: "LM-sized vectors", shape: `${fmtN(Tlm)} × ${p.lmDim}`, perSec: `${+d.lmHz.toFixed(1)} tokens`, bps: d.lmBps, gone: `timing finer than ${Math.round(1000 / d.lmHz)} ms` },
    { station: "lm", name: "Language model", holds: "context", shape: `${fmtN(Tlm)} audio + text tokens`, perSec: `${+d.lmHz.toFixed(1)} tokens`, bps: d.lmBps, gone: "what the question didn't ask about" },
    { station: "head", name: "LM head", holds: "a choice", shape: `1 of ${a.labels.length} labels`, perSec: "a few tokens", bps: 50, gone: "everything but the answer" },
  ];
}

// ---------------------------------------------------------------- turning toy codec frames back into sound

/**
 * Pooled 80 ms Whisper log-mel frames → audio. Hold each frame for 8 × 10 ms, undo Whisper's
 * scaling, spread band energy back over FFT bins, and guess the phase with Griffin-Lim.
 */
export function decodeFrames(frames: Float32Array[], repeat = 8): Float32Array {
  const bank = melBank(16000, 512, 80, 0, 8000);
  const bank400 = melBank(16000, 400, 80, 0, 8000);
  const melPow: Float32Array[] = [];
  for (const f of frames) {
    const p = f.map((v, m) => 10 ** (v * 4 - 4) / ((2 / (bank400.edges[m + 2] - bank400.edges[m])) || 1));
    for (let r = 0; r < repeat; r++) melPow.push(p);
  }
  const mag = fromMel(melPow, bank).map((f) => f.map((v) => Math.sqrt(Math.max(0, v))));
  return normalize(griffinLim(mag, 16000, 512, 160, melPow.length * 160, 24), 0.8);
}

/**
 * Average reconstruction error after 1…8 codebooks, in decibels per mel band.
 * One unit of Whisper's log-mel scale is 4 × log10 of power, i.e. 40 dB.
 */
export function codecError(a: Analysis, trainOn: "all" | "speech" = "all") {
  return cached(`codecErr:${a.clip.id}:${trainOn}`, () => {
    const c = codecCodes(a.clip, trainOn);
    const f = c.frames, dim = f[0].length;
    return c.codes.map((_, s) => {
      let e = 0;
      f.forEach((v, i) => { const r = partial(c, i, s + 1, trainOn); for (let k = 0; k < dim; k++) e += (v[k] - r[k]) ** 2; });
      return Math.sqrt(e / (f.length * dim)) * 40;
    });
  });
}

/** Sum of the first `n` codebook entries chosen for frame i. */
export function partial(c: ReturnType<typeof codecCodes>, i: number, n: number, trainOn: "all" | "speech" = "all") {
  const books = sharedBooks(trainOn).books;
  const dim = c.frames[0].length;
  const out = new Float32Array(dim);
  for (let s = 0; s < n; s++) { const e = books[s][c.codes[s][i]]; for (let k = 0; k < dim; k++) out[k] += e[k]; }
  return out;
}

export function codecDecode(a: Analysis, n: number, trainOn: "all" | "speech" = "all") {
  return cached(`codecDec:${a.clip.id}:${n}:${trainOn}`, () => {
    const c = codecCodes(a.clip, trainOn);
    return decodeFrames(c.frames.map((_, i) => partial(c, i, n, trainOn)));
  });
}

export const whisperFrames = (a: Analysis) => whisper(a.clip).frames;

// ---------------------------------------------------------------- spectrograms for the dark monitors


/** Magnitude frames in dB, scaled 0..1 over `range` dB below the loudest bin. */
export function specDb(x: Float32Array, sr: number, nFft = sr > 30000 ? 2048 : 512, hop = nFft / 4, range = 60): Float32Array[] {
  const mags = magnitudes(stft(x, sr, nFft, hop));
  let max = 1e-9;
  for (const f of mags) for (const v of f) if (v > max) max = v;
  return mags.map((f) => f.map((v) => 1 + (20 * Math.log10(Math.max(v / max, 1e-9))) / range));
}

/** Height fraction (0 = bottom) of a frequency on a mel-spaced display axis from 0 to maxHz. */
export const melFrac = (hz: number, maxHz: number) => hzToMel(Math.max(0, hz)) / hzToMel(maxHz);

/** Spectrogram image, mel-spaced axis 0..maxHz. Above the signal's own Nyquist it is drawn hatched (nothing there). */
export function specHeat(x: Float32Array, sr: number, maxHz = 24000, rows = 180): HTMLCanvasElement {
  const nFft = sr > 30000 ? 2048 : 512;
  const frames = specDb(x, sr, nFft, nFft / 4);
  const bins = nFft / 2 + 1;
  const mMax = hzToMel(maxHz);
  return heat(frames, rows, (y, R) => {
    const hz = melToHz(((R - 1 - y) / (R - 1)) * mMax);
    const b = (hz / (sr / 2)) * (bins - 1);
    return b > bins - 1 ? -1 : b;
  });
}

export function freqTicks(g: CanvasRenderingContext2D, x: number, y: number, h: number, maxHz: number, u: number) {
  for (const t of [100, 500, 1000, 2000, 4000, 8000, 16000]) {
    if (t > maxHz) continue;
    const py = y + h - melFrac(t, maxHz) * h;
    screenText(g, t >= 1000 ? `${t / 1000}k` : String(t), x - 1 * u, py + 1.6 * u, 4.2 * u, S.dim, "right", true);
  }
}

// ---------------------------------------------------------------- the speech front end, undone back into sound

export interface ChainOpts { mono: boolean; sr16: boolean; phase: boolean; mel: boolean; pool: boolean }

function hold(frames: Float32Array[], n: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < frames.length; i += n) {
    const end = Math.min(frames.length, i + n);
    const avg = new Float32Array(frames[0].length);
    for (let j = i; j < end; j++) for (let k = 0; k < avg.length; k++) avg[k] += frames[j][k] / (end - i);
    for (let j = i; j < end; j++) out.push(avg);
  }
  return out;
}

/**
 * Apply the steps a speech front end takes, then rebuild audio so the result can be heard.
 * Phase is never stored by the front end, so any step after "drop phase" is rebuilt by Griffin-Lim.
 */
export function lossyChain(clip: Clip, o: ChainOpts) {
  return cached(`chain:${clip.id}:${+o.mono}${+o.sr16}${+o.phase}${+o.mel}${+o.pool}`, () => {
    let chs = o.mono ? [mixMono(clip.channels)] : clip.channels.map((c) => c.slice());
    let sr = clip.sr;
    if (o.sr16) { chs = chs.map((c) => resample(c, sr, 16000)); sr = 16000; }
    if (o.phase || o.mel || o.pool) {
      const nFft = sr > 30000 ? 2048 : 512, hop = nFft / 4;
      chs = chs.map((c) => {
        let mag = magnitudes(stft(c, sr, nFft, hop));
        const poolN = Math.max(1, Math.round((0.08 * sr) / hop));
        if (o.mel) {
          const bank = melBank(sr, nFft, 80, 0, sr / 2);
          let m = toMel(mag.map((f) => f.map((v) => v * v)), bank, false);
          if (o.pool) m = hold(m.map((f) => f.map((v) => Math.log(v + 1e-12))), poolN).map((f) => f.map((v) => Math.exp(v)));
          mag = fromMel(m, bank).map((f) => f.map((v) => Math.sqrt(Math.max(0, v))));
        } else if (o.pool) {
          mag = hold(mag.map((f) => f.map((v) => Math.log(v + 1e-9))), poolN).map((f) => f.map((v) => Math.exp(v)));
        }
        return normalize(griffinLim(mag, sr, nFft, hop, c.length, sr > 30000 ? 16 : 28), 0.8);
      });
    }
    if (chs.length === 1) chs = [chs[0], chs[0]];
    return { channels: chs, sr };
  });
}

/** Only the mel-band energies survive: rebuild audio from them at the given settings. */
export function melOnly(x: Float32Array, sr: number, nMels: number, key: string) {
  return cached(`melOnly:${key}:${sr}:${nMels}`, () => {
    const nFft = sr > 30000 ? 2048 : sr > 20000 ? 1024 : 512, hop = nFft / 4;
    const bank = melBank(sr, nFft, nMels, 0, sr / 2);
    const m = toMel(magnitudes(stft(x, sr, nFft, hop)).map((f) => f.map((v) => v * v)), bank, false);
    const mag = fromMel(m, bank).map((f) => f.map((v) => Math.sqrt(Math.max(0, v))));
    return normalize(griffinLim(mag, sr, nFft, hop, x.length, sr > 30000 ? 16 : 28), 0.8);
  });
}
