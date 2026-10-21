import type { Lesson } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, slider, button, controls, toggle, fmtBits, nextFrame, wave } from "../ui/dom";
import { stat } from "./capture";
import { toyCodec, toyDecode } from "./shared";

// ---------------------------------------------------------------- 13 · Mimi

const MIMI_BLOCKS: [string, string, string][] = [
  ["24 kHz", "waveform", "#e9dcca"],
  ["SEANet", "conv encoder · ×1920", "#d8efec"],
  ["Transformer", "8 layers · causal", "#d8efec"],
  ["Split RVQ", "1 semantic + 7 acoustic", "#18213d"],
  ["Decoder", "transformer + SEANet", "#d8efec"],
  ["24 kHz", "waveform", "#e9dcca"],
];

export const mimi: Lesson = {
  id: "mimi",
  title: "Mimi: a codec built for a speaking LM",
  chapter: "Codecs",
  blurb: "Kyutai's Mimi squeezes 24 kHz speech into 8 integers every 80 ms, and makes the first integer carry meaning, so one model can both understand and generate.",
  rail: [5, 6],
  rate: { value: "1.1 kb/s", note: "12.5 Hz × 8 × 11 bits" },
  tabs: {
    overview: `
      <p class="lead"><b>Mimi</b> (Kyutai, 2024) is a <b>neural audio codec</b>: an encoder turns audio into tokens, and a decoder turns tokens back into audio. It was built as the tokenizer for <b>Moshi</b>.</p>
      <p>Three choices set it apart:</p>
      <ul>
        <li><b>Very low frame rate:</b> <b>12.5 Hz</b>, one frame per 80 ms, compared with EnCodec's 75 Hz. Fewer steps per second makes it practical for a 7B LM to generate.</li>
        <li><b>Semantic + acoustic in one:</b> the first codebook is trained to match <b>WavLM</b> features (distillation), so it carries phonetic content. The other 7 carry voice, timbre and detail.</li>
        <li><b>Fully causal and streaming:</b> encoder and decoder only look backwards, so it runs live with 80 ms latency.</li>
      </ul>
      <p>The grid shows 8 codebooks over time for your clip. Fewer codebooks means a lower bitrate and coarser sound.</p>`,
    hood: `
      <p><b>Encoder:</b> a SEANet convolutional stack downsamples 24 kHz by 4·5·6·8 = 960 (→ 25 Hz), a strided conv halves that to 12.5 Hz, and an 8-layer causal transformer refines the 512-d latents.</p>
      <p><b>Split RVQ:</b> a plain VQ for the semantic codebook and, in parallel, a 7-level RVQ for acoustics. Their outputs are <i>summed</i>. Keeping them parallel stops the acoustic levels from also having to carry semantics. Each codebook has 2,048 entries (11 bits).</p>
      <p><b>Training:</b> adversarial and feature-matching losses only, no reconstruction loss. It sounds natural rather than matching the waveform sample for sample. A cosine loss pulls the first codebook toward non-causal WavLM features.</p>
      <p><b>On this page:</b> the grid and the playback use this site's toy k-means codec on your clip (Lesson 9), sampled every 80 ms. The real Mimi needs its trained weights (<code>kyutai/mimi</code> on Hugging Face).</p>`,
    lost: `
      <p class="lostline"><b>Anything that isn't speech-like.</b> Mimi was trained on Moshi's audio data: millions of hours, overwhelmingly English speech. Music, environmental sound and overlapping sources were rare, so the codebooks have few good entries for them.</p>
      <p class="lostline"><b>Above 12 kHz:</b> 24 kHz sampling means a 12 kHz ceiling. Better than 16 kHz models, still below hearing.</p>
      <p class="lostline"><b>Mono:</b> a single channel.</p>
      <p class="lostline"><b>Exact waveform:</b> trained adversarially, it can produce a <i>different but plausible</i> signal, which is fine for a voice and not always for a sound you need to measure.</p>`,
    specs: [
      ["Sample rate", "24 kHz, mono"],
      ["Frame rate", "12.5 Hz (80 ms, 1920 samples)"],
      ["Latent", "512-d"],
      ["Codebooks", "8 used by Moshi (1 sem + 7 ac), up to 32"],
      ["Codebook size", "2048 (11 bits)"],
      ["Bitrate", "12.5 × 8 × 11 = 1.1 kb/s"],
      ["Teacher", "WavLM (semantic distillation)"],
      ["Latency", "80 ms frame, fully causal"],
    ],
  },
  code: `import torch
from transformers import MimiModel, AutoFeatureExtractor

model = MimiModel.from_pretrained("kyutai/mimi")
fe = AutoFeatureExtractor.from_pretrained("kyutai/mimi")

inputs = fe(raw_audio=wav_24k, sampling_rate=24000, return_tensors="pt")
codes = model.encode(inputs["input_values"], num_quantizers=8).audio_codes
print(codes.shape)            # (1, 8, T)   T = seconds * 12.5
print(codes[0, :, :6])        # row 0 = semantic, rows 1-7 = acoustic

audio = model.decode(codes).audio_values   # back to 24 kHz`,
  mount(ctx) {
    const { root, audio } = ctx;
    let nQ = 8;
    const pA = el("div", { class: "panel", style: "flex:0.8" }, el("span", { class: "panel-title" }, "Inside Mimi"));
    const pG = el("div", { class: "panel", style: "flex:1.2" }, el("span", { class: "panel-title" }, "Tokens for your clip · 12.5 frames / s"));
    root.append(pA, pG);
    const sRate = stat("Bitrate"), sRatio = stat("vs 24 kHz 16-bit"), sTok = stat("Tokens for clip"), sFrame = stat("Frame");
    const qS = slider({ label: "Codebooks", min: 1, max: 8, value: nQ, onInput: (v) => (nQ = v) });
    root.append(controls(qS,
      button("▶ Hear toy decode", async () => { ctx.log(`Toy codec: ${nQ} codebook(s), Griffin-Lim decode…`, "dim"); await nextFrame(); audio.playSignal([toyDecode(toyCodec(audio, 64), nQ)], 16000); }, "btn primary"),
      button("▶ Original", () => audio.playClip(), "btn")), el("div", { class: "stat-row" }, sRate, sRatio, sTok, sFrame));
    const A = surface(pA), G = surface(pG);
    const stop = loop((t) => {
      // architecture
      {
        const { g, w, h } = A;
        g.clearRect(0, 0, w, h);
        const n = MIMI_BLOCKS.length, gap = 10;
        const bw = (w - 28 - gap * (n - 1)) / n, bh = Math.min(70, h - 56), y = 32 + (h - 40 - bh) / 2;
        MIMI_BLOCKS.forEach(([name, sub, col], i) => {
          const x = 14 + i * (bw + gap);
          roundRect(g, x, y, bw, bh, 8); g.fillStyle = col; g.fill();
          g.strokeStyle = i === 3 ? PALETTE.navy : PALETTE.line; g.lineWidth = 1.5; g.stroke();
          const dark = i === 3;
          label(g, name, x + bw / 2, y + bh / 2 - 2, { align: "center", size: bw < 90 ? 11.5 : 13.5, color: dark ? "#fdf8ef" : PALETTE.navy, weight: 700 });
          label(g, sub, x + bw / 2, y + bh / 2 + 14, { align: "center", size: bw < 90 ? 9 : 10.5, color: dark ? "#9aa3bd" : PALETTE.muted, weight: 500 });
          if (i < n - 1) {
            const ax = x + bw + 1, ay = y + bh / 2;
            g.strokeStyle = PALETTE.line; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + gap - 2, ay); g.stroke();
            const u = (t * 0.7 + i * 0.17) % 1;
            g.fillStyle = PALETTE.teal; g.beginPath(); g.arc(ax + u * (gap - 2), ay, 2.2, 0, 7); g.fill();
          }
          if (i === 3) {
            label(g, "WavLM →", x + bw / 2, y - 8, { align: "center", size: 10.5, color: PALETTE.rust, weight: 700 });
            label(g, "these integers are what Moshi reads and writes", x + bw / 2, y + bh + 16, { align: "center", size: 10.5, color: PALETTE.tealDeep, weight: 600 });
          }
        });
      }
      // token grid
      {
        const { g, w, h } = G;
        g.clearRect(0, 0, w, h);
        const c = toyCodec(audio, 64);
        const T = Math.max(1, Math.floor(audio.duration * 12.5));
        const x0 = 92, y0 = 30, ww = w - x0 - 12, rows = 8;
        const rh = Math.min(26, (h - y0 - 56) / rows);
        const cw = ww / T;
        const p = audio.position();
        const cur = p >= 0 && audio.playing ? Math.floor(p * 12.5) : -1;
        for (let r = 0; r < rows; r++) {
          const y = y0 + r * rh;
          label(g, r === 0 ? "semantic" : `acoustic ${r}`, x0 - 8, y + rh / 2 + 4, { align: "right", size: 10.5, color: r === 0 ? PALETTE.rust : PALETTE.muted, weight: 600 });
          for (let f = 0; f < T; f++) {
            const code = c.q.codes[Math.min(r, c.q.codes.length - 1)][Math.min(c.q.codes[0].length - 1, f * 10)] * 32 + ((f * 7 + r * 13) % 32);
            const used = r < nQ;
            roundRect(g, x0 + f * cw + 1, y + 1, cw - 2, rh - 3, 3);
            g.fillStyle = !used ? "#efe3d1" : r === 0 ? `hsl(${(code * 0.17) % 40 + 20}, 70%, ${40 + (code % 9) * 3}%)` : `hsl(${175 + (code % 30)}, ${35 + (code % 40)}%, ${30 + ((code >> 3) % 40)}%)`;
            g.globalAlpha = used ? (cur === f ? 1 : 0.85) : 0.6;
            g.fill();
            g.globalAlpha = 1;
            if (cw > 30 && used) label(g, String(code), x0 + f * cw + cw / 2, y + rh / 2 + 3, { align: "center", size: 9, mono: true, color: "#fdf8ef", weight: 500 });
          }
        }
        if (cur >= 0 && cur < T) { g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.strokeRect(x0 + cur * cw, y0 - 2, cw, rows * rh + 2); }
        const wy = y0 + rows * rh + 6;
        const x = audio.mono(16000);
        wave(g, x, x0, wy, ww, h - wy - 6, PALETTE.trace, 1, 0, x.length, 1.3);
        label(g, "80 ms →", x0, h - 4, { size: 10, color: PALETTE.faint, weight: 600 });
      }
      const bps = 12.5 * nQ * 11;
      sRate.set(fmtBits(bps));
      sRatio.set(`${Math.round((24000 * 16) / bps)}× smaller`);
      sTok.set(`${Math.floor(audio.duration * 12.5)} × ${nQ}`);
      sFrame.set("80 ms");
    });
    return () => { stop(); A.dispose(); G.dispose(); };
  },
  run(ctx) {
    const d = ctx.audio.duration;
    ctx.log(`your clip ${d.toFixed(2)} s @ 24 kHz = ${Math.round(d * 24000).toLocaleString()} samples`);
    ctx.log(`SEANet strides 4·5·6·8 = 960 → ${(24000 / 960).toFixed(1)} Hz, conv stride 2 → 12.5 Hz`);
    ctx.log(`codes shape (1, 8, ${Math.floor(d * 12.5)})  →  ${Math.floor(d * 12.5) * 8} integers in [0, 2048)`);
    for (const q of [1, 2, 4, 8, 16, 32]) ctx.log(`  ${String(q).padStart(2)} codebooks → ${fmtBits(12.5 * q * 11).padStart(9)}`, q === 8 ? "ok" : "dim");
    ctx.log("Moshi uses 8: 1.1 kb/s, about 350× less than 16-bit PCM at 24 kHz.", "ok");
  },
};

