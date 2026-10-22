import type { Lesson } from "../types";
import { slider, segmented, toggle, button, el } from "../ui/dom";
import { bus } from "../scene/bus";
import { selfAttention, codecCodes, CODEC_K, cached, type Analysis } from "../analysis";
import { audio } from "../audio/engine";
import { SPECIMENS } from "../audio/specimens";
import { rng } from "../dsp/rand";
import { S, head, unit, screenText, heat, blit, rampCss, fmtN, partial, decodeFrames } from "./kit";

export function softmax(logits: number[], temp = 1) {
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp((l - m) / temp));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

/** Keep the most likely entries until they cover p of the probability. */
export function nucleus(p: number[], topP: number) {
  const order = [...p.keys()].sort((a, b) => p[b] - p[a]);
  const keep = new Set<number>();
  let c = 0;
  for (const i of order) { if (c >= topP && keep.size) break; keep.add(i); c += p[i]; }
  return keep;
}

const entropy = (p: number[]) => -p.reduce((a, v) => a + (v > 0 ? v * Math.log2(v) : 0), 0);

// ---------------------------------------------------------------- 11 · attention

function lmTokens(a: Analysis, pool: number) {
  return cached(`lmtok:${a.clip.id}:${a.enc.T}:${pool}`, () => {
    const last = a.enc.layers[a.enc.layers.length - 1];
    // pool like the projector, then cap at 40 tokens so every one stays visible
    const k = Math.max(pool, Math.ceil(last.length / 40));
    const out: Float32Array[] = [], loud: number[] = [];
    const mel = a.mel.frames;
    for (let i = 0; i < last.length; i += k) {
      const v = new Float32Array(last[0].length);
      const end = Math.min(last.length, i + k);
      for (let j = i; j < end; j++) for (let d = 0; d < v.length; d++) v[d] += last[j][d] / (end - i);
      out.push(v);
      const m0 = Math.floor((i / last.length) * mel.length), m1 = Math.max(m0 + 1, Math.floor((end / last.length) * mel.length));
      let s = 0; for (let j = m0; j < m1 && j < mel.length; j++) for (const x of mel[j]) s += x;
      loud.push(s / ((m1 - m0) * mel[0].length));
    }
    const lo = Math.min(...loud), hi = Math.max(...loud);
    return { vecs: out, loud: loud.map((v) => (v - lo) / (hi - lo || 1)), k };
  });
}

