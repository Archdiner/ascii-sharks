import type { Lesson } from "../types";
import { slider, segmented, toggle, button, el } from "../ui/dom";
import { bus } from "../scene/bus";
import { CODEC_K } from "../analysis";
import { S, head, unit, screenText, fmtBits, codecDecode } from "./kit";

// ---------------------------------------------------------------- 13 · Mimi

export const mimi: Lesson = {
  id: "mimi",
  short: "Mimi",
  title: "Mimi: a codec built for a speaking model",
  chapter: "Models that talk",
  thumb: ["encoder", "tokens"],
  focus: ["encoder", "tokens"],
  view: { fill: 0.7, offset: [0.02, 0.02] },
  callouts: [
    { at: "encoder.conv", icon: "layers", title: "Convolutional encoder", text: "Squeezes 1,920 samples (80 ms at 24 kHz) into one vector of 512 numbers.", slot: "tr" },
    { at: "encoder.layers", icon: "tower", title: "Causal transformer", text: "8 layers that use only the past, so Mimi can run live.", slot: "tc" },
    { at: "tokens.row0", icon: "target", title: "Semantic codebook", text: "Trained to match WavLM, a speech model, so it carries what was said.", slot: "tl" },
    { at: "tokens.tiles", icon: "layers", title: "7 acoustic codebooks", text: "Voice, timbre and recording detail, each fixing what the last missed.", slot: "br" },
    { at: "tokens.screen", icon: "screen", title: "Bitrate", text: "8 numbers × 11 bits × 12.5 frames per second.", slot: "bl" },
  ],
  summary: "<b>Mimi</b> is the neural codec Kyutai built in 2024 as the ears and voice of their Moshi model. It turns 24 kHz audio into 8 whole numbers every 80 ms, and back again. Two choices make it suited to a language model: a very low frame rate, and a first codebook trained to capture <i>what</i> was said rather than <i>how</i> it sounded.",
  steps: [
    "<b>Encoder.</b> Convolutions shrink 24 kHz audio by 4 × 5 × 6 × 8 = 960, to 25 frames per second. One more strided convolution halves that to 12.5. Each 80 ms becomes a vector of 512 numbers.",
    "<b>Transformer.</b> 8 layers refine the vectors. They're causal: each frame uses only the frames before it, so Mimi works live with 80 ms of delay.",
    "<b>Split RVQ.</b> One codebook of 2,048 entries quantizes the vector by itself, and alongside it a 7-stage residual quantizer does the same. Their outputs are added. 8 numbers × 11 bits × 12.5 per second = 1.1 kb/s.",
    "<b>Semantic distillation.</b> During training, the first codebook's output is pushed to resemble the features of WavLM, a large self-supervised speech model. So codebook 1 carries the phonetic content and the other 7 carry the voice and acoustic detail.",
    "<b>Decoder.</b> It mirrors the encoder. It was trained with an adversarial loss, where a second network tries to tell real audio from decoded audio. The result sounds natural but doesn't match the input sample for sample.",
    "<b>Why 12.5 Hz matters.</b> EnCodec uses 75 frames per second. A 7B language model generating Mimi tokens does six times fewer steps per second of audio.",
    "<b>On this page</b> the tray shows the 8-codebook toy codec from lesson 9 at Mimi's 80 ms frame rate. Real Mimi needs its trained weights; the snippet shows how to run it.",
  ],
  lost: `<ul>
    <li><b>Sounds unlike its training data.</b> Mimi was trained on the audio used to pretrain Moshi: millions of hours, mostly English speech. Music, noise and overlapping sources were rare, so the codebooks describe them poorly.</li>
    <li><b>Everything above 12 kHz</b> (24 kHz sampling).</li>
    <li><b>Stereo:</b> one channel.</li>
    <li><b>The exact waveform.</b> Because of adversarial training it produces a plausible signal, not necessarily the same one. Fine for a voice; a problem when you need to measure the sound.</li>
  </ul>`,
  words: [
    ["Neural codec", "A codec whose encoder, codebooks and decoder are neural networks trained together."],
    ["Frame rate", "Vectors (or token columns) per second. Mimi: 12.5."],
    ["Causal", "Uses only the past. Required for live, low-delay operation."],
    ["Distillation", "Training one model to copy features of another."],
    ["WavLM", "A self-supervised speech encoder from Microsoft (2021), used as Mimi's teacher."],
    ["Adversarial loss", "A second network judges real versus generated audio; the codec learns to fool it."],
  ],
  specs: [
    ["Sample rate", "24 kHz, mono"],
    ["Frame", "80 ms = 1,920 samples (12.5 / s)"],
    ["Latent", "512 numbers per frame"],
    ["Codebooks", "1 semantic + 7 acoustic for Moshi (up to 32)"],
    ["Entries per codebook", "2,048 (11 bits)"],
    ["Bitrate", "1.1 kb/s"],
    ["Released", "2024, open weights (kyutai/mimi)"],
  ],
  code: `import torch
from transformers import MimiModel, AutoFeatureExtractor

model = MimiModel.from_pretrained("kyutai/mimi")
fe = AutoFeatureExtractor.from_pretrained("kyutai/mimi")

inputs = fe(raw_audio=wav_24k, sampling_rate=24000, return_tensors="pt")
codes = model.encode(inputs["input_values"], num_quantizers=8).audio_codes
print(codes.shape)            # (1, 8, frames), frames = seconds × 12.5
print(codes[0, :, :6])        # row 0: semantic, rows 1–7: acoustic

audio = model.decode(codes).audio_values    # back to 24 kHz`,
  rate: () => ({ value: "1.1 kb/s", note: "12.5 / s × 8 × 11 bits" }),
  mount(ctx) {
    let n = 8;
    ctx.row("layers", "<b>Codebooks kept.</b> Real Mimi can be decoded with fewer codebooks for a lower bitrate. Unused rows go blank on the tray.",
      slider({ label: "Codebooks", min: 1, max: 8, value: n, onInput: (v) => { n = v; bus.codeRows = v; } }));
    ctx.row("ear", "<b>Hear the toy codec at Mimi's frame rate.</b> Notice the smearing: one frame per 80 ms is coarse. Real Mimi's learned decoder recovers far more detail from its 512-number vectors.",
      el("div", { class: "btns" }, button("▶ Hear decoded", () => setTimeout(() => ctx.audio.playSignal([codecDecode(ctx.analysis(), n)], 16000), 30), "btn primary"), button("▶ Original", () => ctx.audio.playClip(), "btn")));
    const sR = ctx.stat("Real Mimi"), sX = ctx.stat("vs 16-bit PCM"), sL = ctx.stat("Delay");
    const tick = ctx.world.onTick(() => { const b = 12.5 * n * 11; sR.set(fmtBits(b)); sX.set(`${Math.round(384000 / b)}× smaller`); sL.set("80 ms"); });
    ctx.screen("tokens", (g, w, h) => {
      const u = unit(h);
      head(g, w, h, "Mimi", fmtBits(12.5 * n * 11));
      const blocks = ["24 kHz", "conv ÷1920", "8 layers", "1 + 7 codes", "decoder", "24 kHz"];
      const bw = (w - 8 * u) / blocks.length;
      blocks.forEach((b, i) => {
        const x = 4 * u + i * bw;
        g.fillStyle = i === 3 ? S.orange : "#2c3a5e"; g.fillRect(x + 0.8 * u, 22 * u, bw - 1.6 * u, 22 * u);
        screenText(g, b, x + bw / 2, 36 * u, 5.4 * u, i === 3 ? S.bg : S.ink, "center");
      });
      screenText(g, `12.5 frames/s × ${n} codebook${n > 1 ? "s" : ""} × 11 bits = ${fmtBits(12.5 * n * 11)}`, 4 * u, 62 * u, 6 * u, S.teal, "left", true);
      screenText(g, `toy codec on the tray: ${CODEC_K} entries, ${Math.log2(CODEC_K)} bits each`, 4 * u, 80 * u, 5 * u, S.dim);
    });
    return () => { tick(); bus.codeRows = 8; };
  },
  run(ctx) {
    const d = ctx.audio.duration;
    ctx.log(`${d.toFixed(2)} s at 24 kHz = ${Math.round(d * 24000).toLocaleString()} samples`);
    ctx.log(`÷ 1,920 → ${Math.floor(d * 12.5)} frames → codes of shape (1, 8, ${Math.floor(d * 12.5)}), integers 0–2047`);
    for (const q of [1, 2, 4, 8, 16, 32]) ctx.log(`  ${String(q).padStart(2)} codebooks → ${fmtBits(12.5 * q * 11).padStart(9)}`, q === 8 ? "head" : "dim");
    ctx.log("Moshi uses 8: about 350 times smaller than 16-bit audio at 24 kHz.", "ok");
  },
};

