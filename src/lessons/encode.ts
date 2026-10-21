import type { Lesson } from "../types";
import { slider, segmented, button, el } from "../ui/dom";
import { bus } from "../scene/bus";
import { derive } from "../pipeline";
import { layerImage, codecCodes, CODEC_K } from "../analysis";
import { S, head, unit, screenText, heat, blit, fmtBits, fmtN, codecError, codecDecode } from "./kit";

// ---------------------------------------------------------------- 8 · encoder

export const encoder: Lesson = {
  id: "encoder",
  short: "Encoder",
  title: "The encoder",
  chapter: "Encode",
  thumb: ["encoder"],
  focus: ["encoder"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "encoder.conv", icon: "layers", title: "Convolution layers", text: "Each output looks at 3 neighbouring frames across all bands. The second layer moves 2 frames at a time.", slot: "bl" },
    { at: "encoder.layers", icon: "arcs", title: "Attention blocks", text: "Every frame gathers information from every other frame. Whisper large has 32 of these.", slot: "tl" },
    { at: "encoder.top", icon: "grid", title: "Plates show your sound", text: "Each plate is this sound's activations after that layer: time across, features down.", slot: "tr" },
    { at: "encoder.screen", icon: "screen", title: "Attention map", text: "Row = a frame asking. Column = a frame it's listening to. Bright = strong.", slot: "tc" },
  ],
  summary: "The encoder is a neural network that reads the log-mel picture and writes a new description of the sound: one list of numbers (a <b>vector</b>) every 20 ms. Each vector describes what's happening around that moment, informed by the rest of the clip. Whisper's encoder does this with 2 convolution layers followed by 32 attention layers.",
  steps: [
    "Input: the log-mel picture from lesson 6. Whisper always uses exactly 30 seconds, padding with silence or cutting, so it's 80 bands × 3,000 frames.",
    "<b>Convolution 1.</b> A small filter 3 frames wide slides along time. Whisper large has 1,280 such filters, so each frame becomes 1,280 numbers. A <b>GELU</b> step then keeps positive values and squashes negative ones toward zero.",
    "<b>Convolution 2.</b> The same again, but with <b>stride 2</b>: the filter jumps 2 frames at a time, halving the rate from 100 to 50 vectors per second (1,500 for 30 s).",
    "Add <b>position information</b>, a fixed pattern of sine and cosine waves, so later layers can tell frames apart by where they are.",
    "<b>Attention blocks.</b> Each vector compares itself with every other one, takes a weighted average of the ones it matches best, then goes through a small network (an MLP). After 32 blocks, a vector's meaning depends on its context.",
    "Output: 1,500 vectors of 1,280 numbers. A language model reads these through a projector (lesson 10); Whisper's own text decoder reads them directly.",
    "<b>On this page</b> the arithmetic is the same and runs on your sound, at a smaller width (48 features). The weights are random numbers rather than trained ones, and attention compares frames directly. So frames that <i>sound</i> alike attend to each other. Training teaches a real encoder to group frames that <i>mean</i> alike.",
  ],
  lost: `<ul>
    <li><b>Whatever the training didn't reward.</b> Whisper learned to produce transcripts, so its later layers keep what predicts words and let go of speaker identity, emotion, music and background.</li>
    <li><b>Detail faster than 20 ms</b>, since there's one vector per 20 ms.</li>
    <li><b>Context beyond 30 seconds.</b> Longer audio is cut into 30-second pieces that are encoded separately.</li>
  </ul>
  <p>Studies that probe trained speech encoders find a pattern: early layers stay close to the raw sound, middle layers carry phonetic and speaker information, and late layers specialise toward the training goal. Which layer you read from matters.</p>`,
  words: [
    ["Neural network", "A long chain of multiply-and-add steps whose numbers (weights) are tuned on examples."],
    ["Weights", "The learned numbers inside a network. Whisper large has about 1.55 billion."],
    ["Vector", "An ordered list of numbers. Here, one per 20 ms of audio."],
    ["Convolution", "Sliding a small filter along the input and computing a weighted sum at each position."],
    ["Stride", "How far the filter jumps each step. Stride 2 halves the number of outputs."],
    ["GELU", "A smooth function that keeps positive numbers and pushes negatives toward zero."],
    ["Attention", "Each position takes a weighted average of other positions, weighted by how well they match."],
    ["Self-supervised", "Trained without labels, e.g. by predicting hidden parts of the input (wav2vec 2.0, HuBERT, WavLM)."],
  ],
  specs: [
    ["Whisper large-v3 input", "128 bands × 3,000 frames"],
    ["Conv layers", "kernel 3, ×2, second has stride 2"],
    ["Width · depth", "1,280 features · 32 blocks"],
    ["Output", "1,500 vectors per 30 s (50 / s)"],
    ["Encoder size", "≈ 635 M weights"],
    ["wav2vec 2.0 / HuBERT", "raw 16 kHz audio → 7 convs (×320) → 50 / s"],
    ["On this page", "48 features, seeded random weights"],
  ],
  code: `import torch, whisper

model = whisper.load_model("large-v3")
audio = whisper.pad_or_trim(whisper.load_audio("clip.wav"))   # exactly 30 s
mel = whisper.log_mel_spectrogram(audio, n_mels=128)          # (128, 3000)

with torch.no_grad():
    enc = model.encoder
    x = torch.nn.functional.gelu(enc.conv1(mel[None]))       # (1, 1280, 3000)
    x = torch.nn.functional.gelu(enc.conv2(x))               # (1, 1280, 1500) stride 2
    h = enc(mel[None])                                        # all 32 blocks
print(h.shape)                                                # (1, 1500, 1280)`,
  rate: (p) => { const d = derive(p); return { value: fmtBits(d.encBps), note: `${p.encDim} × ${+d.encHz.toFixed(1)}/s × 16 bit` }; },
  mount(ctx) {
    const { audio } = ctx;
    let layer = 4, sel = -1;
    ctx.row("layers", "<b>Stride of the second convolution.</b> Whisper uses 2. Larger strides mean fewer vectors per second and coarser timing.",
      segmented("Stride", [["1", "1"], ["2", "2"], ["4", "4"]], String(ctx.pipe().encStride), (v) => ctx.setPipe({ encStride: Number(v) })));
    ctx.row("grid", "<b>Layer on the monitor.</b> Compare the raw conv output with the attention blocks: patterns spread across time as layers go up.",
      segmented("Layer", [["0", "Conv 1"], ["1", "Conv 2"], ["2", "Block 1"], ["3", "Block 2"], ["4", "Block 3"]], String(layer), (v) => (layer = Number(v))));
    const fS = slider({ label: "Frame", min: 0, max: 1, step: 0.001, value: 0.4, fmt: (v) => `${(v * audio.duration).toFixed(2)} s`, onInput: (v) => (sel = v) });
    ctx.row("target", "<b>Pick a frame</b> to see which other frames it attends to. While the sound plays, it follows the playhead.", fS);
    const sIn = ctx.stat("Frames in"), sOut = ctx.stat("Vectors out"), sRate = ctx.stat("Per second"), sRf = ctx.stat("Conv reach");
    let imgs: HTMLCanvasElement[] = [], att: HTMLCanvasElement | null = null;
    const refresh = () => {
      const a = ctx.analysis();
      imgs = a.enc.layers.map(layerImage);
      att = heat(a.enc.att.map((r) => { let m = 0; for (const v of r) m = Math.max(m, v); return r.map((v) => Math.sqrt(v / (m || 1))); }), a.enc.T);
      const p = ctx.pipe(), d = derive(p);
      sIn.set(fmtN(a.mel.frames.length));
      sOut.set(fmtN(a.enc.T));
      sRate.set(`${+d.encHz.toFixed(1)}`);
      // conv1 sees 3 frames; conv2 sees 3 of those, spaced by 1 → 5 frames of 10 ms plus one window
      sRf.set(`${(5 - 1) * p.hopMs + p.winMs} ms`);
    };
    refresh();
    ctx.onChange(refresh);
    ctx.screen("encoder", (g, w, h) => {
      const u = unit(h), a = ctx.analysis(), T = a.enc.T;
      const pos = audio.position();
      const f = pos >= 0 && audio.playing === "clip" ? pos / audio.duration : sel >= 0 ? sel : 0.4;
      const q = Math.min(T - 1, Math.floor(f * T));
      head(g, w, h, a.enc.names[layer], `frame ${q}`);
      const side = 80 * u, ax = 4 * u, ay = 15 * u;
      if (att) blit(g, att, ax, ay, side, side, false);
      g.strokeStyle = S.orange; g.lineWidth = 0.5 * u; g.strokeRect(ax, ay + (q / T) * side, side, Math.max(0.6 * u, side / T));
      screenText(g, "attention", ax, ay + side + 4 * u, 4.4 * u, S.dim);
      const lx = ax + side + 4 * u, lw = w - lx - 4 * u;
      if (imgs[layer]) blit(g, imgs[layer], lx, ay, lw, side, false);
      g.fillStyle = S.orange; g.fillRect(lx + (q / T) * lw, ay, Math.max(0.5 * u, lw / T), side);
      screenText(g, "activations: time →", lx, ay + side + 4 * u, 4.4 * u, S.dim);
    });
    return undefined;
  },
  run(ctx) {
    const a = ctx.analysis(), p = ctx.pipe();
    ctx.log(`log-mel        ${p.nMels} × ${fmtN(a.mel.frames.length)}`);
    ctx.log(`conv 1, k=3    48 × ${fmtN(a.enc.layers[0].length)}   GELU`);
    ctx.log(`conv 2, k=3/s${p.encStride} 48 × ${fmtN(a.enc.T)}   ${(a.enc.T / (a.clip.channels[0].length / a.clip.sr)).toFixed(1)} vectors per second`);
    ctx.log(`3 attention blocks, each ${a.enc.T} × ${a.enc.T} weights`);
    const m = Math.floor(a.enc.T / 2), row = a.enc.att[m];
    const top = [...row.keys()].filter((j) => Math.abs(j - m) > 2).sort((x, y) => row[y] - row[x]).slice(0, 3);
    const s = (j: number) => ((j * p.encStride * p.hopMs) / 1000).toFixed(2);
    ctx.log(`the vector at ${s(m)} s attends most to ${top.map((j) => `${s(j)} s`).join(", ")}`, "ok");
    ctx.log("Untrained weights: it links frames that sound alike. Trained ones link frames that mean alike.", "dim");
  },
};

