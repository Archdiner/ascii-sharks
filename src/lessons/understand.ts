import type { Lesson } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, slider, segmented, button, controls } from "../ui/dom";
import { rng } from "../dsp/rand";
import { stat } from "./capture";
import { mel16, toyCodec } from "./shared";

// ---------------------------------------------------------------- 11 · LM layers

const QUESTION = ["What", "do", "you", "hear", "?", "▸", "A"];

export const layers: Lesson = {
  id: "layers",
  title: "Inside the language model",
  chapter: "Understand",
  blurb: "Audio tokens and text tokens sit in one sequence. Dozens of transformer layers let every token look back at every earlier one, and gradually the sound turns into meaning.",
  rail: [8],
  rate: { value: "25 tok/s", note: "× 28 layers × 3584-d" },
  tabs: {
    overview: `
      <p class="lead">Inside the LM, audio tokens are just more tokens.</p>
      <p>Each <b>transformer block</b> does two things. <b>Self-attention</b> lets each position gather information from earlier positions, weighted by relevance. An <b>MLP</b> then transforms each position on its own. Both <i>add</i> to a running vector per token, the <b>residual stream</b>.</p>
      <p>A 7B model has about 28–32 of these blocks. Over the layers, a position stops representing "a bright, noisy 40 ms" and starts representing "a dog bark", "the speaker sounds annoyed" or "the word <i>tomorrow</i>".</p>
      <p><b>Hover a token</b> to see where it attends, and drag <b>Layer</b> to see the pattern change with depth.</p>`,
    hood: `
      <p><b>This panel is an illustration.</b> The token row uses your clip (audio tokens are coloured by its real loudness at 25 Hz), but the attention patterns are drawn from what interpretability work typically finds, not computed from a trained model:</p>
      <ul>
        <li><b>Early layers</b>: mostly local, each token looks at its neighbours.</li>
        <li><b>Middle layers</b>: text tokens reach into the audio span, concentrating on the loud, informative parts.</li>
        <li><b>Late layers</b>: sparse, specific links, such as the answer token attending to the question word and a few key audio moments.</li>
      </ul>
      <p>Attention is <b>causal</b>: a token can only see the past. That's why audio goes <i>before</i> the question in the prompt.</p>`,
    lost: `
      <p class="lostline"><b>Whatever the question doesn't ask about.</b> The LM pulls from the audio what helps predict the next text token. If the training data were mostly transcripts, the cheapest thing to learn is "find the words". Tone, rhythm and background can stay in the residual stream and never be read out.</p>
      <p>Audio-reasoning benchmarks (MMAU, AIR-Bench and others) keep finding the same gap: models that transcribe well still fall far short of people on questions about non-speech sound, such as counting events, ordering them, or judging pitch, distance or rhythm.</p>`,
    specs: [
      ["Block", "x + Attn(LN(x)); x + MLP(LN(x))"],
      ["Qwen2-7B", "28 layers · 3584-d · 28 heads"],
      ["Helium (Moshi)", "7B · 32 layers · 4096-d"],
      ["Context", "8k – 128k tokens"],
      ["Attention", "causal, rotary positions"],
    ],
  },
  code: `import torch
from transformers import Qwen2AudioForConditionalGeneration, AutoProcessor

name = "Qwen/Qwen2-Audio-7B-Instruct"
proc  = AutoProcessor.from_pretrained(name)
model = Qwen2AudioForConditionalGeneration.from_pretrained(name)

inputs = proc(text=prompt, audios=[audio], sampling_rate=16000,
              return_tensors="pt")
out = model(**inputs, output_attentions=True, output_hidden_states=True)
print(len(out.hidden_states))      # 29 = embeddings + 28 layers
print(out.attentions[14].shape)    # (1, heads, T, T)`,
  mount(ctx) {
    const { root, audio } = ctx;
    let L = 14, hover = -1;
    const p = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "One sequence, many layers · illustrative attention"));
    root.append(p);
    const sTok = stat("Tokens"), sKind = stat("Hovered"), sTop = stat("Attends most to");
    root.append(controls(slider({ label: "Layer", min: 1, max: 28, value: L, onInput: (v) => (L = v) })), el("div", { class: "stat-row" }, sTok, sKind, sTop));
    const S = surface(p);
    const xs: number[] = [];
    S.canvas.addEventListener("pointermove", (e) => {
      const r = S.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      let best = -1, bd = 20;
      xs.forEach((x, i) => { if (Math.abs(x - mx) < bd) { bd = Math.abs(x - mx); best = i; } });
      hover = best;
    });
    S.canvas.addEventListener("pointerleave", () => (hover = -1));
    const stop = loop((t) => {
      const { g, w, h } = S;
      g.clearRect(0, 0, w, h);
      // 25 Hz loudness of the clip → up to 24 audio tokens
      const m = mel16(audio).frames;
      const nA = Math.min(24, Math.max(6, Math.round(audio.duration * 25 / 4)));
      const energy = Array.from({ length: nA }, (_, i) => {
        const a = Math.floor((i * m.length) / nA), b = Math.floor(((i + 1) * m.length) / nA);
        let s = 0; for (let j = a; j < b; j++) for (const v of m[j]) s += v;
        return s / Math.max(1, (b - a) * 80);
      });
      const emn = Math.min(...energy), emx = Math.max(...energy);
      const en = energy.map((e) => (e - emn) / (emx - emn || 1));
      const toks: { s: string; kind: "a" | "t" | "m"; e: number }[] = [{ s: "<audio>", kind: "m", e: 0 }, ...en.map((e) => ({ s: "", kind: "a" as const, e })), { s: "</audio>", kind: "m", e: 0 }, ...QUESTION.map((s) => ({ s, kind: "t" as const, e: 0 }))];
      const n = toks.length;
      const x0 = 24, ww = w - 48, step = ww / n;
      xs.length = 0;
      for (let i = 0; i < n; i++) xs.push(x0 + (i + 0.5) * step);
      // layer stack
      const stackTop = 40, stackH = h - 150;
      const nShow = 7;
      for (let k = 0; k < nShow; k++) {
        const y = stackTop + (k / nShow) * stackH;
        const layerNum = Math.round(28 - (k / (nShow - 1)) * 27);
        const on = Math.abs(layerNum - L) <= 2;
        roundRect(g, x0 - 6, y, ww + 12, stackH / nShow - 6, 6);
        g.fillStyle = on ? "#1aa3a118" : "#efe3d155"; g.fill();
        g.strokeStyle = on ? PALETTE.teal : PALETTE.lineSoft; g.lineWidth = 1.2; g.stroke();
        label(g, `L${layerNum}`, x0 - 2, y + 13, { size: 10, mono: true, color: on ? PALETTE.tealDeep : PALETTE.faint, weight: 400 });
      }
      // tokens
      const ty = h - 96;
      for (let i = 0; i < n; i++) {
        const tk = toks[i];
        const cx = xs[i];
        const bw = Math.min(step - 3, tk.kind === "a" ? 14 : 60);
        roundRect(g, cx - bw / 2, ty, bw, 24, 5);
        g.fillStyle = tk.kind === "a" ? `rgba(26,163,161,${0.3 + 0.7 * tk.e})` : tk.kind === "m" ? "#efe3d1" : "#fdf9f1";
        g.fill();
        if (i === hover) { g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.stroke(); }
        else if (tk.kind === "t") { g.strokeStyle = PALETTE.line; g.lineWidth = 1; g.stroke(); }
        if (tk.s) label(g, tk.s.length * 6 > bw ? tk.s.slice(0, 2) : tk.s, cx, ty + 16, { align: "center", size: 11, mono: true, color: PALETTE.navy, weight: 500 });
      }
      label(g, "audio tokens (brightness = loudness of your clip)", x0, ty + 42, { size: 10.5, color: PALETTE.tealDeep, weight: 600 });
      label(g, "text", xs[n - QUESTION.length], ty + 42, { size: 10.5, color: PALETTE.muted, weight: 600 });
      // attention from query q to earlier tokens
      const q = hover >= 0 ? hover : n - 1 - (Math.floor(t * 0.4) % 3);
      const depth = (L - 1) / 27;
      const wts: number[] = [];
      const r = rng(q * 97 + L);
      for (let j = 0; j <= q; j++) {
        const dist = q - j;
        const local = Math.exp(-dist / 1.5);
        const audioPull = toks[j].kind === "a" && toks[q].kind !== "a" ? 0.2 + toks[j].e ** 2 : 0.05;
        const sparse = (toks[j].s === "hear" || (toks[j].kind === "a" && toks[j].e > 0.85)) && toks[q].kind === "t" ? 1.5 : r() < 0.05 ? 0.6 : 0;
        const wgt = local * (1 - depth) ** 2 * 2 + audioPull * Math.sin(Math.PI * Math.min(1, depth * 1.2)) * 1.6 + sparse * depth ** 2 * 2;
        wts.push(wgt);
      }
      const sum = wts.reduce((a, b) => a + b, 0) || 1;
      const arcTop = stackTop + stackH * (1 - (L - 1) / 27) * 0.85 + 8;
      let bestJ = 0;
      wts.forEach((wv, j) => {
        const a = wv / sum;
        if (a > wts[bestJ] / sum) bestJ = j;
        if (a < 0.01 || j === q) return;
        const x1 = xs[j], x2 = xs[q];
        g.strokeStyle = PALETTE.teal; g.globalAlpha = Math.min(1, a * 4); g.lineWidth = 1 + a * 10;
        g.beginPath(); g.moveTo(x1, ty - 2); g.quadraticCurveTo((x1 + x2) / 2, Math.max(arcTop, ty - 20 - (x2 - x1) * 0.55), x2, ty - 2); g.stroke();
      });
      g.globalAlpha = 1;
      sTok.set(`${en.length} audio + ${QUESTION.length + 2}`);
      sKind.set(toks[q].kind === "a" ? `audio #${q}` : `"${toks[q].s}"`);
      sTop.set(toks[bestJ].kind === "a" ? `audio #${bestJ}` : `"${toks[bestJ].s}"`);
    });
    return () => { stop(); S.dispose(); };
  },
  run(ctx) {
    const d = ctx.audio.duration;
    const T = Math.round(d * 25) + 12;
    ctx.log(`sequence: ${Math.round(d * 25)} audio + 12 text = ${T} tokens`);
    const dm = 3584, L = 28, ff = 18944;
    const perTok = L * (4 * dm * dm + 3 * dm * ff) * 2;
    ctx.log(`≈ ${(perTok / 1e9).toFixed(1)} GFLOPs per token (28 layers, d=${dm}, MLP ${ff})`);
    ctx.log(`attention scores per layer per head: ${T}² = ${(T * T).toLocaleString()}`);
    ctx.log(`whole forward pass ≈ ${((perTok * T) / 1e12).toFixed(2)} TFLOPs for your ${d.toFixed(1)} s clip`, "ok");
  },
};

