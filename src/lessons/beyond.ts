import type { Lesson } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, button, controls, nextFrame, fmtHz } from "../ui/dom";
import { SPECIMENS } from "../audio/specimens";
import { magnitudes, stft } from "../dsp/stft";
import { melBank } from "../dsp/mel";
import { mixMono } from "../dsp/signal";
import { cached, specImage, drawImage, freqAxis, lossyChain } from "./shared";
import type { Clip } from "../audio/engine";

// ---------------------------------------------------------------- what a speech front end costs each sound

interface Costs { hf: number; side: number; fast: number; semis: number; dom: number; }

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
    // loudness envelope (10 ms RMS every 2 ms, which smooths away pitch periods);
    // how much of its variation is faster than one 80 ms frame?
    const hop = Math.round(sr * 0.002), win = Math.round(sr * 0.01);
    const env: number[] = [];
    for (let i = 0; i + win <= x.length; i += hop) { let s = 0; for (let j = i; j < i + win; j++) s += x[j] * x[j]; env.push(Math.sqrt(s / win)); }
    const W = 40;
    const pre = [0]; for (const v of env) pre.push(pre[pre.length - 1] + v);
    let vAll = 0, vFast = 0;
    const mean = pre[pre.length - 1] / env.length;
    env.forEach((v, i) => { const a = Math.max(0, i - W / 2), b = Math.min(env.length, i + W / 2); const sm = (pre[b] - pre[a]) / (b - a); vAll += (v - mean) ** 2; vFast += (v - sm) ** 2; });
    const bank = melBank(16000, 512, 80, 0, 8000);
    let semis = NaN;
    if (domHz < 8000) {
      let m = 0; for (let j = 0; j < 80; j++) if (Math.abs(bank.edges[j + 1] - domHz) < Math.abs(bank.edges[m + 1] - domHz)) m = j;
      // half-maximum width of the triangle around its centre
      semis = 12 * Math.log2((bank.edges[m + 1] + bank.edges[m + 2]) / (bank.edges[m] + bank.edges[m + 1]));
    }
    return { hf: hiE / (tot || 1), side: side / (mid + side || 1), fast: vFast / (vAll || 1), semis, dom: domHz };
  });
}

const AXES: { key: keyof Costs; name: string; fmt: (c: Costs) => string; frac: (c: Costs) => number; why: string }[] = [
  { key: "hf", name: "Above 8 kHz", fmt: (c) => `${(c.hf * 100).toFixed(0)}%`, frac: (c) => c.hf, why: "energy a 16 kHz model never receives" },
  { key: "side", name: "Stereo", fmt: (c) => `${(c.side * 100).toFixed(0)}%`, frac: (c) => Math.min(1, c.side * 2), why: "energy only in the L−R difference, gone in mono" },
  { key: "fast", name: "Faster than 80 ms", fmt: (c) => `${(c.fast * 100).toFixed(0)}%`, frac: (c) => c.fast, why: "loudness changes that fall inside one Mimi frame" },
  { key: "semis", name: "Mel band width", fmt: (c) => (isNaN(c.semis) ? "cut" : `${c.semis.toFixed(1)} st`), frac: (c) => (isNaN(c.semis) ? 1 : Math.min(1, c.semis / 12)), why: "semitones per band at the strongest pitch" },
];