// ---------------------------------------------------------------- 9 · tokens

export const tokens: Lesson = {
  id: "tokens",
  short: "Tokens",
  title: "Tokens: sound as whole numbers",
  chapter: "Encode",
  thumb: ["tokens"],
  focus: ["tokens"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "tokens.row0", icon: "cube", title: "First codebook", text: "For each 80 ms of sound, the number of the closest of 32 stored shapes.", slot: "tl" },
    { at: "tokens.tiles", icon: "layers", title: "Later codebooks", text: "Each row encodes what the rows above it missed.", slot: "br" },
    { at: "tokens.column", icon: "hash", title: "One column, one frame", text: "8 whole numbers describe 80 ms of sound.", slot: "bl" },
    { at: "tokens.screen", icon: "bars", title: "Error", text: "How far the decoded spectrum is from the real one after each codebook, in decibels.", slot: "tr" },
  ],
  summary: "Language models are built to predict the next item in a sequence of whole numbers. To model audio the same way, each chunk of sound is replaced by the number of its closest match in a <b>codebook</b>, a fixed list of typical sounds. Several codebooks in a row, each correcting the one before, give a description that is both compact and detailed.",
  steps: [
    "A <b>codebook</b> is a list of K example vectors learned from data. Here K = 32; Mimi uses 2,048.",
    "<b>Vector quantization:</b> for each frame, find the closest codebook entry and keep only its position in the list, one whole number.",
    "Subtract that entry from the frame. What's left over is the <b>residual</b>, the part the first codebook couldn't capture.",
    "<b>Residual vector quantization (RVQ):</b> quantize the residual with a second codebook, then the new residual with a third, and so on. Each codebook adds detail, the way decimal places do.",
    "Cost: each number takes log₂(K) bits. Here that's 5 bits × 8 codebooks × 12.5 frames per second = 500 bits per second. Mimi: 11 × 8 × 12.5 = 1,100.",
    "A <b>neural codec</b> (SoundStream, EnCodec, Mimi) learns the encoder, the codebooks and a decoder together, so the decoded audio sounds natural. Here the codebooks are fitted with k-means to log-mel frames of the seven built-in sounds, and decoding uses Griffin-Lim, so it sounds rough. The mechanism is the same.",
  ],
  lost: `<ul>
    <li><b>Everything between codebook entries.</b> A frame becomes one of K choices, so only sounds the codebook has learned can be described well.</li>
    <li><b>Sounds that were rare in training.</b> Switch the codebooks to <b>trained on speech only</b> and pick <i>Birdsong</i> or <i>Drum loop</i>: the error jumps from about 1 dB to well over 10 dB, because those sounds were never in the training data. (On the <i>Vowels</i> it drops to almost zero: they <i>were</i> the training data.)</li>
    <li><b>Fine detail</b>, when later codebooks are dropped to save bits. Codecs offer several bitrates this way.</li>
  </ul>`,
  words: [
    ["Codebook", "A fixed list of example vectors. Each is referred to by its position (index)."],
    ["Vector quantization", "Replacing a vector by the index of its nearest codebook entry."],
    ["Residual", "What's left after subtracting the chosen entry: the error so far."],
    ["RVQ", "Residual vector quantization: several codebooks applied one after another to the remaining error."],
    ["k-means", "A simple way to learn a codebook: repeatedly move each entry to the average of the vectors closest to it."],
    ["Codec", "Coder–decoder: turns audio into a compact form and back."],
    ["Bitrate", "Bits per second needed to store or send the compact form."],
  ],
  specs: [
    ["Here", "32 entries × 8 codebooks, 12.5 frames/s → 500 b/s"],
    ["Mimi", "2,048 × 8 at 12.5 frames/s → 1.1 kb/s"],
    ["EnCodec (24 kHz)", "1,024 × up to 32 at 75/s → 1.5–24 kb/s"],
    ["DAC (44.1 kHz)", "1,024 × 9 at 86/s → 7.7 kb/s"],
    ["HuBERT units", "500 entries × 1 at 50/s → ≈ 450 b/s"],
  ],
  code: `import numpy as np
from sklearn.cluster import KMeans

frames = logmel_80ms_frames                       # (T, 80)
books, codes, recon = [], [], np.zeros_like(frames)
for level in range(8):                            # residual VQ
    residual = frames - recon
    km = KMeans(n_clusters=32, n_init=4).fit(residual)
    idx = km.predict(residual)                    # one integer per frame
    recon += km.cluster_centers_[idx]
    books.append(km.cluster_centers_); codes.append(idx)
    print(level + 1, "codebooks, error left:", np.mean((frames - recon) ** 2))`,
  rate: (p) => ({ value: fmtBits(p.codecHz * 8 * Math.log2(CODEC_K)), note: `12.5 frames/s × 8 × ${Math.log2(CODEC_K)} bits` }),
  mount(ctx) {
    const { audio } = ctx;
    let n = 8, trainOn: "all" | "speech" = "all";
    const apply = () => {
      bus.codes = codecCodes(audio.clip, trainOn).codes;
      bus.codeRows = n;
    };
    ctx.row("layers", "<b>Codebooks used.</b> Fewer rows means fewer bits and a rougher sound. Unused rows go blank on the tray.",
      slider({ label: "Codebooks", min: 1, max: 8, value: n, onInput: (v) => { n = v; update(); } }));
    ctx.row("book", "<b>What the codebooks learned from.</b> The default learned from all seven built-in sounds. The other learned only from speech (the Vowels).",
      segmented("Trained on", [["all", "All sounds"], ["speech", "Speech only"]], trainOn, (v) => { trainOn = v as "all" | "speech"; update(); }));
    ctx.row("ear", "<b>Hear the decoded tokens.</b> The integers on the tray, turned back into sound.",
      el("div", { class: "btns" },
        button("▶ Hear the tokens", () => { ctx.log(`Decoding ${n} codebook${n > 1 ? "s" : ""}…`, "dim"); setTimeout(() => audio.playSignal([codecDecode(ctx.analysis(), n, trainOn)], 16000), 30); }, "btn primary"),
        button("▶ Original", () => audio.playClip(), "btn")));
    const sBits = ctx.stat("Bits per frame"), sRate = ctx.stat("Bits per second"), sErr = ctx.stat("Average error", "lost");
    const update = () => {
      apply();
      const err = codecError(ctx.analysis(), trainOn);
      sBits.set(String(n * Math.log2(CODEC_K)));
      sRate.set(fmtBits(12.5 * n * Math.log2(CODEC_K)));
      sErr.set(`${err[n - 1].toFixed(1)} dB`);
    };
    update();
    ctx.onChange(update);
    const tick = ctx.world.onTick(() => { if (bus.codeRows !== n) update(); });
    ctx.screen("tokens", (g, w, h) => {
      const u = unit(h), a = ctx.analysis();
      const err = codecError(a, trainOn);
      head(g, w, h, `Average error · trained on ${trainOn === "all" ? "all sounds" : "speech only"}`, `${err[n - 1].toFixed(1)} dB`, err[n - 1] > 6 ? S.red : S.teal);
      const x0 = 6 * u, bw = (w * 0.55 - x0) / 8, base = 86 * u, H = 62 * u, top = Math.max(6, err[0]);
      err.forEach((e, i) => {
        const bh = Math.min(1, e / top) * H;
        g.fillStyle = i < n ? (e > 6 ? S.red : S.teal) : "#2c3a5e";
        g.fillRect(x0 + i * bw + 0.6 * u, base - bh, bw - 1.2 * u, bh);
        screenText(g, String(i + 1), x0 + i * bw + bw / 2, base + 7 * u, 4.4 * u, S.dim, "center", true);
      });
      screenText(g, "codebooks used →", x0, 98 * u, 4 * u, S.dim);
      // the current frame's codes
      const c = bus.codes, T = c?.[0]?.length ?? 0;
      const f = audio.position() >= 0 && audio.playing === "clip" ? Math.min(T - 1, Math.floor((audio.position() / audio.duration) * T)) : Math.floor(T / 2);
      const cx = w * 0.6;
      screenText(g, `frame ${f}`, cx, 22 * u, 5 * u, S.dim);
      for (let r = 0; r < 8; r++) {
        const v = c?.[r]?.[f];
        g.fillStyle = r < n ? (r === 0 ? S.orange : S.ink) : "#3a4466";
        g.font = S.mono(6.4 * u); g.textAlign = "left";
        g.fillText(`c${r + 1}  ${v ?? "–"}`, cx, (31 + r * 7.8) * u);
      }
    });
    return () => { tick(); bus.codeRows = 8; bus.codes = ctx.analysis().codes; };
  },
  run(ctx) {
    const a = ctx.analysis();
    for (const t of ["all", "speech"] as const) {
      const err = codecError(a, t);
      ctx.log(`trained on ${t === "all" ? "all sounds " : "speech only"}: average error after 1…8 codebooks (dB)  ${err.map((e) => e.toFixed(1)).join("  ")}`, t === "speech" && err[7] > 6 ? "warn" : "info");
    }
    const c = codecCodes(a.clip);
    ctx.log(`first 12 frames, codebook 1: [${c.codes[0].slice(0, 12).join(", ")}]`);
    ctx.log(`${c.codes[0].length} frames × 8 codebooks = ${c.codes[0].length * 8} integers for ${(a.clip.channels[0].length / a.clip.sr).toFixed(1)} s of sound`, "ok");
  },
};