// ---------------------------------------------------------------- 12 · LM head

const STORIES: Record<string, string[][]> = {
  voice: [["A", "Someone", "The", "It"], ["voice", "person", "singer", "synth"], ["singing", "saying", "humming", "making"], ["three", "long", "the", "open"], ["vowels", "notes", "sounds", "tones"], [":", ",", ".", "—"], ["ah", "a", "oh", "eh"], [",", "…", "-", "."], ["ee", "i", "eh", "e"], [",", "and", "then", "."], ["oo", "u", "oh", "o"], [".", "!", "…", ","]],
  chord: [["A", "Some", "The", "Piano"], ["piano", "major", "bright", "single"], ["chord", "arpeggio", "note", "melody"], [",", "in", "being", "that"], ["C", "probably", "rolled", "struck"], ["major", "maj", "chord", "triad"], [".", ",", "!", "…"]],
  birds: [["Birds", "A", "Some", "High"], ["chirping", "singing", "tweeting", "calling"], ["outside", "in", "rapidly", "high"], [".", ",", "!", "…"]],
  drums: [["A", "Some", "The", "Drum"], ["drum", "beat", "rock", "simple"], ["beat", "loop", "pattern", "groove"], ["at", "around", "with", ","], ["120", "about", "a", "medium"], ["bpm", "BPM", "tempo", "beats"], [".", ",", "!", "…"]],
  rain: [["Rain", "Steady", "Heavy", "Water"], ["falling", "on", "pattering", "hitting"], ["on", "against", "outside", "onto"], ["a", "the", "some", "metal"], ["roof", "window", "surface", "street"], [".", ",", "…", "!"]],
  pingpong: [["A", "Notes", "Tones", "Marimba"], ["marimba", "bell", "melody", "xylophone"], ["bouncing", "panning", "alternating", "moving"], ["left", "between", "side", "across"], ["and", "to", "&", ","], ["right", "left", "back", "speakers"], [".", ",", "!", "…"]],
  sweep: [["A", "The", "One", "Rising"], ["tone", "sine", "test", "pitch"], ["sweeping", "rising", "gliding", "going"], ["upward", "up", "from", "higher"], ["in", "through", "across", "over"], ["pitch", "frequency", "tone", "range"], [".", ",", "!", "…"]],
  other: [["This", "It", "Someone", "A"], ["sounds", "is", "seems", "recording"], ["like", "to", "as", "of"], ["a", "someone", "speech", "people"], ["person", "voice", "recording", "room"], ["speaking", "talking", "nearby", "."], [".", ",", "!", "…"]],
};