export const richer: Lesson = {
  id: "richer",
  title: "Sound is more than speech",
  chapter: "Beyond speech",
  blurb: "A speech pipeline is tuned to keep words. Run birdsong, drums, rain and a piano through it and measure what each one loses.",
  rail: [1, 2, 3, 4, 5, 6],
  rate: { value: "1.41 Mb/s", note: "CD audio, for comparison" },
  tabs: {
    overview: `
      <p class="lead">Every choice so far was tuned for speech: 16 kHz, mono, 25 ms frames, mel bands, a speech-trained codebook, transcripts as the target. Speech survives that. A lot of other sound doesn't.</p>
      <p>Each row measures, <b>on that actual sound</b>, four costs of a speech front end:</p>
      <ul>
        <li><b>Above 8 kHz</b>: energy cut by resampling to 16 kHz.</li>
        <li><b>Stereo</b>: energy that only exists as a left/right difference.</li>
        <li><b>Faster than 80 ms</b>: loudness changes inside a single 12.5 Hz frame.</li>
        <li><b>Mel band width</b>: how many semitones one mel band spans at the sound's main pitch. Above 1 means neighbouring notes merge.</li>
      </ul>
      <p>Click a row, then compare the original with what a speech front end keeps. The Vowels barely change. The others don't come through as well.</p>`,
    hood: `
      <p>What hearing uses that speech models mostly don't:</p>
      <ul>
        <li><b>Space</b>: interaural time and level differences locate a sound to within a few degrees. Mono can't represent any of it.</li>
        <li><b>Timing</b>: people hear gaps of a few milliseconds; musicians care about 10 ms timing errors. One token per 80 ms can't line up a flam.</li>
        <li><b>Pitch</b>: music needs semitone (6 %) resolution or better across the whole range, where mel resolution gets coarse.</li>
        <li><b>Mixtures</b>: real scenes are many sources at once (a voice over music over traffic), and one codebook entry per frame has to describe all of them.</li>
        <li><b>Paralinguistics</b>: laughter, sighs, breath, hesitation, emotion. Tokenizers distilled from ASR-style features tend to drop these.</li>
      </ul>`,
    lost: `
      <p class="lead">This is the lesson about what's lost.</p>
      <p>Most of the losses were reasonable on their own. Together, they describe a system that hears <b>words</b>, not <b>sound</b>.</p>
      <p>General audio models do exist, such as BEATs and AudioMAE encoders, CLAP embeddings, DAC and EnCodec codecs at 32–44.1 kHz, and LLMs with general-audio encoders. But the speaking, real-time systems (the ones you talk to) are still built mostly on speech tokens.</p>
      <p>That's the open problem. The next lesson maps where things stand.</p>`,
    specs: [
      ["Hearing", "20 Hz – 20 kHz · 2 ears"],
      ["Temporal acuity", "gaps of ≈ 2–5 ms"],
      ["Pitch acuity", "≈ 0.2–1 % (< ⅙ semitone)"],
      ["Localisation", "≈ 1–2° in front"],
      ["Speech front end", "8 kHz · mono · 10–80 ms · mel"],
    ],
  },
  code: `import numpy as np, librosa

def speech_front_end_costs(stereo, sr):
    mono = stereo.mean(0)
    S = np.abs(librosa.stft(mono, n_fft=2048)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=2048)
    above_8k = S[f >= 8000].sum() / S.sum()
    side = ((stereo[0] - stereo[1]) ** 2).sum()
    stereo_share = side / (side + ((stereo[0] + stereo[1]) ** 2).sum())
    env = librosa.feature.rms(y=mono, hop_length=sr // 1000)[0]
    smooth = np.convolve(env, np.ones(80) / 80, "same")   # 80 ms
    fast = np.var(env - smooth) / np.var(env)
    return above_8k, stereo_share, fast`,
  mount(ctx) {
    const { root, audio } = ctx;
    const grid = el("div", { class: "cost-table", role: "table" });
    grid.append(el("div", { class: "cost-row cost-head", role: "row" }, el("span", {}, "Sound"), ...AXES.map((ax) => el("span", { title: ax.why }, ax.name))));
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const pa = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "Original"));
    const pb = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "After a speech front end"));
    row.append(pa, pb);
    root.append(grid, row);
    const status = el("span", { class: "legend" });
    root.append(controls(button("▶ Original", () => audio.playClip(), "btn"), button("▶ Speech front end", () => { if (result) audio.playSignal(result.channels, result.sr); }, "btn primary"), status));
    const A = surface(pa), B = surface(pb);
    let imA: HTMLCanvasElement | null = null, imB: HTMLCanvasElement | null = null, result: { channels: Float32Array[]; sr: number } | null = null;
    const cards = new Map<string, HTMLElement>();
    for (const s of SPECIMENS) {
      const c = costs(audio.specimen(s.id));
      const r = el("button", { type: "button", class: "cost-row", role: "row", title: `Play ${s.name}` }, el("b", {}, s.name));
      for (const ax of AXES) {
        const f = Math.max(0.02, ax.frac(c));
        r.append(el("span", { class: "cost-cell", title: ax.why },
          el("i", { style: `background:linear-gradient(90deg,${f > 0.3 ? "var(--red)" : "var(--teal)"} ${f * 100}%,var(--track) ${f * 100}%)` }),
          el("em", {}, ax.fmt(c))));
      }
      r.addEventListener("click", () => { audio.useSpecimen(s.id); audio.playClip(); });
      cards.set(s.id, r);
      grid.append(r);
    }
    let token = 0;
    async function select() {
      cards.forEach((c, id) => c.classList.toggle("is-on", id === audio.clip.id));
      imA = specImage(audio.clip.channels[0], audio.clip.sr, 24000, 200);
      imB = null; result = null;
      const my = ++token;
      status.textContent = "running the speech front end…";
      await nextFrame();
      if (my !== token) return;
      const r = lossyChain(audio.clip, { mono: true, sr16: true, phase: true, mel: true, pool: false });
      if (my !== token) return;
      result = r;
      imB = specImage(r.channels[0], r.sr, 24000, 200);
      const c = costs(audio.clip);
      status.textContent = `strongest pitch ${fmtHz(c.dom)} · ${(c.hf * 100).toFixed(0)}% of energy above 8 kHz`;
    }
    void select();
    const off = audio.on(() => { if (!cards.get(audio.clip.id)?.classList.contains("is-on")) void select(); });
    const stop = loop(() => {
      for (const [S, im] of [[A, imA], [B, imB]] as const) {
        const { g, w, h } = S;
        g.clearRect(0, 0, w, h);
        const x0 = 38, y0 = 34, ww = w - 46, hh = h - 42;
        if (im) drawImage(g, im, x0, y0, ww, hh);
        else label(g, "computing…", x0 + ww / 2, y0 + hh / 2, { align: "center", size: 12, color: PALETTE.faint });
        freqAxis(g, x0, y0, hh, 24000);
        const p = audio.position();
        if (p >= 0 && audio.playing) { g.fillStyle = PALETTE.orange; g.fillRect(x0 + (p / audio.duration) * ww - 1, y0, 2, hh); }
      }
    });
    return () => { stop(); off(); A.dispose(); B.dispose(); };
  },
  run(ctx) {
    ctx.log("sound         >8kHz  stereo  <80ms  mel-band");
    for (const s of SPECIMENS) {
      const c = costs(ctx.audio.specimen(s.id));
      ctx.log(`${s.name.padEnd(12)}  ${AXES.map((a) => a.fmt(c).padStart(6)).join("  ")}`, c.hf > 0.3 || c.side > 0.2 || c.fast > 0.3 ? "warn" : "info");
    }
    const c = costs(ctx.audio.clip);
    if (ctx.audio.clip.source !== "specimen") ctx.log(`${ctx.audio.clip.name.padEnd(12)}  ${AXES.map((a) => a.fmt(c).padStart(6)).join("  ")}`, "head");
    ctx.log("Red rows: sounds a speech-first pipeline represents badly.", "ok");
  },
};

