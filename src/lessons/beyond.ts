import type { Lesson, Ctx, Callout } from "../types";
import { segmented, button, el } from "../ui/dom";
import { SPECIMENS } from "../audio/specimens";
import { audio, type Clip } from "../audio/engine";
import { magnitudes, stft } from "../dsp/stft";
import { melBank } from "../dsp/mel";
import { mixMono, quantize } from "../dsp/signal";
import { analyse, cached, monoAt } from "../analysis";
import { ORDER } from "../scene/stations";
import { PRESETS, getPipe } from "../pipeline";
import { S, head, unit, screenText, blit, fmtHz, fmtBits, fmtN, specHeat, freqTicks, lossyChain, melOnly, codecDecode, codecError, stages } from "./kit";
import { STATION_LESSON } from "./start";

// ---------------------------------------------------------------- 15 · what speech pipelines miss

interface Costs { hf: number; side: number; fast: number; semis: number; dom: number; speechErr: number; allErr: number }

function costs(c: Clip): Costs {
  return cached(`costs:${c.id}`, () => {
    const x = mixMono(c.channels), sr = c.sr;
    const spec = magnitudes(stft(x, sr, 2048, 1024));
    const avg = new Float32Array(1025);
    let tot = 0, hiE = 0;
    const cut = Math.floor((8000 / (sr / 2)) * 1024);
    for (const f of spec) for (let k = 0; k < f.length; k++) { const e = f[k] * f[k]; avg[k] += e; tot += e; if (k >= cut) hiE += e; }
    const k60 = Math.ceil((60 / sr) * 2048);
    let dom = k60; for (let k = k60 + 1; k < 1025; k++) if (avg[k] > avg[dom]) dom = k;
    const domHz = (dom * sr) / 2048;
    const L = c.channels[0], R = c.channels[1];
    let mid = 0, side = 0;
    for (let i = 0; i < L.length; i++) { mid += (L[i] + R[i]) ** 2; side += (L[i] - R[i]) ** 2; }
    // loudness envelope (10 ms windows every 2 ms); share of its variation faster than one 80 ms frame
    const hop = Math.round(sr * 0.002), win = Math.round(sr * 0.01);
    const env: number[] = [];
    for (let i = 0; i + win <= x.length; i += hop) { let s = 0; for (let j = i; j < i + win; j++) s += x[j] * x[j]; env.push(Math.sqrt(s / win)); }
    const W = 40, pre = [0];
    for (const v of env) pre.push(pre[pre.length - 1] + v);
    const mean = pre[pre.length - 1] / env.length;
    let vAll = 0, vFast = 0;
    env.forEach((v, i) => { const a = Math.max(0, i - W / 2), b = Math.min(env.length, i + W / 2); vAll += (v - mean) ** 2; vFast += (v - (pre[b] - pre[a]) / (b - a)) ** 2; });
    const bank = melBank(16000, 400, 80, 0, 8000);
    let semis = NaN;
    if (domHz < 8000) {
      let m = 0;
      for (let j = 0; j < 80; j++) if (Math.abs(bank.edges[j + 1] - domHz) < Math.abs(bank.edges[m + 1] - domHz)) m = j;
      semis = 12 * Math.log2((bank.edges[m + 1] + bank.edges[m + 2]) / (bank.edges[m] + bank.edges[m + 1]));
    }
    const a = analyse(c, getPipe());
    return { hf: hiE / (tot || 1), side: side / (mid + side || 1), fast: vFast / (vAll || 1), semis, dom: domHz, speechErr: codecError(a, "speech")[7], allErr: codecError(a, "all")[7] };
  });
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const beyond: Lesson = {
  id: "beyond",
  short: "Beyond speech",
  title: "What speech pipelines miss",
  chapter: "Beyond speech",
  thumb: ["source", "mic", "adc"],
  focus: ["source", "mic", "adc", "fft", "mel"],
  view: { fill: 0.86, offset: [0, 0.03] },
  callouts: [
    { at: "mic.grille", icon: "stereo", title: "Space", text: "Where sounds are. Lost when two channels become one.", slot: "tl" },
    { at: "adc.clock", icon: "rings", title: "Brightness", text: "Everything above 8 kHz. Lost at 16 kHz.", slot: "bl" },
    { at: "fft.bars", icon: "clock", title: "Timing", text: "Attacks and rhythms faster than one frame.", slot: "br" },
    { at: "mel.screen", icon: "screen", title: "Before and after", text: "The selected sound as recorded, and after a speech front end.", slot: "tr" },
  ],
  summary: "Every choice so far was tuned for speech: 16 kHz, one channel, 25 ms frames, mel bands, codebooks trained on talking. Speech survives all of it. This lesson measures, sound by sound, what the same pipeline costs everything else.",
  steps: [
    "<b>Above 8 kHz:</b> the share of the sound's energy above 8 kHz, removed when resampling to 16 kHz.",
    "<b>Stereo:</b> the share of energy that only exists as a difference between left and right. Averaging to mono cancels it.",
    "<b>Faster than 80 ms:</b> how much of the loudness pattern changes faster than one Mimi frame. Measured on a 10 ms loudness curve.",
    "<b>Band width:</b> how many semitones one of Whisper's 80 mel bands spans at the sound's strongest pitch. Over 1 means neighbouring piano notes land in the same band.",
    "<b>Speech codebooks:</b> the average error, in decibels per band, after encoding the sound with 8 codebooks trained only on speech, against 8 trained on all seven sounds.",
    "Click a row to select and play that sound, then compare the original with <b>Speech front end</b>.",
  ],
  lost: `<p>Taken together, the losses describe a system built to hear <b>words</b>:</p>
  <ul>
    <li><b>Space</b>: direction and distance, which need two or more channels and fine timing.</li>
    <li><b>Timing</b>: people notice gaps of a few milliseconds and musicians notice 10 ms timing errors; one token per 80 ms can't represent them.</li>
    <li><b>Pitch</b>: music needs semitone resolution or better across the whole range, where mel bands get coarse.</li>
    <li><b>Mixtures</b>: real scenes are several sources at once, while a codebook entry describes one blended frame.</li>
    <li><b>Non-verbal sound</b>: laughter, sighs, breath, hesitation and emotion, which speech-trained features tend to drop.</li>
  </ul>
  <p>General-audio models exist (next lesson), but most systems you can talk to are still built on speech tokens.</p>`,
  words: [
    ["Spatial audio", "Sound that carries direction and distance, recorded with two or more channels."],
    ["Transient", "A very short, sharp event: a drum hit, a click, a consonant."],
    ["Polyphony", "Several notes or sources at the same time."],
    ["Paralinguistics", "Everything about speech that isn't the words: tone, emotion, laughter, pauses."],
    ["Sound event", "A non-speech sound with a name: a door slam, a siren, a bird call."],
  ],
  specs: [
    ["Human hearing", "20 Hz – 20 kHz, 2 ears"],
    ["Gap detection", "≈ 2–5 ms"],
    ["Pitch discrimination", "≈ 0.2–1 % (under ⅙ semitone)"],
    ["Direction (straight ahead)", "≈ 1–2°"],
    ["Speech front end", "8 kHz band · mono · 10–80 ms · 80 bands"],
  ],
  code: `import numpy as np, librosa

def speech_front_end_costs(stereo, sr):
    mono = stereo.mean(0)
    S = np.abs(librosa.stft(mono, n_fft=2048)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=2048)
    above_8k = S[f >= 8000].sum() / S.sum()

    l, r = stereo
    side = np.sum((l - r) ** 2) / (np.sum((l + r) ** 2) + np.sum((l - r) ** 2))

    env = librosa.feature.rms(y=mono, frame_length=sr // 100, hop_length=sr // 500)[0]
    smooth = np.convolve(env, np.ones(40) / 40, mode="same")   # 80 ms
    fast = np.var(env - smooth) / np.var(env)
    return above_8k, side, fast`,
  rate: () => ({ value: "1.41 Mb/s", note: "CD audio, for comparison" }),
  mount(ctx) {
    let before: HTMLCanvasElement | null = null, after: HTMLCanvasElement | null = null, result: { channels: Float32Array[]; sr: number } | null = null, token = 0;
    const table = el("table", { class: "table" });
    const render = () => {
      table.innerHTML = `<tr><th>Sound</th><th>&gt;8 kHz</th><th>Stereo</th><th>&lt;80 ms</th><th>Band</th><th>Speech codebooks</th></tr>`;
      for (const s of SPECIMENS) {
        const c = costs(audio.specimen(s.id));
        const tr = el("tr", { "data-click": "1", class: audio.clip.id === s.id ? "is-on" : "" });
        tr.innerHTML = `<td>${s.name}</td><td class="${c.hf > 0.2 ? "bad" : ""}">${pct(c.hf)}</td><td class="${c.side > 0.2 ? "bad" : ""}">${pct(c.side)}</td><td class="${c.fast > 0.3 ? "bad" : ""}">${pct(c.fast)}</td><td class="${isNaN(c.semis) || c.semis > 2 ? "bad" : ""}">${isNaN(c.semis) ? "above" : c.semis.toFixed(1) + " st"}</td><td class="${c.speechErr > 6 ? "bad" : ""}">${c.speechErr.toFixed(0)} dB <span style="color:var(--faint)">vs ${c.allErr.toFixed(0)}</span></td>`;
        tr.addEventListener("click", () => { audio.useSpecimen(s.id); audio.playClip(); });
        table.append(tr);
      }
    };
    render();
    ctx.row("grid", "<b>Cost of a speech front end, per sound.</b> Red marks a large loss. Click a row to hear it. The last column is the codec's error with codebooks trained on speech, versus on all sounds.", table);
    const status = ctx.row("ear", "Compare the selected sound with what a speech front end keeps (mono, 16 kHz, no phase, 80 bands).",
      el("div", { class: "btns" }, button("▶ Speech front end", () => { if (result) audio.playSignal(result.channels, result.sr); }, "btn primary"), button("▶ Original", () => audio.playClip(), "btn")));
    const sel = async () => {
      const my = ++token;
      before = specHeat(audio.clip.channels[0], audio.clip.sr, 24000, 180);
      after = null; result = null;
      render();
      status.text("Running the speech front end…");
      await new Promise((r) => setTimeout(r, 30));
      if (my !== token) return;
      result = lossyChain(audio.clip, { mono: true, sr16: true, phase: true, mel: true, pool: false });
      after = specHeat(result.channels[0], result.sr, 24000, 180);
      const c = costs(audio.clip);
      status.text(`<b>${audio.clip.name}:</b> strongest pitch ${fmtHz(c.dom)}, ${pct(c.hf)} of its energy above 8 kHz. Compare:`);
    };
    void sel();
    ctx.onChange(() => void sel());
    ctx.screen("mel", (g, w, h) => {
      const u = unit(h);
      head(g, w, h, audio.clip.name, "recorded / kept");
      const x0 = 12 * u, ww = w - 15 * u, hh = 37 * u;
      for (const [im, y] of [[before, 14 * u], [after, 57 * u]] as const) {
        if (im) blit(g, im, x0, y, ww, hh); else screenText(g, "working…", x0 + ww / 2, y + hh / 2, 6 * u, S.dim, "center");
        freqTicks(g, x0, y, hh, 24000, u);
      }
    });
    return undefined;
  },
  run(ctx) {
    ctx.log("sound          >8 kHz  stereo  <80 ms  band     speech-codebook error");
    for (const s of SPECIMENS) {
      const c = costs(audio.specimen(s.id));
      ctx.log(`${s.name.padEnd(13)} ${pct(c.hf).padStart(6)} ${pct(c.side).padStart(7)} ${pct(c.fast).padStart(7)}  ${(isNaN(c.semis) ? "above" : c.semis.toFixed(1) + " st").padEnd(8)} ${c.speechErr.toFixed(1)} dB (all-sound codebooks: ${c.allErr.toFixed(1)} dB)`, c.hf > 0.2 || c.side > 0.2 || c.speechErr > 6 ? "warn" : "info");
    }
    ctx.log("Warnings mark sounds a speech-first pipeline describes poorly.", "ok");
  },
};

// ---------------------------------------------------------------- 16 · where the field is

interface Item { name: string; who: string; year: number; kind: "speech" | "general" | "classic" | "semantic" | "model"; hz?: number; kbps?: number; sr?: string; note: string }

const ITEMS: Item[] = [
  { name: "MP3", who: "Fraunhofer / MPEG", year: 1993, kind: "classic", hz: 38.3, kbps: 128, sr: "44.1 kHz", note: "A hand-designed codec: 1,152-sample frames, dropping what masking hides from human ears. Not tokens, but a reference point for transparent music." },
  { name: "Opus", who: "IETF", year: 2012, kind: "classic", hz: 50, kbps: 6, sr: "8–48 kHz", note: "The codec in most video calls: 20 ms frames, 6 to 510 kb/s. At 6 kb/s it carries narrow-band speech; good music needs 64 kb/s or more." },
  { name: "HuBERT units", who: "Meta", year: 2021, kind: "semantic", hz: 50, kbps: 0.45, sr: "16 kHz", note: "k-means (about 500 entries) on HuBERT features. Pure content: turning them back into a voice needs a separate vocoder. Used in early spoken language models." },
  { name: "SoundStream", who: "Google", year: 2021, kind: "general", hz: 75, kbps: 6, sr: "24 kHz", note: "The first widely used neural RVQ codec, 3 to 18 kb/s. Its tokens are the acoustic layer of AudioLM." },
  { name: "EnCodec", who: "Meta", year: 2022, kind: "general", hz: 75, kbps: 6, sr: "24 / 48 kHz", note: "Open RVQ codec with up to 32 codebooks of 1,024 (1.5 to 24 kb/s). Used by MusicGen and many speech synthesisers; a 48 kHz stereo music version exists." },
  { name: "DAC", who: "Descript", year: 2023, kind: "general", hz: 86, kbps: 7.7, sr: "44.1 kHz", note: "Improved RVQ codec: 9 codebooks of 1,024 at 86 frames per second, full-band audio for speech, music and sound effects." },
  { name: "SpeechTokenizer", who: "Fudan University", year: 2023, kind: "speech", hz: 50, kbps: 4, sr: "16 kHz", note: "RVQ codec whose first codebook is distilled from HuBERT: the semantic-first idea Mimi also uses. 8 codebooks of 1,024 at 50 per second." },
  { name: "Mimi", who: "Kyutai", year: 2024, kind: "speech", hz: 12.5, kbps: 1.1, sr: "24 kHz", note: "12.5 frames per second, 8 codebooks of 2,048, split RVQ with WavLM distillation, fully causal. The tokenizer of Moshi, also used by Sesame's CSM." },
  { name: "WavTokenizer", who: "Zhejiang University et al.", year: 2024, kind: "general", hz: 40, kbps: 0.48, sr: "24 kHz", note: "A single codebook of 4,096 at 40 or 75 tokens per second, so one token per step: simple for a language model to predict." },
  { name: "SNAC", who: "Hubert Siuzdak", year: 2024, kind: "speech", hz: 47, kbps: 0.98, sr: "24 kHz", note: "Multi-scale RVQ: coarse codebooks tick slowly (about 12 per second), fine ones faster (about 47). 0.98 kb/s for speech; music versions too." },
];

const MODELS: Item[] = [
  { name: "Whisper", who: "OpenAI", year: 2022, kind: "model", note: "Log-mel encoder plus text decoder, trained on 680,000 hours of transcribed web audio (large-v3: about 5 million hours, mostly machine-labelled). Its encoder feeds many audio language models." },
  { name: "wav2vec 2.0 · HuBERT · WavLM", who: "Meta, Microsoft", year: 2020, kind: "model", note: "Self-supervised speech encoders that learn from unlabelled 16 kHz audio by predicting masked parts. 50 vectors per second. WavLM is Mimi's teacher." },
  { name: "BEATs · AudioMAE", who: "Microsoft, Meta", year: 2022, kind: "model", note: "General-audio encoders trained on AudioSet by treating the spectrogram as an image cut into patches. They respond to dogs, engines and music as well as words." },
  { name: "CLAP", who: "LAION, Microsoft", year: 2022, kind: "model", note: "Matches audio and text in one vector space (like CLIP for images). Used for zero-shot sound classification and search." },
  { name: "AudioLM", who: "Google", year: 2022, kind: "model", note: "Language model over two token layers, semantic (w2v-BERT) then acoustic (SoundStream). Continues speech or piano in the same voice or style." },
  { name: "SALMONN", who: "Tsinghua, ByteDance", year: 2023, kind: "model", note: "Whisper and BEATs encoders → window Q-Former → Vicuna. One of the first models to handle speech, sounds and music together." },
  { name: "Qwen2-Audio · Qwen2.5-Omni", who: "Alibaba", year: 2024, kind: "model", note: "Whisper-large-v3 encoder pooled to 25 tokens per second into a Qwen language model. Omni adds a separate \"talker\" that streams speech out." },
  { name: "Moshi", who: "Kyutai", year: 2024, kind: "model", note: "Full-duplex speech model: Mimi tokens for both sides plus time-aligned text on a 7B backbone. Open weights." },
  { name: "GPT-4o · Gemini", who: "OpenAI, Google", year: 2024, kind: "model", note: "Production assistants with audio in and out. Their architectures and tokenizers are not published." },
  { name: "CSM", who: "Sesame", year: 2025, kind: "model", note: "Conversational speech generation: a Llama-style backbone predicts Mimi's first codebook and a small decoder fills in the rest." },
];

const COL: Record<Item["kind"], string> = { speech: S.teal, general: S.orange, classic: "#8f99b3", semantic: "#f3ead8", model: S.teal };

export const field: Lesson = {
  id: "field",
  short: "The field today",
  title: "Where the field is",
  chapter: "Beyond speech",
  thumb: ["tokens", "lm"],
  focus: ["lm", "head", "voice"],
  view: { fill: 0.8 },
  callouts: [],
  summary: "Codecs and tokenizers decide what a model can hear and say. The map plots them by <b>frames per second</b> (how many steps a model must take per second of audio) and <b>bits per second</b> (how much detail survives). Click any name for details, then read the open problems under <i>How it works</i>.",
  steps: [
    "<b>One tokenizer for everything.</b> Keep speech, music and environmental sound at a low frame rate without music turning to mush.",
    "<b>Space.</b> Almost every model on the map is mono. Multichannel and binaural audio models are early research.",
    "<b>Mixtures.</b> Represent several overlapping sources, rather than one blended frame.",
    "<b>Time.</b> Fit hours of audio in context while keeping millisecond timing.",
    "<b>Beyond words.</b> Keep and use emotion, emphasis, laughter and hesitation, both when listening and when speaking.",
    "<b>Evaluation.</b> Benchmarks such as MMAU and AIR-Bench show reasoning about sound and music well behind transcription.",
  ],
  lost: `<p>The whole course in one list:</p><ul>
    <li><b>Microphone:</b> direction, extremes, very quiet sounds</li>
    <li><b>ADC:</b> everything above half the sample rate, detail below the bit depth</li>
    <li><b>Front end:</b> stereo, above 8 kHz, phase, fine pitch</li>
    <li><b>Encoder:</b> whatever its training didn't reward</li>
    <li><b>Tokens:</b> everything between codebook entries</li>
    <li><b>Projector:</b> timing finer than one token, context</li>
    <li><b>Language model and head:</b> whatever the answer doesn't need</li>
  </ul><p>None of these steps is a mistake. Each one reflects what the system was built to care about.</p>`,
  words: [
    ["Tokenizer", "Whatever turns audio into the tokens a model reads: a codec, or k-means on encoder features."],
    ["Semantic tokens", "Tokens that capture what was said (from a self-supervised encoder)."],
    ["Acoustic tokens", "Tokens that capture how it sounded (from a codec trained to rebuild audio)."],
    ["Audio language model", "A language model that reads, and sometimes writes, audio tokens."],
  ],
  specs: [
    ["Lowest frame rate here", "Mimi, 12.5 / s"],
    ["One token per step", "WavTokenizer"],
    ["Full-band neural codec", "DAC, 44.1 kHz"],
    ["Semantic-first codebooks", "SpeechTokenizer, Mimi"],
    ["Open full-duplex model", "Moshi (2024)"],
  ],
  code: `# The same sound through three different "ears"
import whisper
from transformers import MimiModel, ClapModel, ClapProcessor

text = whisper.load_model("turbo").transcribe("clip.wav")["text"]

mimi = MimiModel.from_pretrained("kyutai/mimi")
codes = mimi.encode(wav_24k[None, None]).audio_codes          # (1, 8, frames)

clap = ClapModel.from_pretrained("laion/clap-htsat-unfused")
proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
vec = clap.get_audio_features(**proc(audios=wav_48k, sampling_rate=48000, return_tensors="pt"))
print(text, codes.shape, vec.shape)            # words, tokens, one 512-number vector`,
  rate: () => ({ value: "0.45 – 128 kb/s", note: "HuBERT units to MP3" }),
  mount(ctx: Ctx) {
    let sel: Item = ITEMS[7];
    const detail = ctx.row("book", "");
    const show = (it: Item) => { sel = it; detail.text(`<b>${it.name}</b> · ${it.who} · ${it.year}${it.hz ? ` · ${it.hz} frames/s · ${it.kbps} kb/s · ${it.sr}` : ""}<br>${it.note}`); };
    const chips = (list: Item[]) => {
      const box = el("div", { class: "btns" });
      for (const it of list) { const b = button(it.name, () => show(it), "btn"); box.append(b); }
      return box;
    };
    ctx.row("map", "<b>Codecs and tokenizers</b> (on the map):", chips(ITEMS));
    ctx.row("tower", "<b>Models that use them:</b>", chips(MODELS));
    show(sel);
    ctx.screen("head", (g, w, h) => {
      const u = unit(h);
      head(g, w, h, "Codecs: frames/s vs kb/s", "log scales");
      const x0 = 12 * u, y0 = 14 * u, ww = w - 18 * u, hh = 70 * u;
      const lx = (hz: number) => x0 + ((Math.log10(hz) - Math.log10(8)) / (Math.log10(120) - Math.log10(8))) * ww;
      const ly = (k: number) => y0 + hh - ((Math.log10(k) - Math.log10(0.3)) / (Math.log10(200) - Math.log10(0.3))) * hh;
      g.strokeStyle = S.grid; g.lineWidth = 0.3 * u;
      for (const hz of [10, 25, 50, 100]) { g.beginPath(); g.moveTo(lx(hz), y0); g.lineTo(lx(hz), y0 + hh); g.stroke(); screenText(g, String(hz), lx(hz), y0 + hh + 5 * u, 3.8 * u, S.dim, "center", true); }
      for (const k of [1, 10, 100]) { g.beginPath(); g.moveTo(x0, ly(k)); g.lineTo(x0 + ww, ly(k)); g.stroke(); screenText(g, `${k}k`, x0 - 1 * u, ly(k) + 1.4 * u, 3.8 * u, S.dim, "right", true); }
      g.fillStyle = "#1aa3a122"; g.fillRect(lx(9), ly(1.6), lx(30) - lx(9), ly(0.35) - ly(1.6));
      screenText(g, "cheap for a language model", lx(9) + 1 * u, ly(0.35) - 1.5 * u, 3.6 * u, S.teal);
      // labels nudged so the two points at 75 / s and 6 kb/s don't overlap
      const nudge: Record<string, [number, number]> = { SoundStream: [2, -2.4], EnCodec: [2, 4.6], Opus: [-2, -1.6], SpeechTokenizer: [-2, 4.2], "HuBERT units": [2, 4.6], WavTokenizer: [-2, 1.4], SNAC: [2, 1.4] };
      for (const it of ITEMS) {
        const x = lx(it.hz!), y = ly(it.kbps!), on = it === sel;
        g.fillStyle = COL[it.kind]; g.beginPath(); g.arc(x, y, (on ? 1.9 : 1.3) * u, 0, 7); g.fill();
        if (on) { g.strokeStyle = S.ink; g.lineWidth = 0.4 * u; g.stroke(); }
        const [dx, dy] = nudge[it.name] ?? [2, 1.4];
        screenText(g, it.name, x + (dx < 0 ? -2 : dx) * u, y + dy * u, (on ? 4.4 : 3.8) * u, on ? S.ink : S.dim, dx < 0 ? "right" : "left");
      }
      const leg: [string, string][] = [["speech", S.teal], ["general audio", S.orange], ["semantic units", "#f3ead8"], ["classic", "#8f99b3"]];
      leg.forEach(([t, c], i) => { g.fillStyle = c; g.fillRect(x0 + i * 22 * u, 94 * u, 2 * u, 2 * u); screenText(g, t, x0 + i * 22 * u + 3 * u, 96 * u, 3.6 * u, S.dim); });
    });
    return undefined;
  },
  run(ctx) {
    ctx.log("codec            frames/s   kb/s   frames per minute");
    for (const it of [...ITEMS].sort((a, b) => a.kbps! - b.kbps!)) ctx.log(`${it.name.padEnd(16)} ${String(it.hz).padStart(8)} ${String(it.kbps).padStart(6)}   ${fmtN(it.hz! * 60).padStart(6)}`, it.kind === "speech" ? "ok" : it.kind === "classic" ? "dim" : "info");
    ctx.log(`Your ${ctx.audio.duration.toFixed(1)} s sound: ${Math.round(ctx.audio.duration * 12.5)} Mimi frames, ${Math.round(ctx.audio.duration * 75)} EnCodec frames.`, "head");
  },
};

// ---------------------------------------------------------------- 17 · your voice, end to end

export const journey: Lesson = {
  id: "journey",
  short: "Your voice, end to end",
  title: "Your voice, end to end",
  chapter: "Beyond speech",
  thumb: ["mic", "adc", "mel"],
  focus: ORDER,
  view: { fill: 0.94, yaw: 22 },
  callouts: [],
  summary: "Record a few seconds of yourself and follow the recording through every station, using the settings you chose in earlier lessons (or a preset). The table shows exactly what each station holds. Click a row to fly there, and listen to what's left at each point.",
  steps: [
    "Press <b>Record</b> and speak for 4 seconds, or keep a built-in sound.",
    "Press <b>Play the journey</b>. The camera visits each station in order while your sound plays, and the cards show your sound's real numbers at that point.",
    "Read the table from top to bottom: the shape grows (more numbers per second at the encoder) even as the detail about the sound shrinks.",
    "Use the <b>Listen</b> buttons to hear the sound after the ADC, after the mel bands, and after the codec tokens.",
    "Change the preset and play it again. <i>Telephone</i> shows how much an 8 kHz, 8-bit front end removes before any model sees the sound.",
  ],
  lost: `<p>Everything from the previous sixteen lessons, applied to your own sound. Compare the <b>Listen</b> buttons: each step after the ADC keeps less of what made the recording sound like you, and more of what was said.</p>`,
  words: [
    ["Shape", "How many numbers a representation has, e.g. 400 × 80 is 400 frames of 80 bands."],
    ["Preset", "A set of pipeline settings matching a real system."],
  ],
  specs: Object.values(PRESETS).map((p) => [p.label, p.note] as [string, string]),
  code: `import numpy as np, sounddevice as sd, whisper

x = sd.rec(4 * 16000, samplerate=16000, channels=1)[:, 0]; sd.wait()
print("ADC        ", x.shape)                               # (64000,)
mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(x))
print("log-mel    ", tuple(mel.shape))                      # (80, 3000)
m = whisper.load_model("base")
h = m.encoder(mel[None])
print("encoder    ", tuple(h.shape))                        # (1, 1500, 512)
print("text       ", m.transcribe(x)["text"])`,
  rate: (p) => ({ value: fmtBits(p.sr * p.bits), note: "at the ADC, with your settings" }),
  mount(ctx) {
    const setTags = (lit: string[] = []) => ctx.setTags(ORDER.filter((id) => id !== "voice").map((id, i) => ({ station: id, num: i + 1, label: stages(ctx.analysis(), ctx.pipe())[i]?.name ?? id, lit: lit.includes(id), onClick: () => ctx.go(STATION_LESSON[id]) })));
    setTags();
    ctx.row("mic", "<b>Record yourself</b> for 4 seconds. Every station switches to your recording.",
      button("● Record 4 seconds", async () => { try { ctx.log("Recording…", "info"); await ctx.audio.record(4); ctx.log("Recorded.", "ok"); } catch { ctx.log("The microphone isn't available.", "warn"); } }, "btn teal big"));
    const tour = async () => {
      const a = ctx.analysis(), st = stages(a, ctx.pipe());
      ctx.setTags([]);
      await ctx.flow({
        tour: true, per: 1.5,
        onStation: (id, i) => {
          const s = st[i];
          const c: Callout = { at: `${id}.${id === "source" ? "cone" : id === "mic" ? "grille" : id === "adc" ? "chip" : id === "fft" ? "bars" : id === "mel" ? "paper" : id === "encoder" ? "layers" : id === "tokens" ? "tiles" : id === "projector" ? "mlp" : id === "lm" ? "mid" : "screen"}`, icon: "target", title: `${i + 1}. ${s.name}`, text: `Holds ${s.holds}: ${s.shape}. Lost here: ${s.gone}.`, slot: "tl", value: () => `${s.perSec} per second · ${fmtBits(s.bps)}` };
          ctx.callouts([c]);
          trace.querySelectorAll("tr").forEach((tr, k) => tr.classList.toggle("is-on", k === i + 1));
        },
      });
      ctx.callouts([]);
      setTags();
      ctx.focus(ORDER, { fill: 0.94, yaw: 22 });
    };
    ctx.row("play", "<b>Play the journey.</b> The camera visits every station while the sound plays.", button("▶ Play the journey", () => void tour(), "btn primary big"));
    ctx.row("knob", "<b>Presets</b> set every station at once to match a real system.",
      segmented("Preset", Object.entries(PRESETS).map(([k, p]) => [k, p.label] as [string, string]), "whisper", (v) => ctx.setPipe(PRESETS[v].pipe)));
    const trace = el("table", { class: "table" });
    const render = () => {
      const a = ctx.analysis(), st = stages(a, ctx.pipe());
      trace.innerHTML = `<tr><th>Station</th><th>Shape</th><th>Per second</th><th>Bits/s</th></tr>`;
      st.forEach((s) => {
        const tr = el("tr", { "data-click": "1" });
        tr.innerHTML = `<td>${s.name}</td><td>${s.shape}</td><td>${s.perSec}</td><td>${fmtBits(s.bps)}</td>`;
        tr.addEventListener("click", () => ctx.focus([s.station], { fill: 0.42 }));
        trace.append(tr);
      });
      setTags();
    };
    render();
    ctx.onChange(render);
    ctx.row("grid", "<b>What each station holds</b> for the current sound and settings. Click a row to fly to that station.", trace);
    const p = () => ctx.pipe();
    ctx.row("ear", "<b>Listen at each stage.</b>",
      el("div", { class: "btns" },
        button("Original", () => ctx.audio.playClip(), "btn"),
        button("After ADC", () => { const a = ctx.analysis(); ctx.audio.playSignal([quantize(monoAt(a.clip, p().sr), p().bits)], p().sr); }, "btn"),
        button("After mel bands", () => { const a = ctx.analysis(); setTimeout(() => ctx.audio.playSignal([melOnly(a.x, p().sr, p().nMels, a.clip.id)], p().sr), 30); }, "btn"),
        button("After tokens", () => setTimeout(() => ctx.audio.playSignal([codecDecode(ctx.analysis(), 8)], 16000), 30), "btn")));
    const sDur = ctx.stat("Length"), sS = ctx.stat("Samples"), sM = ctx.stat("Mel numbers"), sL = ctx.stat("LM tokens");
    const stats = () => {
      const a = ctx.analysis();
      sDur.set(`${(a.clip.channels[0].length / a.clip.sr).toFixed(1)} s`);
      sS.set(fmtN(a.x.length));
      sM.set(fmtN(a.mel.frames.length * p().nMels));
      sL.set(fmtN(Math.ceil(a.enc.T / p().pool)));
    };
    stats();
    ctx.onChange(stats);
    return () => ctx.setTags([]);
  },
  run(ctx) {
    const a = ctx.analysis(), p = ctx.pipe();
    ctx.log(`"${a.clip.name}" · ${p.sr / 1000} kHz · ${p.bits}-bit · ${p.winMs}/${p.hopMs} ms · ${p.nMels} bands · stride ${p.encStride} · pool ${p.pool}`, "head");
    for (const s of stages(a, p)) ctx.log(`${s.name.padEnd(15)} ${s.shape.padEnd(28)} ${s.perSec.padEnd(16)} ${fmtBits(s.bps)}`);
    ctx.log("Bits per second rise at the encoder (more numbers) while detail about the sound keeps falling.", "ok");
  },
};