export const attention: Lesson = {
  id: "attention",
  short: "Attention",
  title: "Attention: how tokens read each other",
  chapter: "Understand",
  thumb: ["lm"],
  focus: ["lm"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "lm.base", icon: "cube", title: "Tokens go in", text: "Your sound's tokens first, then the text of the question.", slot: "bl" },
    { at: "lm.mid", icon: "tower", title: "One layer", text: "Attention, then a small network. Qwen2-7B stacks 28 of these.", slot: "br" },
    { at: "lm.screen", icon: "arcs", title: "Attention weights", text: "Arcs show which tokens the chosen token reads from. Thicker means more.", slot: "tl" },
    { at: "lm.top", icon: "screen", title: "To the head", text: "The last token's final vector decides the next output.", slot: "tr" },
  ],
  summary: "Inside the language model, audio tokens are handled like any other tokens. In each of its dozens of layers, every token looks at the tokens before it and pulls in what's relevant. That operation is <b>attention</b>. Here it runs on your sound's tokens, and you can change how it focuses.",
  steps: [
    "Each token's vector is turned into three vectors: a <b>query</b> (what this token is looking for), a <b>key</b> (what it contains) and a <b>value</b> (what it passes on). A trained model makes these with learned weights.",
    "The chosen token's query is compared with every token's key using a <b>dot product</b>: multiply matching numbers and add them up. A higher score means a better match.",
    "<b>Softmax</b> turns the scores into weights between 0 and 1 that add up to 1. Dividing the scores first by a temperature sets how sharply it focuses: that's the Sharpness slider.",
    "The token's new vector is the weighted average of the values. A token that attends to a loud bird call now carries information about that call.",
    "In a language model a token may only look backwards. Future tokens are hidden, which is called a <b>causal mask</b>. That's why the audio goes before the question in the prompt.",
    "A real model repeats this in about 28 layers, each with many attention \"heads\" side by side, and runs a small network after each. <b>On this page</b> there's one head, and query, key and value are the encoder's output itself: real attention arithmetic, without learned weights. Because a token always matches itself best when query and key are the same, the token itself is masked out, so you see what it takes from the others.",
  ],
  lost: `<ul>
    <li><b>Whatever the question doesn't ask about.</b> The model pulls from the audio what helps predict the next word of its answer. If training was mostly transcription, the easiest thing to learn is to find the words, and tone, rhythm and background can sit unused in the vectors.</li>
  </ul>
  <p>Audio-reasoning benchmarks (MMAU, AIR-Bench and others) keep finding that gap: models that transcribe well still fall well short of people on questions about non-speech sound, such as counting events, putting them in order, or judging pitch, distance and rhythm.</p>`,
  words: [
    ["Query, key, value", "Three vectors made from each token: what it looks for, what it offers to be matched on, and what it passes on."],
    ["Dot product", "Multiply two vectors number by number and add up the results. Large when they point the same way."],
    ["Softmax", "Turns a list of scores into probabilities: exponentiate each, then divide by the total."],
    ["Attention head", "One set of query/key/value weights. Models run many in parallel, each free to look for different things."],
    ["Causal mask", "Hides later tokens so each token can only use the past."],
    ["Layer", "One round of attention plus a small network. Models stack dozens."],
  ],
  specs: [
    ["Qwen2-7B", "28 layers, 3,584 wide, 28 query heads"],
    ["MLP inside each layer", "18,944 wide"],
    ["Helium 7B (Moshi)", "32 layers, 4,096 wide"],
    ["Work per token", "≈ 7.6 billion multiply-adds (one per weight)"],
    ["On this page", "1 head, 48 wide, no learned weights"],
  ],
  code: `import torch, torch.nn.functional as F

def attention(x, Wq, Wk, Wv, causal=True):
    q, k, v = x @ Wq, x @ Wk, x @ Wv              # (tokens, d) each
    scores = q @ k.T / k.shape[-1] ** 0.5         # every query against every key
    if causal:
        future = torch.triu(torch.ones_like(scores, dtype=torch.bool), 1)
        scores = scores.masked_fill(future, float("-inf"))
    weights = F.softmax(scores, dim=-1)           # rows add up to 1
    return weights @ v, weights

out, w = attention(audio_tokens, Wq, Wk, Wv)
print(w[-1].topk(3))                             # what the last token reads from`,
  rate: (p) => ({ value: `${+(1000 / p.hopMs / p.encStride / p.pool).toFixed(1)} tok/s`, note: "through 28 layers" }),
  mount(ctx) {
    let sharp = 5, causal = true, q = -1;
    bus.glow.set("lm", 1);
    const qS = slider({ label: "Token", min: 0, max: 1, step: 0.001, value: 0.85, onInput: (v) => (q = v) });
    ctx.row("target", "<b>Choose the token that's asking.</b> The arcs on the monitor show which earlier tokens it reads from.", qS);
    ctx.row("knob", "<b>Sharpness.</b> Low: it spreads its attention almost evenly. High: it locks onto the one or two best matches.",
      slider({ label: "Sharpness", min: 1, max: 30, value: sharp, onInput: (v) => (sharp = v) }));
    ctx.row("cut", "<b>Causal mask.</b> Turn it off to let tokens see the future, as an encoder does. Language models keep it on.", toggle("Only look back", causal, (v) => (causal = v)));
    ctx.row("wave", "Try it on <i>Drum loop</i>: a token on a hit links strongly to the other hits, because they sound alike.");
    const sN = ctx.stat("Tokens"), sTop = ctx.stat("Reads most from"), sSpread = ctx.stat("Spread");
    let att: Float32Array[] = [], img: HTMLCanvasElement | null = null, key = "";
    const compute = () => {
      const a = ctx.analysis(), t = lmTokens(a, ctx.pipe().pool);
      const k2 = `${a.clip.id}|${a.enc.T}|${sharp}|${causal}|${t.k}`;
      if (k2 !== key) {
        key = k2;
        att = selfAttention(t.vecs, sharp, causal, true);
        img = heat(att.map((r) => { let m = 0; for (const v of r) m = Math.max(m, v); return r.map((v) => Math.sqrt(v / (m || 1))); }), att.length);
      }
      return t;
    };
    // until the slider is moved, ask from the loudest token
    const queryIndex = (t: { loud: number[]; vecs: Float32Array[] }) => q < 0 ? t.loud.indexOf(Math.max(...t.loud)) : Math.min(t.vecs.length - 1, Math.floor(q * t.vecs.length));
    const tick = ctx.world.onTick(() => {
      const t = compute(), n = t.vecs.length;
      const qi = queryIndex(t);
      const row = Array.from(att[qi] ?? []);
      let best = 0; row.forEach((v, j) => { if (j !== qi && v > row[best]) best = j; });
      const sec = (j: number) => ((j * t.k * ctx.pipe().encStride * ctx.pipe().hopMs) / 1000).toFixed(2);
      sN.set(String(n));
      sTop.set(`${sec(best)} s`);
      sSpread.set(`≈ ${Math.max(1, 2 ** entropy(row)).toFixed(1)} tokens`);
    });
    ctx.screen("lm", (g, w, h) => {
      const u = unit(h), t = compute(), n = t.vecs.length;
      const qi = queryIndex(t);
      head(g, w, h, `Token ${qi} reads from…`, causal ? "look back only" : "both ways");
      const x0 = 4 * u, ww = w - 34 * u, ty = 52 * u, cw = ww / n;
      const row = att[qi] ?? new Float32Array(n);
      let mx = 0; for (const v of row) mx = Math.max(mx, v);
      // arcs from the tokens it reads, thickness = weight
      for (let j = 0; j < n; j++) {
        if (j === qi || row[j] < mx * 0.04) continue;
        const a = x0 + (j + 0.5) * cw, b = x0 + (qi + 0.5) * cw, wgt = row[j] / mx;
        g.strokeStyle = S.teal; g.globalAlpha = 0.25 + 0.75 * wgt; g.lineWidth = (0.3 + 1.4 * wgt) * u;
        g.beginPath(); g.moveTo(a, ty - 1 * u); g.quadraticCurveTo((a + b) / 2, ty - Math.min(34 * u, Math.abs(b - a) * 0.6 + 6 * u), b, ty - 1 * u); g.stroke();
      }
      g.globalAlpha = 1;
      // the tokens, brightness = loudness
      for (let j = 0; j < n; j++) {
        g.fillStyle = j === qi ? S.orange : rampCss(0.25 + 0.7 * t.loud[j]);
        g.fillRect(x0 + j * cw + 0.2 * u, ty, cw - 0.4 * u, 6 * u);
      }
      // weights as bars under each token
      const by = 62 * u, bh = 26 * u;
      for (let j = 0; j < n; j++) {
        const v = row[j] / (mx || 1);
        g.fillStyle = j === qi ? S.orange : S.teal;
        g.fillRect(x0 + j * cw + 0.3 * u, by, cw - 0.6 * u, v * bh);
      }
      screenText(g, "↑ audio tokens (brightness = loudness)     ↓ how much the orange token reads from each", x0, 96 * u, 4.2 * u, S.dim);
      if (img) blit(g, img, w - 28 * u, 16 * u, 24 * u, 24 * u, false);
      screenText(g, "all rows", w - 28 * u, 45 * u, 4 * u, S.dim);
    });
    return () => { tick(); bus.glow.delete("lm"); };
  },
  run(ctx) {
    const a = ctx.analysis(), t = lmTokens(a, ctx.pipe().pool), n = t.vecs.length;
    ctx.log(`${n} tokens from "${a.clip.name}"`);
    for (const s of [2, 5, 20]) {
      const w = selfAttention(t.vecs, s, true, true)[n - 1];
      const top = [...w.keys()].sort((x, y) => w[y] - w[x]).slice(0, 3);
      ctx.log(`sharpness ${String(s).padStart(2)}: last token → ${top.map((j) => `#${j} (${(w[j] * 100).toFixed(0)}%)`).join(", ")}, spread ≈ ${(2 ** entropy(Array.from(w))).toFixed(1)} tokens`);
    }
    ctx.log("Higher sharpness concentrates the weights on fewer tokens.", "ok");
  },
};