// ---------------------------------------------------------------- 10 · projector

type Conn = "stack" | "qformer" | "codes";
const CONN_TEXT: Record<Conn, string> = {
  stack: "<b>Stack + MLP:</b> join k neighbouring vectors end to end and resize them with a two-layer network. Used by Qwen2-Audio (k = 2, 25 tokens per second) and many others.",
  qformer: "<b>Q-Former:</b> a small transformer with a few learned \"query\" vectors that read the encoder output and summarise it. SALMONN uses one query per 17 frames, about 3 tokens per second.",
  codes: "<b>Codec tokens:</b> no projector. The language model's vocabulary is extended with codebook entries, each with its own learned vector. Moshi adds up the vectors for the 8 codes of each frame: 12.5 inputs per second.",
};

export const projector: Lesson = {
  id: "projector",
  short: "Projector",
  title: "The projector: audio into the language model",
  chapter: "Encode",
  thumb: ["projector"],
  focus: ["projector"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "projector.in", icon: "grid", title: "Encoder vectors in", text: "50 per second, 1,280 numbers each (Whisper large).", slot: "br" },
    { at: "projector.mlp", icon: "funnel", title: "Stack and resize", text: "k neighbours are joined, then a small network maps them to the language model's width.", slot: "tl" },
    { at: "projector.out", icon: "cube", title: "Audio tokens out", text: "Same size as a word's vector, so the model reads them like words.", slot: "bl" },
    { at: "projector.screen", icon: "screen", title: "Token budget", text: "How much of the model's context the audio uses up.", slot: "tr" },
  ],
  summary: "A language model reads one vector per token, all the same size: 3,584 numbers for Qwen2-7B, for example. Encoder output has the wrong size and arrives too often. The <b>projector</b> (also called an adapter) fixes both. Its pooling setting decides how many tokens each second of audio costs.",
  steps: [
    "Take k neighbouring encoder vectors and join them end to end: with k = 2, two 1,280-number vectors become one of 2,560.",
    "A small network of two layers (an <b>MLP</b>) maps that to the language model's width, e.g. 3,584.",
    "The results are placed in the prompt between markers such as &lt;audio&gt; and &lt;/audio&gt;, next to ordinary text tokens such as \"What is this sound?\"",
    "Training usually freezes the encoder, trains the projector first, then fine-tunes the language model on pairs of audio and text.",
    "The pooling factor sets the cost. Qwen2-Audio pools by 2 → 25 tokens per second → 90,000 tokens for an hour, most of a 128,000-token context.",
  ],
  lost: `<ul>
    <li><b>Timing finer than one token.</b> At 25 tokens per second, each token covers 40 ms of sound.</li>
    <li><b>What the projector wasn't trained to pass on.</b> It learns from paired data, mostly transcripts and short sound captions. A feature no training example asked about can reach the model and still go unused.</li>
    <li><b>Long recordings,</b> which run out of context.</li>
  </ul>`,
  words: [
    ["Embedding", "The vector a language model uses for one token."],
    ["Projector / adapter", "A small network that converts one model's vectors into another's format."],
    ["MLP", "Multi-layer perceptron: a few layers of multiply-add plus a nonlinearity."],
    ["Pooling", "Combining several neighbouring vectors into one."],
    ["Context window", "The most tokens a model can read at once, e.g. 128,000."],
    ["Prompt", "Everything the model reads before it starts answering."],
  ],
  specs: [
    ["Qwen2-Audio", "Whisper-large-v3 encoder, pool 2 → 25 / s"],
    ["SALMONN", "Whisper + BEATs, window Q-Former → ≈ 3 / s"],
    ["Moshi", "8 code vectors summed per 80 ms → 12.5 / s"],
    ["LM width", "3,584 (Qwen2-7B) · 4,096 (Llama-3-8B, Helium)"],
  ],
  code: `import torch, torch.nn as nn

class Projector(nn.Module):
    def __init__(self, d_enc=1280, d_lm=3584, k=2):
        super().__init__()
        self.k = k
        self.mlp = nn.Sequential(nn.Linear(d_enc * k, d_lm), nn.GELU(), nn.Linear(d_lm, d_lm))

    def forward(self, h):                     # h: (batch, frames, 1280), 50 per second
        B, T, D = h.shape
        T = T // self.k * self.k
        h = h[:, :T].reshape(B, T // self.k, D * self.k)   # join k neighbours
        return self.mlp(h)                    # (batch, frames / k, 3584)

audio_tokens = Projector()(encoder_output)
inputs = torch.cat([embed(prompt_ids), audio_tokens, embed(question_ids)], dim=1)`,
  rate: (p) => { const d = derive(p); return { value: `${+d.lmHz.toFixed(1)} tok/s`, note: `× ${fmtN(p.lmDim)} numbers` }; },
  mount(ctx) {
    let conn: Conn = "stack";
    const pS = slider({ label: "Pool k", min: 1, max: 8, value: ctx.pipe().pool, onInput: (v) => ctx.setPipe({ pool: v }) });
    ctx.row("funnel", "<b>Pooling factor k.</b> How many encoder vectors become one language-model token. This setting carries forward.", pS);
    const desc = ctx.row("cube", CONN_TEXT[conn]);
    ctx.row("split", "<b>Other designs.</b> Compare the token rate of the three common ways in.",
      segmented<Conn>("Design", [["stack", "Stack + MLP"], ["qformer", "Q-Former"], ["codes", "Codec tokens"]], conn, (v) => { conn = v; desc.text(CONN_TEXT[v]); }));
    const rate = () => (conn === "stack" ? derive(ctx.pipe()).lmHz : conn === "qformer" ? 50 / 17 : 12.5);
    const sT = ctx.stat("Tokens / second"), s30 = ctx.stat("30 s clip"), sHr = ctx.stat("1 hour"), sCtx = ctx.stat("Hour vs 128k");
    const tick = ctx.world.onTick(() => {
      const r = rate();
      sT.set(r.toFixed(r < 10 ? 1 : 0)); s30.set(fmtN(r * 30)); sHr.set(fmtN(r * 3600)); sCtx.set(`${Math.round((r * 3600 * 100) / 128000)} %`);
    });
    ctx.screen("projector", (g, w, h) => {
      const u = unit(h), r = rate();
      head(g, w, h, "Context used by audio", `${r.toFixed(r < 10 ? 1 : 0)} tok/s`);
      const rows: [string, number][] = [["30 s", 30], ["10 min", 600], ["1 hour", 3600]];
      rows.forEach(([lab, sec], i) => {
        const y = (22 + i * 24) * u, x0 = 22 * u, ww = w - x0 - 6 * u;
        const frac = Math.min(1.2, (r * sec) / 128000);
        g.fillStyle = "#2c3a5e"; g.fillRect(x0, y, ww, 11 * u);
        g.fillStyle = frac > 1 ? S.red : S.teal; g.fillRect(x0, y, ww * Math.min(1, frac), 11 * u);
        screenText(g, lab, x0 - 2 * u, y + 8.5 * u, 6 * u, S.ink, "right");
        screenText(g, `${fmtN(r * sec)}`, x0 + 2 * u, y + 8.5 * u, 6 * u, frac > 0.3 ? S.bg : S.ink, "left", true);
        if (frac > 1) screenText(g, "doesn't fit", x0 + ww - 2 * u, y + 8.5 * u, 5.5 * u, "#fff", "right");
      });
      screenText(g, "bar = share of a 128,000-token context", 6 * u, 94 * u, 4.8 * u, S.dim);
    });
    return () => tick();
  },
  run(ctx) {
    const a = ctx.analysis(), p = ctx.pipe(), dur = a.clip.channels[0].length / a.clip.sr;
    ctx.log(`encoder output: ${a.enc.T} vectors for ${dur.toFixed(1)} s (${+derive(p).encHz.toFixed(1)} per second) × ${p.encDim}`);
    for (const k of [1, 2, 4, 8]) ctx.log(`k=${k}: ${String(Math.ceil(a.enc.T / k)).padStart(4)} tokens of ${fmtN(p.lmDim)} · one hour = ${fmtN((3600 * derive(p).encHz) / k)} tokens`, k === p.pool ? "head" : "info");
    ctx.log("Fewer tokens: cheaper and longer recordings fit. More tokens: finer timing.", "ok");
  },
};

