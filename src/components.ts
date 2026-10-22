import type { AudioEngine } from "./audio/engine";
import { SPECIMENS } from "./audio/specimens";
import type { Draw } from "./scene/screen";
import { derive, type Pipe } from "./pipeline";
import type { Analysis } from "./analysis";
import { monoAt, CODEC_K } from "./analysis";
import { quantize, resample } from "./dsp/signal";
import { rng } from "./dsp/rand";
import { bus } from "./scene/bus";
import { el, slider, segmented, button } from "./ui/dom";
import { S, head, unit, screenText, heat, blit, rampCss, fmtBits, fmtN, melOnly, codecDecode, codecError } from "./lessons/kit";
import { softmax, generateAudio } from "./lessons/understand";

export interface CompApi {
  audio: AudioEngine;
  pipe: () => Pipe;
  setPipe: (p: Partial<Pipe>) => void;
  analysis: () => Analysis;
  log: (text: string, kind?: "info" | "ok" | "warn" | "dim" | "head") => void;
  flow: () => Promise<boolean>;
}

export interface Component {
  name: string;
  icon: string;
  /** what it does, in one or two plain sentences */
  what: string;
  /** the lesson that explains it */
  lesson: string;
  /** a short live readout under the title */
  status: (api: CompApi) => string;
  controls: (api: CompApi) => HTMLElement[];
  /** a monitor for stations whose own screen isn't enough (or that have none) */
  draw?: (api: CompApi) => Draw;
}

const row = (...kids: HTMLElement[]) => el("div", { class: "btns" }, ...kids);
const later = (fn: () => void) => setTimeout(fn, 30);
const RATES = [8000, 16000, 24000, 44100, 48000];
const r = rng(Date.now() % 7919);
let generated: ReturnType<typeof generateAudio> | null = null;
let headTemp = 1;