// ---------------------------------------------------------------- 12 · LM head

type Mode = "labels" | "audio";

/** A next-code model over codebook 1, trained on every built-in sound: an audio "language model" in miniature. */
function bigram() {
  return cached("bigram", () => {
    const K = CODEC_K;
    const counts = Array.from({ length: K }, () => new Float64Array(K).fill(0.05));
    const columns: number[][][] = Array.from({ length: K }, () => []);
    for (const s of SPECIMENS) {
      const c = codecCodes(audio.specimen(s.id));
      for (let i = 0; i < c.codes[0].length; i++) {
        if (i > 0) counts[c.codes[0][i - 1]][c.codes[0][i]] += 1;
        columns[c.codes[0][i]].push(c.codes.map((r) => r[i]));
      }
    }
    return { counts, columns };
  });
}

/**
 * Write new codec frames one at a time from the next-code model, starting at the clip's first frame.
 * Codebooks 2–8 are borrowed from a real frame with the same first code (a crude stand-in for
 * Moshi's depth transformer). Returns the first-codebook sequence and a lazy decoder.
 */
export function generateAudio(clip: import("../audio/engine").Clip, temp: number, topP: number, r: () => number, frames = 38) {
  const { counts, columns } = bigram();
  const c = codecCodes(clip);
  let cur = c.codes[0][0];
  const gen = [cur];
  for (let i = 1; i < frames; i++) {
    const p = softmax(Array.from(counts[cur], (v) => Math.log(v)), temp), keep = nucleus(p, topP);
    const z = [...keep].reduce((a, j) => a + p[j], 0);
    let u = r() * z;
    for (const j of keep) { u -= p[j]; if (u <= 0) { cur = j; break; } }
    gen.push(cur);
  }
  const cols = gen.map((g) => { const opts = columns[g]; return opts.length ? opts[Math.floor(r() * opts.length)] : [g, 0, 0, 0, 0, 0, 0, 0]; });
  const fake = { frames: cols.map(() => new Float32Array(80)), codes: Array.from({ length: 8 }, (_, s) => cols.map((col) => col[s])), recon: [] as Float32Array<ArrayBuffer>[] };
  return { codes: gen, columns: cols, audio: () => decodeFrames(cols.map((_, i) => partial(fake, i, 8))) };
}