// ---------------------------------------------------------------- 14 · Moshi

type Seg = { from: number; to: number; text: string[] };
const USER: Seg[] = [{ from: 1, to: 17, text: ["hey", "what's", "the", "weather", "like?"] }, { from: 31, to: 36, text: ["oh", "nice"] }];
const BOT: Seg[] = [{ from: 9, to: 11, text: ["mhm"] }, { from: 19, to: 32, text: ["sunny,", "about", "twenty", "degrees", "today"] }, { from: 37, to: 41, text: ["yeah!"] }];
const STEPS = 46;
const at = (segs: Seg[], s: number) => segs.find((x) => s >= x.from && s < x.to);
const word = (seg: Seg, s: number) => { const per = Math.max(1, Math.floor((seg.to - seg.from) / seg.text.length)); return (s - seg.from) % per === 0 ? seg.text[Math.min(seg.text.length - 1, Math.floor((s - seg.from) / per))] : ""; };

export const moshi: Lesson = {
  id: "moshi",
  short: "Moshi",
  title: "Moshi: listening and speaking at once",
  chapter: "Models that talk",
  thumb: ["voice", "lm"],
  focus: ["lm", "head", "voice"],
  view: { fill: 0.72, offset: [0.03, 0.02] },
  callouts: [
    { at: "lm.mid", icon: "tower", title: "Temporal Transformer", text: "A 7B model that steps forward once every 80 ms.", slot: "br" },
    { at: "lm.screen", icon: "grid", title: "17 tokens per step", text: "Your 8 codes, Moshi's 8 codes and 1 text token.", slot: "tc" },
    { at: "head.screen", icon: "layers", title: "Depth Transformer", text: "A small model that writes each step's tokens one after another.", slot: "tl" },
    { at: "voice.cone", icon: "speaker", title: "Moshi's voice", text: "Its codes go through Mimi's decoder and out of the speaker.", slot: "bl" },
  ],
  summary: "Most voice assistants take turns: wait for you to stop, transcribe, think in text, then speak. <b>Moshi</b> (Kyutai, 2024) listens and speaks at the same time. Every 80 ms it reads your next Mimi frame and writes its own, so it can answer quickly, say \"mhm\" while you talk, or be interrupted.",
  steps: [
    "Every 80 ms step involves 17 tokens: 8 Mimi codes from your microphone, 8 Mimi codes for Moshi's voice, and 1 text token.",
    "The text token is Moshi's own words, lined up in time with its speech. Kyutai call this the <b>Inner Monologue</b>. Predicting the words alongside the sound makes the speech more coherent.",
    "Two transformers share the work. The <b>Temporal Transformer</b> (Helium, 7B) runs once per step and summarises everything so far. A small <b>Depth Transformer</b> then writes that step's tokens one by one: text first, then the semantic code, then acoustic codes 1–7.",
    "<b>Acoustic delay:</b> the acoustic codes are produced 1–2 steps after the semantic code of the same frame, so the model decides <i>what</i> to say slightly before <i>how it sounds</i>. Toggle it to see the offset.",
    "Silence is tokens too. When Moshi has nothing to say it writes silence; when you talk over it, nothing special has to happen.",
    "Latency: one frame (80 ms) plus the acoustic delay (80 ms) is 160 ms in theory, about 200 ms measured. Gaps between turns in human conversation are typically around 200 ms.",
  ],
  lost: `<ul>
    <li><b>Everything Mimi loses,</b> on both channels: your voice reaches the model only as speech-trained tokens.</li>
    <li><b>The surroundings.</b> Moshi was trained on conversations. Background music or a dog barking is treated as noise.</li>
    <li><b>Thinking time.</b> Every step has 80 ms. Newer systems often trade some of this speed for quality by mixing in slower text reasoning.</li>
  </ul>`,
  words: [
    ["Full duplex", "Both sides can send at the same time, like a phone call (half duplex is a walkie-talkie)."],
    ["Cascade", "The turn-taking design: speech recognition → text model → speech synthesis."],
    ["Inner Monologue", "Moshi's time-aligned text tokens: its words, predicted alongside its audio."],
    ["Temporal Transformer", "The big model that moves forward one 80 ms step at a time."],
    ["Depth Transformer", "The small model that writes the tokens within one step."],
    ["Latency", "Delay between you finishing and the reply starting."],
    ["Back-channel", "Short listener sounds like \"mhm\" or \"yeah\" while the other person talks."],
  ],
  specs: [
    ["Backbone", "Helium, 7B, 32 layers, 4,096 wide"],
    ["Tokens per 80 ms", "1 text + 8 Moshi + 8 user"],
    ["Text vocabulary", "32,000"],
    ["Acoustic delay", "1–2 steps"],
    ["Latency", "160 ms theory · ≈ 200 ms on an L4 GPU"],
    ["Released", "Sept 2024, open weights (CC-BY 4.0)"],
  ],
  code: `# pip install moshi   (or: python -m moshi.server, then open the web page)
import torch
from huggingface_hub import hf_hub_download
from moshi.models import loaders, LMGen

mimi = loaders.get_mimi(hf_hub_download(loaders.DEFAULT_REPO, loaders.MIMI_NAME))
mimi.set_num_codebooks(8)
lm = loaders.get_moshi_lm(hf_hub_download(loaders.DEFAULT_REPO, loaders.MOSHI_NAME))
gen = LMGen(lm, temp=0.8, temp_text=0.7)

with torch.no_grad(), gen.streaming(1), mimi.streaming(1):
    for chunk in mic_chunks(1920):            # 80 ms at 24 kHz
        out = gen.step(mimi.encode(chunk))    # your 8 codes in → (1, 1 + 8, 1) out
        if out is not None:
            speaker.play(mimi.decode(out[:, 1:]))`,
  rate: () => ({ value: "≈ 2.2 kb/s", note: "two Mimi streams + text" }),
  mount(ctx) {
    let playing = true, s = 12, acc = 0, delay = true, depth = 0, mode: "moshi" | "cascade" = "moshi";
    const playB = button("❚❚ Pause", () => { playing = !playing; playB.textContent = playing ? "❚❚ Pause" : "▶ Play"; }, "btn primary");
    ctx.row("play", "<b>Step through a conversation.</b> Each column on the monitor is 80 ms. Watch Moshi say \"mhm\" while you're still talking.",
      el("div", { class: "btns" }, playB, button("Step ›", () => { playing = false; playB.textContent = "▶ Play"; s = (s + 1) % STEPS; depth = 0; }, "btn"), button("↺ Restart", () => { s = 0; depth = 0; }, "btn")));
    ctx.row("clock", "<b>Acoustic delay.</b> Moshi's acoustic codes trail its semantic code by a step.", toggle("Delay on", delay, (v) => (delay = v)));
    ctx.row("split", "<b>Compare with a cascade</b>, the turn-taking design most assistants used before. Typical values; real systems vary.",
      segmented("Design", [["moshi", "Moshi"], ["cascade", "Cascade"]], mode, (v) => { mode = v as "moshi" | "cascade"; }));
    const sStep = ctx.stat("Step"), sState = ctx.stat("Moshi is"), sLat = ctx.stat("Reply after");
    const tick = ctx.world.onTick((_t, dt) => {
      if (playing) { acc += dt; depth = Math.min(1, depth + dt * 2.4); if (acc > 0.42) { acc = 0; s = (s + 1) % STEPS; depth = 0; } }
      const mo = at(BOT, s), us = at(USER, s);
      bus.glow.set("voice", mo ? 1 : 0);
      bus.glow.set("lm", 1);
      sStep.set(`${s} of ${STEPS}`);
      sState.set(mo && us ? "talking over you" : mo ? "speaking" : us ? "listening" : "waiting");
      sLat.set(mode === "moshi" ? `${(BOT[1].from - USER[0].to) * 80} ms` : "≈ 1,200 ms");
    });
    ctx.screen("lm", (g, w, h) => {
      const u = unit(h);
      if (mode === "cascade") {
        head(g, w, h, "Cascade: one stage after another", "≈ 1.2 s");
        const parts: [string, number, string][] = [["wait for silence", 500, S.dim], ["speech → text", 200, S.teal], ["text model", 300, S.orange], ["text → speech", 200, S.red]];
        let x = 4 * u; const scale = (w - 8 * u) / 1300;
        parts.forEach(([lab, ms, col], i) => {
          g.fillStyle = col; g.fillRect(x, (22 + i * 16) * u, ms * scale, 10 * u);
          screenText(g, `${lab}  ${ms} ms`, x + 1 * u, (30 + i * 16) * u, 5 * u, i === 0 ? S.bg : S.bg);
          x += ms * scale;
        });
        g.fillStyle = S.teal; g.fillRect(4 * u, 88 * u, 160 * scale, 4 * u);
        screenText(g, "Moshi: 160–200 ms", 4 * u + 162 * scale, 92 * u, 5 * u, S.teal);
        return;
      }
      head(g, w, h, "Token streams, 80 ms per column", `step ${s}`);
      const lab = 18 * u, x0 = lab, ww = w - lab - 3 * u;
      const vis = 22, start = Math.max(0, Math.min(STEPS - vis, s - 15)), cw = ww / vis;
      const rows: [string, "text" | "msem" | "mac" | "usem" | "uac", number, number][] = [["text", "text", 15, 8], ["Moshi sem", "msem", 25, 4], ["Moshi ac", "mac", 30, 18], ["you sem", "usem", 52, 4], ["you ac", "uac", 57, 18]];
      const D = delay ? 1 : 0;
      for (const [name, kind, y, hh] of rows) {
        screenText(g, name, lab - 1.5 * u, (y + Math.min(hh, 6)) * u, 4.4 * u, kind === "text" ? S.orange : kind[0] === "u" ? S.dim : S.teal, "right");
        for (let i = 0; i < vis; i++) {
          const st = start + i, fut = st > s, x = x0 + i * cw;
          if (kind === "text") {
            const sg = at(BOT, st), wd = sg ? word(sg, st) : "";
            g.fillStyle = fut ? "#232d4b" : wd ? "#5a4730" : "#2c3a5e"; g.fillRect(x + 0.2 * u, y * u, cw - 0.4 * u, hh * u);
            if (!fut && wd) screenText(g, wd, x + cw / 2, (y + 6) * u, 3.6 * u, S.orange, "center");
            continue;
          }
          const isU = kind[0] === "u";
          const src = at(isU ? USER : BOT, st - (kind === "mac" ? D : 0));
          const pend = !isU && st === s && depth < (kind === "msem" ? 0.2 : 0.95);
          g.fillStyle = fut || pend ? "#232d4b" : src ? (isU ? "#6c7a9e" : S.teal) : "#2c3a5e";
          g.fillRect(x + 0.2 * u, y * u, cw - 0.4 * u, hh * u);
        }
      }
      const cx = x0 + (s - start) * cw;
      g.strokeStyle = S.orange; g.lineWidth = 0.6 * u; g.strokeRect(cx, 14 * u, cw, 62 * u);
      screenText(g, depth < 0.2 ? "depth: writing text" : depth < 0.3 ? "depth: semantic code" : depth < 0.95 ? `depth: acoustic ${Math.min(7, Math.ceil((depth - 0.3) / 0.093))}` : "step done", x0, 88 * u, 5.4 * u, S.ink);
    });
    return () => { tick(); bus.glow.delete("voice"); bus.glow.delete("lm"); };
  },
  run(ctx) {
    const steps = Math.floor(ctx.audio.duration * 12.5);
    ctx.log(`your sound as the user's side: ${steps} steps × 8 codes = ${steps * 8} tokens`);
    ctx.log(`Moshi fills the same ${steps} steps with 1 text + 8 audio tokens: ${steps * 9} predictions`);
    ctx.log(`Temporal Transformer runs ${steps} times · Depth Transformer runs ${steps * 9} times`);
    ctx.log("Budget per step: 80 ms. Theoretical delay: 80 ms frame + 80 ms acoustic delay = 160 ms.", "ok");
  },
};