// ---------------------------------------------------------------- 16 · landscape

interface Codec { name: string; org: string; year: number; hz: number; kbps: number; sr: string; kind: "speech" | "general" | "classic" | "semantic"; note: string; }
const CODECS: Codec[] = [
  { name: "MP3", org: "Fraunhofer / MPEG", year: 1993, hz: 38.3, kbps: 128, sr: "44.1 kHz", kind: "classic", note: "Hand-designed psychoacoustic codec: 1152-sample frames, drops what masking hides. Not tokens, but a useful reference for 'transparent' music." },
  { name: "Opus", org: "IETF", year: 2012, hz: 50, kbps: 6, sr: "8–48 kHz", kind: "classic", note: "The codec in your video calls: 20 ms frames, 6–510 kb/s. At 6 kb/s it's narrowband speech; good music needs ~64 kb/s+." },
  { name: "SoundStream", org: "Google", year: 2021, hz: 75, kbps: 6, sr: "24 kHz", kind: "general", note: "First widely used neural RVQ codec: conv encoder (stride 320), RVQ, adversarial training. 3–18 kb/s with quantizer dropout. Basis of AudioLM's acoustic tokens." },
  { name: "EnCodec", org: "Meta", year: 2022, hz: 75, kbps: 6, sr: "24 / 48 kHz", kind: "general", note: "Open RVQ codec: up to 32 codebooks × 1024, 1.5–24 kb/s. Used by MusicGen and many TTS systems. A 48 kHz stereo music variant exists." },
  { name: "DAC", org: "Descript", year: 2023, hz: 86, kbps: 7.7, sr: "44.1 kHz", kind: "general", note: "Improved RVQ codec (factorised, L2-normalised codes, snake activations): 9 × 1024 at 86 Hz, full-band 44.1 kHz for speech, music and sound." },
  { name: "SpeechTokenizer", org: "Fudan", year: 2023, hz: 50, kbps: 4, sr: "16 kHz", kind: "speech", note: "RVQ codec whose first codebook is distilled from HuBERT, the same idea Mimi uses: semantic first, acoustic after. 8 × 1024 at 50 Hz." },
  { name: "Mimi", org: "Kyutai", year: 2024, hz: 12.5, kbps: 1.1, sr: "24 kHz", kind: "speech", note: "12.5 Hz, 8 × 2048, split RVQ with WavLM distillation, causal and streaming. Tokenizer for Moshi; also used by Sesame's CSM." },
  { name: "WavTokenizer", org: "Zhejiang U. et al.", year: 2024, hz: 40, kbps: 0.48, sr: "24 kHz", kind: "general", note: "A single codebook of 4096 at 40 or 75 tokens/s: one token per step, which makes LM modelling simple. Trained on speech, music and audio." },
  { name: "SNAC", org: "Hubert Siuzdak", year: 2024, hz: 47, kbps: 0.98, sr: "24 / 32 / 44 kHz", kind: "speech", note: "Multi-scale RVQ: coarse codebooks tick slower (≈12 Hz) and fine ones faster (≈47 Hz). Speech model at 0.98 kb/s; music variants too." },
  { name: "HuBERT units", org: "Meta", year: 2021, hz: 50, kbps: 0.45, sr: "16 kHz", kind: "semantic", note: "k-means (K≈500) on HuBERT features. Pure content: you need a separate vocoder and speaker info to get a voice back. Used in GSLM, SpeechGPT, many S2ST systems." },
];