export const headLesson: Lesson = {
  id: "head",
  short: "LM head",
  title: "The LM head: choosing an output",
  chapter: "Understand",
  thumb: ["head"],
  focus: ["head"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "head.screen", icon: "bars", title: "One score per output", text: "Every possible output gets a score. Softmax turns the scores into probabilities.", slot: "tl" },
    { at: "head.bars", icon: "target", title: "The pick", text: "Temperature and top-p decide how adventurous the choice is.", slot: "bl" },
    { at: "lm.top", icon: "tower", title: "From the last layer", text: "The final vector of the last token is what gets scored.", slot: "tr" },
  ],
  summary: "The model's last step, the <b>LM head</b>, gives every possible output a score: every word in its vocabulary, or every audio code. <b>Softmax</b> turns the scores into probabilities and the model picks one. Here the head is small enough to inspect, with one row per kind of sound.",
  steps: [
    "The head is one big table of numbers with a row for every possible output: 151,646 rows for Qwen2's vocabulary.",
    "Each row is compared with the final vector by a dot product. The result is that output's score, called a <b>logit</b>.",
    "Divide the logits by the <b>temperature</b>, then apply softmax to get probabilities that add up to 1. Low temperature makes the top choice dominate; high temperature evens them out.",
    "<b>Top-p</b> keeps only the most likely outputs until their probabilities add up to p, and discards the long tail of unlikely ones.",
    "Pick one at random according to those probabilities. Add it to the sequence and run the model again for the next token. This one-at-a-time generation is called <b>autoregressive</b>.",
    "<b>Labels mode:</b> the rows are the average features of the seven built-in sounds, and the input is the current sound's average features, so the scores are computed from your sound. <b>Audio mode:</b> the outputs are codec numbers, and a small model trained on how those numbers follow each other generates new sound.",
  ],
  lost: `<ul>
    <li><b>Everything that isn't the chosen output.</b> A rich internal description becomes one token at a time. If the vocabulary has no good word for something, or training never rewarded saying it, it isn't said.</li>
    <li><b>Bits:</b> a short caption is about 50 bits per second. The 16 kHz audio was 256,000.</li>
  </ul>`,
  words: [
    ["Logit", "The raw score for one possible output, before softmax."],
    ["Temperature", "Divides the logits before softmax. Below 1: more predictable. Above 1: more varied."],
    ["Top-p (nucleus)", "Sample only from the smallest set of outputs whose probabilities add up to p."],
    ["Vocabulary", "The full list of tokens a model can output."],
    ["Autoregressive", "Generating one token at a time, each one fed back in to produce the next."],
    ["Entropy", "How spread out the probabilities are, in bits. 0 means certain."],
  ],
  specs: [
    ["Qwen2 vocabulary", "151,646 tokens"],
    ["Llama 3 vocabulary", "128,256 tokens"],
    ["Moshi text vocabulary", "32,000"],
    ["Mimi audio vocabulary", "2,048 per codebook"],
    ["On this page", "7 labels · 32 audio codes"],
  ],
  code: `import torch

h = hidden_states[-1][:, -1]                 # final vector of the last token
logits = model.lm_head(h)                    # one score per vocabulary entry

def sample(logits, temperature=0.8, top_p=0.9):
    p = torch.softmax(logits / temperature, dim=-1)
    sp, idx = p.sort(descending=True)
    keep = sp.cumsum(-1) - sp < top_p        # smallest set covering top_p
    sp = sp * keep
    return idx[torch.multinomial(sp / sp.sum(), 1)]

print(tokenizer.decode(sample(logits)))`,
  rate: () => ({ value: "≈ 50 b/s", note: "a few words per second" }),
  mount(ctx) {
    let mode: Mode = "labels", temp = 1, topP = 0.9;
    const r = rng(Date.now() % 9973);
    let picks: string[] = [], gen: number[] = [];
    ctx.row("split", "<b>What the head chooses between.</b>",
      segmented<Mode>("Outputs", [["labels", "Sound labels"], ["audio", "Audio codes"]], mode, (v) => { mode = v; actions.replaceChildren(v === "labels" ? sampleBtn : genBtn); }));
    ctx.row("knob", "<b>Temperature.</b> In audio mode, low values loop the same few sounds and high values jump around at random.",
      slider({ label: "Temperature", min: 0.1, max: 2.5, step: 0.05, value: temp, fmt: (v) => v.toFixed(2), onInput: (v) => (temp = v) }));
    ctx.row("filter", "<b>Top-p.</b> Lower it to cut off unlikely outputs completely.",
      slider({ label: "Top-p", min: 0.1, max: 1, step: 0.01, value: topP, fmt: (v) => v.toFixed(2), onInput: (v) => (topP = v) }));
    const labelDist = () => { const L = ctx.analysis().labels; return { names: L.map((l) => l.name), p: softmax(L.map((l) => l.logit), temp) }; };
    const sampleBtn = button("▶ Pick one", () => {
      const { names, p } = labelDist(), keep = nucleus(p, topP);
      const z = [...keep].reduce((a, i) => a + p[i], 0);
      let u = r() * z, pick = [...keep][0];
      for (const i of keep) { u -= p[i]; if (u <= 0) { pick = i; break; } }
      picks = [...picks.slice(-5), names[pick]];
      ctx.log(`picked "${names[pick]}" (p = ${p[pick].toFixed(3)})`, "dim");
    }, "btn primary");
    const genBtn = button("▶ Generate 3 s and hear it", () => {
      const g2 = generateAudio(ctx.audio.clip, temp, topP, r);
      gen = g2.codes;
      ctx.log(`generated ${gen.length} frames (codebook 1): ${gen.slice(0, 16).join(" ")} …`, "dim");
      setTimeout(() => ctx.audio.playSignal([g2.audio()], 16000), 30);
    }, "btn primary");
    const actions = el("div", { class: "btns" }, sampleBtn);
    ctx.row("play", "<b>Pick.</b> In labels mode the model names the sound. In audio mode it writes 3 seconds of new codes, starting from your sound's first frame, and plays them.", actions);
    const sTop = ctx.stat("Top choice"), sP = ctx.stat("Its probability"), sH = ctx.stat("Entropy"), sK = ctx.stat("Kept by top-p");
    const nextCode = () => {
      const { counts } = bigram(), c = codecCodes(ctx.audio.clip);
      const f = ctx.audio.position() >= 0 ? Math.min(c.codes[0].length - 1, Math.floor((ctx.audio.position() / ctx.audio.duration) * c.codes[0].length)) : 0;
      const cur = gen.length ? gen[gen.length - 1] : c.codes[0][f];
      return { cur, p: softmax(Array.from(counts[cur], (v) => Math.log(v)), temp) };
    };
    const tick = ctx.world.onTick(() => {
      const d = mode === "labels" ? labelDist() : { names: [...Array(CODEC_K).keys()].map((i) => `code ${i}`), p: nextCode().p };
      const best = d.p.indexOf(Math.max(...d.p));
      sTop.set(d.names[best]); sP.set(`${(d.p[best] * 100).toFixed(1)} %`); sH.set(`${entropy(d.p).toFixed(2)} bits`); sK.set(`${nucleus(d.p, topP).size} of ${d.p.length}`);
    });
    ctx.screen("head", (g, w, h) => {
      const u = unit(h);
      if (mode === "labels") {
        const { names, p } = labelDist(), keep = nucleus(p, topP);
        head(g, w, h, `What is "${ctx.audio.clip.name}"?`, `T = ${temp.toFixed(2)}`);
        const order = [...p.keys()].sort((a, b) => p[b] - p[a]);
        const bh = 8.4 * u, x0 = 30 * u, ww = w * 0.5;
        order.forEach((i, k) => {
          const y = (16 + k * 10) * u;
          screenText(g, names[i], x0 - 2 * u, y + 6 * u, 5.4 * u, keep.has(i) ? S.ink : S.dim, "right");
          g.fillStyle = !keep.has(i) ? "#2c3a5e" : k === 0 ? S.orange : S.teal;
          g.fillRect(x0, y, Math.max(0.5 * u, ww * p[i]), bh * 0.8);
          screenText(g, `${(p[i] * 100).toFixed(1)}%`, x0 + ww * p[i] + 1.5 * u, y + 6 * u, 4.8 * u, S.dim, "left", true);
        });
        screenText(g, "picks:", w * 0.83, 22 * u, 5 * u, S.dim, "left");
        picks.slice(-6).forEach((pk, i) => screenText(g, pk, w * 0.83, (31 + i * 9) * u, 5.4 * u, S.ink, "left"));
      } else {
        const { cur, p } = nextCode(), keep = nucleus(p, topP);
        head(g, w, h, `Next code after ${cur}`, `T = ${temp.toFixed(2)}`);
        const x0 = 5 * u, ww = w - 10 * u, base = 62 * u, H = 42 * u, bw = ww / p.length;
        const mx = Math.max(...p);
        p.forEach((v, i) => { g.fillStyle = keep.has(i) ? (v === mx ? S.orange : S.teal) : "#2c3a5e"; g.fillRect(x0 + i * bw + 0.2 * u, base - (v / mx) * H, bw - 0.4 * u, (v / mx) * H); });
        screenText(g, `codes 0 – ${p.length - 1}`, x0, base + 6 * u, 4.4 * u, S.dim, "left", true);
        g.font = S.mono(4.8 * u); g.fillStyle = S.ink; g.textAlign = "left";
        g.fillText(gen.length ? gen.slice(0, 22).join(" ") : "press Generate", x0, 82 * u);
        if (gen.length > 22) g.fillText(gen.slice(22, 44).join(" "), x0, 90 * u);
      }
    });
    return () => tick();
  },
  run(ctx) {
    const L = ctx.analysis().labels;
    ctx.log(`logits for "${ctx.audio.clip.name}": ${L.map((l) => `${l.name} ${l.logit.toFixed(2)}`).join(", ")}`);
    for (const t of [0.3, 1, 2]) {
      const p = softmax(L.map((l) => l.logit), t);
      const best = p.indexOf(Math.max(...p));
      ctx.log(`T=${t.toFixed(1)}: top "${L[best].name}" ${(p[best] * 100).toFixed(0)}%, entropy ${entropy(p).toFixed(2)} bits`);
    }
    ctx.log(`Lower temperature → more certain. ${fmtN(L.length)} rows here; a real vocabulary has over 100,000.`, "ok");
  },
};