export const COMPONENTS: Record<string, Component> = {
  source: {
    name: "Speaker", icon: "speaker", lesson: "sound",
    what: "Pushes the air back and forth to make sound. Every sound enters the machine here.",
    status: (a) => `${a.audio.clip.name} · ${a.audio.duration.toFixed(1)} s · ${a.audio.playing ? "playing" : "stopped"}`,
    controls: (a) => {
      const sel = segmented("Sound", SPECIMENS.map((s) => [s.id, s.name] as [string, string]), a.audio.clip.id, (v) => { a.audio.useSpecimen(v); a.audio.playClip(); });
      return [sel, row(
        button("▶ Play / stop", () => (a.audio.playing ? a.audio.stop() : a.audio.playClip()), "btn primary"),
        button("Tone 440 Hz", () => (a.audio.playing === "tone" ? a.audio.stop() : a.audio.playTone(440, 0.25)), "btn"),
      )];
    },
  },
  mic: {
    name: "Microphone", icon: "mic", lesson: "microphone",
    what: "A thin membrane follows the air and makes a matching voltage. Record yourself and every station switches to your voice.",
    status: (a) => (a.audio.micOn ? `listening · level ${(bus.level * 100).toFixed(0)}%` : "off"),
    controls: (a) => [row(
      button("● Record 4 s", async () => { try { a.log("Recording 4 seconds…"); await a.audio.record(4); a.log("Recorded. Every station now shows your recording.", "ok"); } catch { a.log("The microphone isn't available.", "warn"); } }, "btn teal"),
      button("Listen live", async () => { try { a.audio.micOn ? a.audio.stopMic() : await a.audio.startMic(); } catch { a.log("The microphone isn't available.", "warn"); } }, "btn"),
    )],
  },
  adc: {
    name: "ADC", icon: "chip", lesson: "sampling",
    what: "Measures the voltage at a steady rate and stores each measurement as a number with a fixed number of bits.",
    status: (a) => `${fmtN(a.pipe().sr)} samples/s · ${a.pipe().bits}-bit · ${fmtBits(a.pipe().sr * a.pipe().bits)}`,
    controls: (a) => [
      segmented("Sample rate", RATES.map((v) => [String(v), `${v / 1000} kHz`] as [string, string]), String(a.pipe().sr), (v) => a.setPipe({ sr: Number(v) })),
      slider({ label: "Bits", min: 2, max: 24, value: a.pipe().bits, fmt: (v) => `${v} bit`, onInput: (v) => a.setPipe({ bits: v }) }),
      row(button("▶ Hear at these settings", () => { const p = a.pipe(), c = a.audio.clip; a.audio.playSignal([quantize(resample(monoAt(c, c.sr), c.sr, p.sr), p.bits)], p.sr); }, "btn primary")),
    ],
  },
  fft: {
    name: "Spectrum analyser", icon: "bars", lesson: "spectrum",
    what: "Cuts the samples into short frames and measures how much of each frequency every frame contains. The bars move with whatever is playing.",
    status: (a) => { const d = derive(a.pipe()); return `${a.pipe().winMs} ms frames · ${d.melFps} per second · ${(a.pipe().sr / d.winSamples).toFixed(0)} Hz apart`; },
    controls: (a) => [
      segmented("Frame", [["10", "10 ms"], ["25", "25 ms"], ["50", "50 ms"], ["100", "100 ms"]], String(a.pipe().winMs), (v) => a.setPipe({ winMs: Number(v) })),
      row(button("▶ Play to see the bars move", () => a.audio.playClip(), "btn primary")),
    ],
  },
  mel: {
    name: "Mel printer", icon: "sheet", lesson: "mel",
    what: "Groups frequencies into bands spaced the way people hear and prints the result over time. Press play to watch it print.",
    status: (a) => `${a.pipe().nMels} bands · ${fmtN(a.pipe().nMels * derive(a.pipe()).melFps)} numbers/s`,
    controls: (a) => [
      slider({ label: "Bands", min: 16, max: 128, step: 8, value: a.pipe().nMels, onInput: (v) => a.setPipe({ nMels: v }) }),
      row(
        button("▶ Print it", () => a.audio.playClip(), "btn primary"),
        button("Hear only the bands", () => { const an = a.analysis(); later(() => a.audio.playSignal([melOnly(an.x, an.pipe.sr, an.pipe.nMels, an.clip.id)], an.pipe.sr)); }, "btn"),
      ),
    ],
  },
  encoder: {
    name: "Encoder", icon: "layers", lesson: "encoder",
    what: "A neural network that turns the printed picture into one list of numbers per time step. The plates show this sound's activations, layer by layer.",
    status: (a) => `${a.analysis().enc.T} vectors · ${+derive(a.pipe()).encHz.toFixed(1)} per second`,
    controls: (a) => [segmented("Stride", [["1", "1"], ["2", "2"], ["4", "4"]], String(a.pipe().encStride), (v) => a.setPipe({ encStride: Number(v) }))],
  },
  tokens: {
    name: "Token tray", icon: "cube", lesson: "tokens",
    what: "Replaces each 80 ms of sound with 8 whole numbers looked up in codebooks. Each row of tiles corrects the rows above it.",
    status: (a) => { const e = codecError(a.analysis()); return `${bus.codeRows} codebooks · ${fmtBits(12.5 * bus.codeRows * Math.log2(CODEC_K))} · error ${e[bus.codeRows - 1].toFixed(1)} dB`; },
    controls: (a) => [
      slider({ label: "Codebooks", min: 1, max: 8, value: bus.codeRows, onInput: (v) => (bus.codeRows = v) }),
      row(button("▶ Hear the tokens", () => later(() => a.audio.playSignal([codecDecode(a.analysis(), bus.codeRows)], 16000)), "btn primary")),
    ],
  },
  projector: {
    name: "Projector", icon: "funnel", lesson: "projector",
    what: "Joins neighbouring encoder vectors and resizes them into the language model's word vectors. Its pooling decides how many tokens a second of audio costs.",
    status: (a) => `${+derive(a.pipe()).lmHz.toFixed(1)} tokens/s · 1 hour = ${fmtN(derive(a.pipe()).lmHz * 3600)} tokens`,
    controls: (a) => [slider({ label: "Pool", min: 1, max: 8, value: a.pipe().pool, onInput: (v) => a.setPipe({ pool: v }) })],
    draw: (a) => (g, w, h) => {
      const u = unit(h), rate = derive(a.pipe()).lmHz;
      head(g, w, h, "Context used by audio", `${+rate.toFixed(1)} tok/s`);
      ([["30 s", 30], ["10 min", 600], ["1 hour", 3600]] as [string, number][]).forEach(([lab, sec], i) => {
        const y = (24 + i * 24) * u, x0 = 22 * u, ww = w - x0 - 6 * u, frac = Math.min(1, (rate * sec) / 128000);
        g.fillStyle = "#2c3a5e"; g.fillRect(x0, y, ww, 11 * u);
        g.fillStyle = rate * sec > 128000 ? S.red : S.teal; g.fillRect(x0, y, ww * frac, 11 * u);
        screenText(g, lab, x0 - 2 * u, y + 8.5 * u, 6 * u, S.ink, "right");
        screenText(g, fmtN(rate * sec), x0 + 2 * u, y + 8.5 * u, 6 * u, frac > 0.3 ? S.bg : S.ink, "left", true);
      });
      screenText(g, "share of a 128,000-token context", 6 * u, 95 * u, 4.6 * u, S.dim);
    },
  },
  lm: {
    name: "Language model", icon: "tower", lesson: "attention",
    what: "Reads the audio tokens together with text, layer after layer. In each layer, every token decides which earlier tokens to take information from.",
    status: (a) => `${Math.ceil(a.analysis().enc.T / a.pipe().pool)} audio tokens for this sound`,
    controls: (a) => [row(button("▶ Send the sound through the machine", () => void a.flow(), "btn primary"))],
    draw: (a) => {
      let img: HTMLCanvasElement | null = null, key: unknown = null;
      return (g, w, h) => {
        const u = unit(h), an = a.analysis();
        if (key !== an.enc) { key = an.enc; img = heat(an.enc.att.map((rw) => { let m = 0; for (const v of rw) m = Math.max(m, v); return rw.map((v) => Math.sqrt(v / (m || 1))); }), an.enc.T); }
        head(g, w, h, "Who reads from whom", `${an.enc.T} tokens`);
        const side = 76 * u;
        if (img) blit(g, img, 6 * u, 16 * u, side, side, false);
        screenText(g, "row: a token asking", side + 12 * u, 30 * u, 5.4 * u, S.ink);
        screenText(g, "column: a token it reads", side + 12 * u, 42 * u, 5.4 * u, S.ink);
        screenText(g, "bright: reads a lot", side + 12 * u, 54 * u, 5.4 * u, S.teal);
      };
    },
  },
  head: {
    name: "LM head", icon: "screen", lesson: "head",
    what: "Gives every possible output a score and turns the scores into probabilities. Here the outputs are names of sounds; the scores come from this sound.",
    status: (a) => { const L = a.analysis().labels, p = softmax(L.map((l) => l.logit), headTemp), i = p.indexOf(Math.max(...p)); return `best guess: ${L[i].name} (${(p[i] * 100).toFixed(0)}%)`; },
    controls: (a) => [
      slider({ label: "Temperature", min: 0.2, max: 3, step: 0.05, value: headTemp, fmt: (v) => v.toFixed(2), onInput: (v) => (headTemp = v) }),
      row(button("▶ Pick one", () => {
        const L = a.analysis().labels, p = softmax(L.map((l) => l.logit), headTemp);
        let u = r(), i = 0; for (; i < p.length - 1; i++) { u -= p[i]; if (u <= 0) break; }
        a.log(`The head picked "${L[i].name}" (p = ${p[i].toFixed(3)}).`, "ok");
      }, "btn primary")),
    ],
    draw: (a) => (g, w, h) => {
      const u = unit(h), L = a.analysis().labels, p = softmax(L.map((l) => l.logit), headTemp);
      head(g, w, h, `What is "${a.audio.clip.name}"?`, `T = ${headTemp.toFixed(2)}`);
      const order = [...p.keys()].sort((x, y) => p[y] - p[x]), x0 = 30 * u, ww = w - x0 - 22 * u;
      order.forEach((i, k) => {
        const y = (16 + k * 11) * u;
        screenText(g, L[i].name, x0 - 2 * u, y + 6.5 * u, 5.6 * u, S.ink, "right");
        g.fillStyle = k === 0 ? S.orange : S.teal; g.fillRect(x0, y, Math.max(0.5 * u, ww * p[i]), 8 * u);
        screenText(g, `${(p[i] * 100).toFixed(1)}%`, x0 + ww * p[i] + 1.5 * u, y + 6.5 * u, 5 * u, S.dim, "left", true);
      });
    },
  },
  voice: {
    name: "Model voice", icon: "speaker", lesson: "moshi",
    what: "Plays sound the model writes. Generate new codec tokens from a small model trained on the built-in sounds, starting from this sound's first frame.",
    status: () => (generated ? `${generated.codes.length} frames generated` : "nothing generated yet"),
    controls: (a) => [row(
      button("▶ Generate 3 s and play", () => { generated = generateAudio(a.audio.clip, 1, 0.95, r); bus.glow.set("voice", 1); later(() => { a.audio.playSignal([generated!.audio()], 16000); setTimeout(() => bus.glow.delete("voice"), 3200); }); }, "btn primary"),
      button("Hear the tokens of this sound", () => later(() => a.audio.playSignal([codecDecode(a.analysis(), 8)], 16000)), "btn"),
    )],
    draw: () => (g, w, h) => {
      const u = unit(h);
      head(g, w, h, "Generated codes", generated ? `${generated.codes.length} frames` : "");
      if (!generated) { screenText(g, "press Generate", 6 * u, 50 * u, 7 * u, S.dim); return; }
      const cols = generated.columns, cw = (w - 8 * u) / cols.length, rh = 9 * u;
      cols.forEach((col, f) => col.forEach((v, rr) => { g.fillStyle = rr === 0 ? rampCss(0.55 + ((v * 0.618) % 1) * 0.4) : rampCss(0.3 + ((v * 0.37) % 1) * 0.5); g.fillRect(4 * u + f * cw + 0.2 * u, (16 + rr * 10) * u, cw - 0.4 * u, rh); }));
    },
  },
};

export const COMPONENT_HINT = (id: string) => `Click to open the ${COMPONENTS[id]?.name ?? id}`;