const MODELS: [string, string, string][] = [
  ["Whisper", "OpenAI · 2022", "Log-mel encoder-decoder trained on 680k h of web transcripts. Default ASR front end; its encoder feeds many audio-LMs."],
  ["wav2vec 2.0 · HuBERT · WavLM", "Meta / Microsoft · 2020–21", "Self-supervised speech encoders on raw 16 kHz audio, 50 Hz. WavLM is Mimi's semantic teacher."],
  ["BEATs · AudioMAE", "Microsoft / Meta · 2022", "General audio encoders trained on AudioSet spectrogram patches. Hear dogs, engines, music genres, not just words."],
  ["CLAP", "LAION / Microsoft · 2022–23", "Contrastive audio–text embeddings (like CLIP). Zero-shot sound classification and retrieval."],
  ["AudioLM", "Google · 2022", "Hierarchical token LM: semantic tokens (w2v-BERT) then acoustic tokens (SoundStream). Continues speech or piano in the same voice/style."],
  ["SALMONN", "Tsinghua / ByteDance · 2023", "Whisper + BEATs encoders → window-level Q-Former → Vicuna. Speech, sound and music understanding in one LM."],
  ["Qwen2-Audio · Qwen2.5-Omni", "Alibaba · 2024–25", "Whisper-large-v3 encoder (pooled to 25 Hz) into Qwen. Omni adds a 'Thinker–Talker' split to stream speech out."],
  ["Moshi", "Kyutai · 2024", "Full-duplex speech LM: Mimi tokens for both speakers + inner-monologue text on a 7B Helium backbone. Open weights."],
  ["GPT-4o · Gemini", "OpenAI / Google · 2024–", "Native audio in and out in production assistants. Architectures and tokenizers aren't public."],
  ["CSM", "Sesame · 2025", "Conversational speech generation: a Llama-style backbone predicting Mimi codes, with a small decoder for the later codebooks."],
];

const KIND_COL: Record<Codec["kind"], string> = { speech: PALETTE.teal, general: PALETTE.orange, classic: PALETTE.faint, semantic: PALETTE.navy };