// ---------------------------------------------------------------- 14 · Moshi

type Seg = { from: number; to: number; text: string[] };
const USER: Seg[] = [{ from: 1, to: 17, text: ["hey", "Moshi", "what's", "the", "weather", "like?"] }, { from: 30, to: 36, text: ["oh", "nice"] }];
const MOSHI: Seg[] = [{ from: 8, to: 10, text: ["mhm"] }, { from: 19, to: 32, text: ["it's", "sunny", "and", "about", "twenty", "degrees", "today"] }, { from: 37, to: 42, text: ["yeah!"] }];
const STEPS = 46;

const activeAt = (segs: Seg[], s: number) => segs.find((x) => s >= x.from && s < x.to);
const wordAt = (seg: Seg, s: number) => { const i = Math.floor(((s - seg.from) / (seg.to - seg.from)) * seg.text.length); return (s - seg.from) % Math.max(1, Math.floor((seg.to - seg.from) / seg.text.length)) === 0 ? seg.text[i] : ""; };

export const moshi: Lesson = {
  id: "moshi",
  title: "Moshi: listening and talking at once",
  chapter: "Codecs",
  blurb: "Moshi models both sides of a conversation as parallel token streams, 12.5 times a second. It can interrupt, back-channel and answer about 200 ms after you stop talking.",
  rail: [6, 7, 8, 9],
  rate: { value: "2.3 kb/s", note: "2 × Mimi + inner-monologue text" },
  tabs: {
    overview: `
      <p class="lead">Most voice assistants take turns: wait for silence, transcribe, think in text, speak with TTS. <b>Moshi</b> (Kyutai, 2024) is <b>full-duplex</b>. It hears and speaks at the same time, all the time.</p>
      <p>Every 80 ms step, the model has <b>17 tokens</b> in flight:</p>
      <ul>
        <li><b>8 Mimi codes for the user</b>, streamed in from the mic.</li>
        <li><b>8 Mimi codes for Moshi</b>, which it predicts.</li>
        <li><b>1 text token</b>, Moshi's own words time-aligned with its speech. Kyutai call this the <b>Inner Monologue</b>.</li>
      </ul>
      <p>Silence is just tokens too, so it can say "mhm" while you talk, or start before you finish. Press <b>Play</b> and watch the streams fill in.</p>`,
    hood: `
      <p>Predicting 17 tokens per step with one big transformer would be slow, so Moshi splits the work in two (an <b>RQ-Transformer</b>):</p>
      <ul>
        <li>The <b>Temporal Transformer</b> is <b>Helium</b>, a 7B text LM. It runs once per step over time, reading the summed embeddings of the last step's tokens.</li>
        <li>A small <b>Depth Transformer</b> takes its output and predicts that step's tokens <i>one after another</i>: text, then semantic, then acoustic 1…7, each conditioned on the ones before.</li>
      </ul>
      <p><b>Acoustic delay:</b> acoustic codes are predicted 1–2 steps <i>after</i> the semantic code of the same frame, so the model settles <i>what</i> before <i>how it sounds</i>. Toggle it to see the offset.</p>
      <p><b>Latency:</b> 80 ms (one Mimi frame) + 80 ms (delay) = <b>160 ms</b> in theory, about <b>200 ms</b> in practice on an L4 GPU. Human turn-taking gaps are about 200 ms.</p>`,
    lost: `
      <p class="lostline"><b>Everything Mimi loses</b> (previous lesson), on both channels: the user's audio reaches the LM only as Mimi tokens trained on speech.</p>
      <p class="lostline"><b>The acoustic scene.</b> Moshi was trained on conversations, synthetic and real. A dog barking or music in the background is either ignored or treated as noise.</p>
      <p class="lostline"><b>Depth of reasoning.</b> At 12.5 steps per second, everything has to happen in real time. Many current systems trade some of Moshi's speed back for quality by mixing in text-only reasoning steps.</p>`,
    specs: [
      ["Temporal model", "Helium 7B (text LM backbone)"],
      ["Depth model", "small transformer, per-step"],
      ["Streams", "1 text + 8 Moshi + 8 user"],
      ["Step", "80 ms (12.5 Hz)"],
      ["Acoustic delay", "1–2 steps"],
      ["Latency", "160 ms theory · ≈ 200 ms real"],
      ["Release", "Sept 2024, open weights (CC-BY 4.0)"],
    ],
  },
  code: `# pip install moshi   ·   python -m moshi.server   (then open the web UI)
from huggingface_hub import hf_hub_download
from moshi.models import loaders, LMGen
import torch

mimi = loaders.get_mimi(hf_hub_download(loaders.DEFAULT_REPO, loaders.MIMI_NAME))
mimi.set_num_codebooks(8)
moshi = loaders.get_moshi_lm(hf_hub_download(loaders.DEFAULT_REPO, loaders.MOSHI_NAME))
gen   = LMGen(moshi, temp=0.8, temp_text=0.7)

with torch.no_grad(), gen.streaming(1), mimi.streaming(1):
    for chunk in mic_chunks(1920):              # 80 ms @ 24 kHz
        codes = mimi.encode(chunk)              # (1, 8, 1) user tokens
        out = gen.step(codes)                   # (1, 1 + 8, 1) text + Moshi
        if out is not None:
            speaker.play(mimi.decode(out[:, 1:]))`,
  mount(ctx) {
    const { root } = ctx;
    let playing = true, s = 0, acc = 0, delay = true, depthPhase = 0;
    const p = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Token streams · one column = 80 ms"));
    root.append(p);
    const sStep = stat("Step"), sT = stat("Time"), sState = stat("Moshi is"), sLat = stat("Response gap");
    const playB = button("❚❚ Pause", () => { playing = !playing; playB.textContent = playing ? "❚❚ Pause" : "▶ Play"; }, "btn primary");
    root.append(controls(playB, button("Step ›", () => { playing = false; playB.textContent = "▶ Play"; s = (s + 1) % STEPS; depthPhase = 0; }, "btn"), button("↺ Restart", () => { s = 0; depthPhase = 0; }, "btn"), toggle("Acoustic delay", delay, (v) => (delay = v))),
      el("div", { class: "stat-row" }, sStep, sT, sState, sLat));
    const S = surface(p);
    const stop = loop((_t, dt) => {
      if (playing) { acc += dt; depthPhase = Math.min(1, depthPhase + dt * 2.2); if (acc > 0.45) { acc = 0; s = (s + 1) % STEPS; depthPhase = 0; } }
      const { g, w, h } = S;
      g.clearRect(0, 0, w, h);
      const lab = 104, x0 = lab, ww = w - lab - 14;
      const vis = Math.min(STEPS, Math.max(14, Math.floor(ww / 26)));
      const start = Math.max(0, Math.min(STEPS - vis, s - Math.floor(vis * 0.7)));
      const cw = ww / vis;
      const rows: { name: string; kind: "text" | "msem" | "mac" | "usem" | "uac"; y: number; h: number }[] = [];
      const top = 30, rh = Math.max(9, Math.min(15, (h - 150) / 18));
      let y = top;
      rows.push({ name: "Moshi text", kind: "text", y, h: rh * 1.8 }); y += rh * 1.8 + 6;
      rows.push({ name: "Moshi semantic", kind: "msem", y, h: rh }); y += rh + 2;
      rows.push({ name: "Moshi acoustic ×7", kind: "mac", y, h: rh * 7 }); y += rh * 7 + 12;
      rows.push({ name: "User semantic", kind: "usem", y, h: rh }); y += rh + 2;
      rows.push({ name: "User acoustic ×7", kind: "uac", y, h: rh * 7 }); y += rh * 7;
      const D = delay ? 1 : 0;
      for (const r of rows) {
        label(g, r.name, lab - 8, r.y + Math.min(r.h, 14) - 2, { align: "right", size: 10.5, color: r.kind.startsWith("u") ? PALETTE.muted : r.kind === "text" ? PALETTE.rust : PALETTE.tealDeep, weight: 600 });
        for (let i = 0; i < vis; i++) {
          const step = start + i;
          const future = step > s;
          const x = x0 + i * cw;
          if (r.kind === "text") {
            const seg = activeAt(MOSHI, step);
            const wd = seg ? wordAt(seg, step) : "";
            roundRect(g, x + 1, r.y, cw - 2, r.h, 4);
            g.fillStyle = future ? "#f3ebdd" : wd ? "#f6dcc0" : "#efe3d1"; g.fill();
            if (!future) label(g, wd || "·", x + cw / 2, r.y + r.h / 2 + 4, { align: "center", size: wd.length > 4 ? 9 : 10.5, mono: !wd, color: wd ? PALETTE.rust : PALETTE.faint, weight: 600 });
            continue;
          }
          const isUser = r.kind.startsWith("u");
          const src = activeAt(isUser ? USER : MOSHI, step - (r.kind === "mac" ? D : 0));
          const n = r.kind === "mac" || r.kind === "uac" ? 7 : 1;
          for (let k = 0; k < n; k++) {
            const cy = r.y + (k * r.h) / n;
            const pending = !isUser && step === s && ((r.kind === "msem" && depthPhase < 0.2) || (r.kind === "mac" && depthPhase < 0.2 + (k + 1) * 0.1));
            g.fillStyle = future || pending ? "#f3ebdd" : src ? (isUser ? `hsl(220, 22%, ${45 + ((step * 7 + k * 11) % 25)}%)` : `hsl(${178 + ((step * 5 + k * 9) % 18)}, 55%, ${30 + ((step * 13 + k * 7) % 30)}%)`) : "#e2d7c7";
            g.fillRect(x + 1, cy, cw - 2, r.h / n - 1);
          }
        }
      }
      // cursor + depth transformer
      const cx = x0 + (s - start) * cw;
      g.strokeStyle = PALETTE.orange; g.lineWidth = 2;
      g.strokeRect(cx, top - 4, cw, rows[2].y + rows[2].h - top + 8);
      const by = y + 18;
      const tw = Math.min(ww, 520);
      roundRect(g, x0, by, tw * 0.62, 34, 7); g.fillStyle = PALETTE.navy; g.fill();
      label(g, "Temporal Transformer · Helium 7B · once per step", x0 + 10, by + 21, { size: 11.5, color: "#fdf8ef", weight: 600 });
      roundRect(g, x0 + tw * 0.62 + 8, by, tw * 0.38 - 8, 34, 7); g.fillStyle = PALETTE.teal; g.fill();
      label(g, `Depth → ${depthPhase < 0.2 ? "text" : depthPhase < 0.3 ? "semantic" : `acoustic ${Math.min(7, Math.ceil((depthPhase - 0.2) / 0.1) - 1)}`}`, x0 + tw * 0.62 + 18, by + 21, { size: 11.5, color: "#fdf8ef", weight: 600 });
      g.strokeStyle = PALETTE.orange; g.setLineDash([3, 3]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx + cw / 2, rows[4].y + rows[4].h + 2); g.lineTo(cx + cw / 2, by); g.stroke(); g.setLineDash([]);
      const user = activeAt(USER, s), mo = activeAt(MOSHI, s);
      sStep.set(`${s} / ${STEPS}`);
      sT.set(`${(s * 0.08).toFixed(2)} s`);
      sState.set(mo && user ? "back-channelling" : mo ? "speaking" : user ? "listening" : "silent");
      sLat.set(`${((MOSHI[1].from - USER[0].to) * 80)} ms`);
    });
    return () => { stop(); S.dispose(); };
  },
  run(ctx) {
    const d = ctx.audio.duration;
    const steps = Math.floor(d * 12.5);
    ctx.log(`your clip as the user's side: ${steps} steps × 8 codes = ${steps * 8} user tokens`);
    ctx.log(`Moshi fills the same ${steps} steps with 1 text + 8 audio tokens: ${steps * 9} predictions`);
    ctx.log(`Temporal Transformer calls: ${steps}  ·  Depth Transformer calls: ${steps * 9}`);
    ctx.log(`real-time budget per step: 80 ms. Theoretical latency 80 + 80 = 160 ms.`, "ok");
  },
};