type HeadMode = "text" | "audio";

export const head: Lesson = {
  id: "head",
  title: "The LM head: choosing what comes next",
  chapter: "Understand",
  blurb: "The last layer's vector is multiplied against every entry in the vocabulary to give one score each. Softmax turns the scores into probabilities, and sampling picks one.",
  rail: [9],
  rate: { value: "≈ 50 b/s", note: "≈ 3 words/s × 17 bits" },
  tabs: {
    overview: `
      <p class="lead">The <b>LM head</b> is one big matrix: hidden size × vocabulary size (e.g. 3584 × 151,646).</p>
      <p>Multiplying the final hidden vector by it gives a <b>logit</b>, a raw score, for every token. <b>Softmax</b> turns those into probabilities that sum to 1. Then the model <b>samples</b>:</p>
      <ul>
        <li><b>Temperature</b> divides the logits first. Below 1 sharpens the distribution toward the top choice; above 1 flattens it.</li>
        <li><b>Top-p</b> keeps only the most likely tokens whose probabilities add up to <code>p</code>, and samples from those.</li>
      </ul>
      <p>Press <b>Sample</b> repeatedly to build a caption for your clip. Then switch to <b>Audio head</b>: a speech model's head can output <i>sound tokens</i> too.</p>`,
    hood: `
      <p><b>The sampling is real; the scores are made up.</b> Temperature, softmax, top-p and the random draw run exactly as in a real model. The logits come from a small hand-written table per sound, standing in for a real 7B model.</p>
      <p>A model that <b>speaks</b> has an output vocabulary that includes audio codes, and it predicts a codec frame instead of a word. With 8 RVQ codebooks per frame, that's 8 predictions per 80 ms. Moshi's <b>Depth Transformer</b> makes those 8 predictions one after another, each conditioned on the previous ones (next lesson).</p>
      <p>The codec decoder (Mimi's, here) turns the predicted codes back into a waveform.</p>`,
    lost: `
      <p class="lostline"><b>Everything that isn't the next token.</b> The head reduces a 3,584-dimensional understanding of the audio to a single choice. The answer is the bottleneck: if the vocabulary has no good way to say it, or the training never rewarded saying it, it doesn't get said.</p>
      <p>The output rate is tiny. A caption at ~3 tokens/s carries about 50 bits/s, where we started at 2.3 million.</p>`,
    specs: [
      ["Qwen2 vocab", "151,646 tokens"],
      ["Llama-3 vocab", "128,256 tokens"],
      ["Head", "Linear(d_model → V), often tied"],
      ["Moshi text vocab", "32,000"],
      ["Mimi audio vocab", "2048 per codebook × 8"],
    ],
  },
  code: `import torch

h = hidden_states[-1][:, -1]            # (1, 3584) last position
logits = h @ model.lm_head.weight.T     # (1, 151646)

def sample(logits, temperature=0.8, top_p=0.9):
    p = torch.softmax(logits / temperature, -1)
    sp, idx = p.sort(descending=True)
    keep = sp.cumsum(-1) - sp < top_p    # nucleus
    sp = sp * keep
    return idx[torch.multinomial(sp / sp.sum(), 1)]

next_id = sample(logits)
print(tokenizer.decode(next_id))`,
  mount(ctx) {
    const { root, audio } = ctx;
    let temp = 0.8, topP = 0.9, mode: HeadMode = "text";
    let out: string[] = [], step = 0, codeOut: number[][] = [];
    const r = rng(Date.now() % 100000);
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const pD = el("div", { class: "panel", style: "flex:1.4" }, el("span", { class: "panel-title" }, "Probabilities after temperature + top-p"));
    const pO = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Output so far"));
    row.append(pD, pO);
    root.append(row);
    const sEnt = stat("Entropy"), sKept = stat("Tokens kept"), sTop = stat("Top choice");
    const sampleBtn = button("▶ Sample next", () => doSample(), "btn primary");
    root.append(controls(
      segmented<HeadMode>("Head", [["text", "Text head"], ["audio", "Audio head"]], mode, (v) => { mode = v; reset(); }),
      slider({ label: "Temperature", min: 0.1, max: 2, step: 0.05, value: temp, fmt: (v) => v.toFixed(2), onInput: (v) => (temp = v) }),
      slider({ label: "Top-p", min: 0.1, max: 1, step: 0.01, value: topP, fmt: (v) => v.toFixed(2), onInput: (v) => (topP = v) }),
    ), controls(sampleBtn, button("Reset", () => reset(), "btn")), el("div", { class: "stat-row" }, sEnt, sKept, sTop));
    const D = surface(pD), O = surface(pO);
    const story = () => STORIES[audio.clip.source === "specimen" ? audio.clip.id : "other"];
    const reset = () => { out = []; step = 0; codeOut = []; };
    const off = audio.on(reset);
    // text logits: candidate 0 is the "model's" favourite, then decreasing
    const textLogits = () => {
      const s = story();
      const cands = s[Math.min(step, s.length - 1)];
      return cands.map((tok, i) => ({ tok, logit: 4 - i * 1.3 + (i === 0 ? 0.5 : 0) })).concat([{ tok: "the", logit: 0.2 }, { tok: "music", logit: -0.4 }, { tok: "noise", logit: -0.6 }, { tok: "<eos>", logit: step >= s.length ? 6 : -1.5 }]);
    };
    // audio logits: peaks around the toy codec's real code for this frame
    const audioLogits = () => {
      const c = toyCodec(audio, 64);
      const frame = Math.min(c.q.codes[0].length - 1, codeOut.length * 10);
      const cb = (codeOut.at(-1)?.length ?? 8) % 8;
      const real = c.q.codes[Math.min(cb, c.q.codes.length - 1)][frame] * 32 + 7;
      const L = new Float32Array(2048);
      const rr = rng(frame * 13 + cb);
      for (let i = 0; i < 2048; i++) L[i] = -2 + rr() * 1.5 + 6 * Math.exp(-(((i - real) / 12) ** 2)) + 3 * Math.exp(-(((i - ((real * 7) % 2048)) / 30) ** 2));
      return Array.from(L, (logit, i) => ({ tok: String(i), logit }));
    };
    function dist() {
      const L = mode === "text" ? textLogits() : audioLogits();
      const mx = Math.max(...L.map((x) => x.logit));
      const ex = L.map((x) => Math.exp((x.logit - mx) / temp));
      const z = ex.reduce((a, b) => a + b, 0);
      const probs = L.map((x, i) => ({ tok: x.tok, p: ex[i] / z }));
      const sorted = [...probs].sort((a, b) => b.p - a.p);
      let cum = 0;
      const kept = new Set<string>();
      for (const x of sorted) { if (cum >= topP && kept.size > 0) break; kept.add(x.tok); cum += x.p; }
      return { probs, sorted, kept };
    }
    function doSample() {
      const { sorted, kept } = dist();
      const pool = sorted.filter((x) => kept.has(x.tok));
      const z = pool.reduce((a, b) => a + b.p, 0);
      let u = r() * z, pick = pool[0];
      for (const x of pool) { u -= x.p; if (u <= 0) { pick = x; break; } }
      if (mode === "text") {
        if (pick.tok === "<eos>") { ctx.log("<eos>: the model chose to stop.", "dim"); reset(); return; }
        out.push(pick.tok); step++;
        ctx.log(`sampled "${pick.tok}" (p = ${pick.p.toFixed(3)})`, "dim");
        if (step > story().length + 1) reset();
      } else {
        if (!codeOut.length || codeOut.at(-1)!.length >= 8) codeOut.push([]);
        codeOut.at(-1)!.push(Number(pick.tok));
        if (codeOut.length > 10) codeOut.shift();
        ctx.log(`frame ${codeOut.length}, codebook ${codeOut.at(-1)!.length}: code ${pick.tok}`, "dim");
      }
    }
    const stop = loop(() => {
      const { probs, sorted, kept } = dist();
      {
        const { g, w, h } = D;
        g.clearRect(0, 0, w, h);
        if (mode === "text") {
          const top = sorted.slice(0, 8);
          const bh = Math.min(26, (h - 40) / top.length);
          top.forEach((x, i) => {
            const y = 30 + i * bh;
            const on = kept.has(x.tok);
            label(g, x.tok, 84, y + bh / 2 + 4, { align: "right", size: 12, mono: true, color: on ? PALETTE.navy : PALETTE.faint, weight: 500 });
            roundRect(g, 92, y + 3, Math.max(2, (w - 160) * x.p), bh - 7, 3);
            g.fillStyle = !on ? PALETTE.track : i === 0 ? PALETTE.navy : PALETTE.teal; g.fill();
            label(g, `${(x.p * 100).toFixed(1)}%`, 98 + (w - 160) * x.p, y + bh / 2 + 4, { size: 10.5, mono: true, color: PALETTE.muted, weight: 400 });
          });
        } else {
          const x0 = 16, ww = w - 32, y0 = 30, hh = h - 56;
          let mx = 0; for (const x of probs) mx = Math.max(mx, x.p);
          for (let i = 0; i < probs.length; i++) {
            const v = probs[i].p / mx;
            g.fillStyle = kept.has(probs[i].tok) ? PALETTE.teal : PALETTE.track;
            g.fillRect(x0 + (i / 2048) * ww, y0 + hh - v * hh, Math.max(1, ww / 2048), v * hh);
          }
          label(g, "codes 0 … 2047", x0, h - 8, { size: 10.5, mono: true, color: PALETTE.faint, weight: 400 });
        }
      }
      {
        const { g, w, h } = O;
        g.clearRect(0, 0, w, h);
        if (mode === "text") {
          g.font = '500 15px "Barlow", sans-serif';
          let x = 14, y = 50;
          label(g, "What do you hear?", 14, 26 + 8, { size: 12.5, color: PALETTE.muted, weight: 500 });
          for (const wd of out) {
            const tw = g.measureText(wd + " ").width;
            if (x + tw > w - 14) { x = 14; y += 24; }
            g.fillStyle = PALETTE.navy; g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillText(wd, x, y + 12);
            x += tw;
          }
          g.fillStyle = PALETTE.teal; g.fillRect(x, y - 2, 2, 18);
        } else {
          const cw = Math.min(46, (w - 28) / 10), ch = Math.min(18, (h - 50) / 8);
          for (let f = 0; f < codeOut.length; f++) for (let c = 0; c < codeOut[f].length; c++) {
            roundRect(g, 14 + f * cw, 32 + c * ch, cw - 3, ch - 3, 3);
            g.fillStyle = c === 0 ? PALETTE.navy : PALETTE.teal; g.globalAlpha = c === 0 ? 1 : 0.4 + 0.6 * (1 - c / 8); g.fill(); g.globalAlpha = 1;
            label(g, String(codeOut[f][c]), 14 + f * cw + (cw - 3) / 2, 32 + c * ch + ch / 2 + 2, { align: "center", size: 9, mono: true, color: "#fdf8ef", weight: 500 });
          }
          label(g, "each column = 80 ms frame · rows = 8 codebooks", 14, h - 8, { size: 10.5, color: PALETTE.muted, weight: 500 });
        }
      }
      const H = -probs.reduce((a, x) => a + (x.p > 0 ? x.p * Math.log2(x.p) : 0), 0);
      sEnt.set(`${H.toFixed(2)} bits`);
      sKept.set(String(kept.size));
      sTop.set(mode === "text" ? `"${sorted[0].tok}"` : `code ${sorted[0].tok}`);
    });
    return () => { stop(); off(); D.dispose(); O.dispose(); };
  },
  run(ctx) {
    const L = [3.2, 2.1, 1.0, 0.2, -0.5];
    ctx.log(`logits ${JSON.stringify(L)}`);
    for (const T of [0.3, 0.8, 1.5]) {
      const ex = L.map((l) => Math.exp(l / T)), z = ex.reduce((a, b) => a + b, 0);
      ctx.log(`T=${T.toFixed(1)}  p = [${ex.map((e) => (e / z).toFixed(3)).join(", ")}]`);
    }
    ctx.log("Lower temperature → the top token takes nearly everything.", "ok");
  },
};