export const landscape: Lesson = {
  id: "landscape",
  title: "The landscape",
  chapter: "Beyond speech",
  blurb: "Where today's audio representations sit, from hand-built codecs to neural tokenizers and the models that read them. Click anything for details.",
  rail: [5, 6, 7, 8, 9],
  rate: { value: "0.45 – 128 kb/s", note: "from HuBERT units to MP3" },
  tabs: {
    overview: `
      <p class="lead">The map plots codecs and tokenizers by <b>tokens per second</b> (frames) against <b>bits per second</b>. Down and left is cheaper for a language model; up and right keeps more sound.</p>
      <p>Colour shows what each was built for: <b style="color:#157f7d">speech</b>, <b style="color:#c0652d">general audio</b>, <b style="color:#18213d">semantic units</b>, and <b style="color:#8d8a85">classical codecs</b> for reference.</p>
      <p>The cards below are the models that <i>use</i> these representations: encoders, audio-LMs and speech-to-speech systems.</p>
      <p>The trend since 2021 is toward fewer tokens per second and more meaning per token. The open question is whether that can work for <b>all</b> sound, not just speech.</p>`,
    hood: `
      <h3>Open problems</h3>
      <ul>
        <li><b>One tokenizer for everything:</b> speech, music and environmental sound at low frame rates without the music turning to mush.</li>
        <li><b>Space:</b> almost every model above is mono. Multichannel and binaural audio LMs are early research.</li>
        <li><b>Mixtures:</b> representing several overlapping sources, rather than one blended frame.</li>
        <li><b>Time:</b> hours-long audio in context, and millisecond-accurate timing inside it.</li>
        <li><b>Paralinguistics:</b> keeping and using emotion, emphasis, laughter and hesitation, on input and on output.</li>
        <li><b>Evaluation:</b> benchmarks like MMAU and AIR-Bench show sound and music reasoning far behind transcription.</li>
      </ul>`,
    lost: `
      <p>The whole course in one list:</p>
      <ul>
        <li class="lostline"><b>Mic:</b> direction, extremes, quiet</li>
        <li class="lostline"><b>ADC:</b> above Nyquist, below the noise floor</li>
        <li class="lostline"><b>Front end:</b> stereo, above 8 kHz, phase, fine pitch</li>
        <li class="lostline"><b>Encoder:</b> whatever the objective didn't need</li>
        <li class="lostline"><b>Tokens:</b> everything between codewords</li>
        <li class="lostline"><b>Projector:</b> timing detail, context budget</li>
        <li class="lostline"><b>LM + head:</b> anything the answer doesn't ask for</li>
      </ul>
      <p>None of these steps is wrong. They show what the system was designed to care about.</p>`,
    specs: [
      ["Lowest frame rate", "Mimi · 12.5 Hz"],
      ["Single-codebook", "WavTokenizer · 40–75 Hz"],
      ["Full-band neural", "DAC · 44.1 kHz"],
      ["Semantic-first RVQ", "SpeechTokenizer, Mimi"],
      ["Full-duplex open", "Moshi (2024)"],
    ],
  },
  code: `# The same clip through three different "ears"
import whisper, torch
from transformers import MimiModel, ClapModel, ClapProcessor

text  = whisper.load_model("turbo").transcribe("clip.wav")["text"]

mimi  = MimiModel.from_pretrained("kyutai/mimi")
codes = mimi.encode(wav_24k[None, None]).audio_codes      # (1, 8, T)

clap  = ClapModel.from_pretrained("laion/clap-htsat-unfused")
proc  = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
emb   = clap.get_audio_features(**proc(audios=wav_48k, sampling_rate=48000,
                                       return_tensors="pt"))
print(text, codes.shape, emb.shape)   # words, tokens, one 512-d vector`,
  mount(ctx) {
    const { root } = ctx;
    let sel: string | null = "Mimi";
    const row = el("div", { class: "viz-row", style: "flex:1.3" });
    const p = el("div", { class: "panel", style: "flex:1.6" }, el("span", { class: "panel-title" }, "Codecs & tokenizers · frames/s vs bits/s (log–log)"));
    const detail = el("div", { class: "callout", style: "flex:1;overflow:auto" });
    row.append(p, detail);
    const grid = el("div", { class: "card-grid", style: "flex:1" });
    root.append(row, grid);
    const showDetail = (name: string) => {
      const c = CODECS.find((x) => x.name === name);
      const m = MODELS.find((x) => x[0] === name);
      if (c) detail.innerHTML = `<span class="pill${c.kind === "general" ? " warn" : ""}">${c.kind}</span><h3 style="margin:6px 0 2px;font-family:var(--cond);color:var(--navy);font-size:20px">${c.name}</h3><div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">${c.org} · ${c.year} · ${c.sr}</div><div style="font-family:var(--mono);font-size:12px;color:var(--navy);margin-bottom:8px">${c.hz} frames/s · ${c.kbps} kb/s</div>${c.note}`;
      else if (m) detail.innerHTML = `<span class="pill">model</span><h3 style="margin:6px 0 2px;font-family:var(--cond);color:var(--navy);font-size:20px">${m[0]}</h3><div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">${m[1]}</div>${m[2]}`;
    };
    for (const [name, who, desc] of MODELS) {
      const b = el("button", { type: "button", class: "mcard" }, el("span", { class: "tagline" }, who), el("b", {}, name), el("small", {}, desc.split(". ")[0] + "."));
      b.addEventListener("click", () => { sel = name; grid.querySelectorAll(".mcard").forEach((x) => x.classList.toggle("is-on", x === b)); showDetail(name); });
      grid.append(b);
    }
    showDetail("Mimi");
    const S = surface(p);
    const hits: { x: number; y: number; name: string }[] = [];
    let hover: string | null = null;
    S.canvas.addEventListener("pointermove", (e) => {
      const r = S.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      hover = hits.find((h) => Math.hypot(h.x - mx, h.y - my) < 14)?.name ?? null;
      S.canvas.style.cursor = hover ? "pointer" : "default";
    });
    S.canvas.addEventListener("click", () => { if (hover) { sel = hover; showDetail(hover); grid.querySelectorAll(".mcard").forEach((x) => x.classList.remove("is-on")); } });
    const stop = loop(() => {
      const { g, w, h } = S;
      g.clearRect(0, 0, w, h);
      const x0 = 46, y0 = 30, ww = w - 64, hh = h - 64;
      const lx = (hz: number) => x0 + ((Math.log10(hz) - Math.log10(8)) / (Math.log10(120) - Math.log10(8))) * ww;
      const ly = (k: number) => y0 + hh - ((Math.log10(k) - Math.log10(0.3)) / (Math.log10(200) - Math.log10(0.3))) * hh;
      g.strokeStyle = PALETTE.lineSoft; g.lineWidth = 1;
      for (const hz of [10, 12.5, 25, 50, 75, 100]) { const x = lx(hz); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + hh); g.stroke(); label(g, String(hz), x, y0 + hh + 14, { align: "center", size: 10, mono: true, color: PALETTE.faint, weight: 400 }); }
      for (const k of [0.5, 1, 2, 5, 10, 20, 50, 100]) { const y = ly(k); g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + ww, y); g.stroke(); label(g, `${k}k`, x0 - 6, y + 3, { align: "right", size: 10, mono: true, color: PALETTE.faint, weight: 400 }); }
      label(g, "frames per second →", x0 + ww, y0 + hh + 30, { align: "right", size: 10.5, color: PALETTE.muted, weight: 600 });
      label(g, "↑ bits per second", x0 - 6, y0 - 10, { size: 10.5, color: PALETTE.muted, weight: 600 });
      // speech-LM sweet spot
      g.fillStyle = "#1aa3a114"; roundRect(g, lx(9), ly(1.6), lx(30) - lx(9), ly(0.35) - ly(1.6), 10); g.fill();
      label(g, "cheap for an LM", lx(9) + 6, ly(0.35) - 6, { size: 10, color: PALETTE.tealDeep, weight: 600 });
      hits.length = 0;
      for (const c of CODECS) {
        const x = lx(c.hz), y = ly(c.kbps);
        hits.push({ x, y, name: c.name });
        const on = sel === c.name || hover === c.name;
        g.fillStyle = KIND_COL[c.kind];
        g.beginPath(); g.arc(x, y, on ? 8 : 6, 0, 7); g.fill();
        if (on) { g.strokeStyle = PALETTE.navy; g.lineWidth = 2; g.stroke(); }
        label(g, c.name, x + 10, y + 4, { size: 11.5, color: PALETTE.navy, weight: on ? 700 : 600 });
      }
    });
    return () => { stop(); S.dispose(); };
  },
  run(ctx) {
    ctx.log("codec            Hz      kb/s    tokens per minute");
    for (const c of [...CODECS].sort((a, b) => a.kbps - b.kbps)) ctx.log(`${c.name.padEnd(15)} ${String(c.hz).padStart(5)}  ${String(c.kbps).padStart(7)}    ${Math.round(c.hz * 60).toLocaleString().padStart(6)} frames`, c.kind === "speech" ? "ok" : c.kind === "classic" ? "dim" : "info");
    ctx.log(`Your ${ctx.audio.duration.toFixed(1)} s clip = ${Math.round(ctx.audio.duration * 12.5)} Mimi frames, ${Math.round(ctx.audio.duration * 75)} EnCodec frames.`, "head");
  },
};
