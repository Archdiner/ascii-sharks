import type { Lesson, Ctx } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, slider, segmented, button, controls, fmtBits, heatmap, rampColor, nextFrame } from "../ui/dom";
import { rng, gaussian } from "../dsp/rand";
import { pca2 } from "../dsp/vq";
import { stat } from "./capture";
import { mel16, melDisplay, cached, drawImage, toyCodec, toyDecode } from "./shared";
import type { AudioEngine } from "../audio/engine";

// ---------------------------------------------------------------- encoder maths (real arithmetic, untrained weights)

const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));

function conv1d(X: Float32Array[], cOut: number, k: number, stride: number, seed: number): Float32Array[] {
  const cIn = X[0].length, T = X.length;
  const r = rng(seed);
  const scale = 1 / Math.sqrt(cIn * k);
  const W = Array.from({ length: cOut }, () => Array.from({ length: k }, () => Float32Array.from({ length: cIn }, () => gaussian(r) * scale)));
  const out: Float32Array[] = [];
  for (let t = 0; t * stride < T; t++) {
    const o = new Float32Array(cOut);
    for (let c = 0; c < cOut; c++) {
      let s = 0;
      for (let j = 0; j < k; j++) {
        const src = X[t * stride + j - (k >> 1)];
        if (!src) continue;
        const w = W[c][j];
        for (let i = 0; i < cIn; i++) s += w[i] * src[i];
      }
      o[c] = gelu(s);
    }
    out.push(o);
  }
  return out;
}

interface EncOut { stem: Float32Array[]; att: Float32Array[]; T: number; }

function encode(a: AudioEngine): EncOut {
  return cached(`enc:${a.clip.id}`, () => {
    const X = mel16(a).frames;
    const h1 = conv1d(X, 64, 3, 1, 1);
    const h2 = conv1d(h1, 64, 3, 2, 2);
    const d = 64;
    // sinusoidal positions, as in Whisper's encoder
    const H = h2.map((v, t) => v.map((x, i) => x + 0.15 * (i % 2 ? Math.cos(t / 10000 ** ((i - 1) / d)) : Math.sin(t / 10000 ** (i / d)))));
    // per-channel standardisation, then parameter-free attention: softmax(H Hᵀ / τ)
    const mean = new Float32Array(d), sd = new Float32Array(d);
    for (const v of H) for (let i = 0; i < d; i++) mean[i] += v[i] / H.length;
    for (const v of H) for (let i = 0; i < d; i++) sd[i] += (v[i] - mean[i]) ** 2 / H.length;
    const Z = H.map((v) => { const z = v.map((x, i) => (x - mean[i]) / (Math.sqrt(sd[i]) + 1e-6)); const n = Math.hypot(...z) || 1; return z.map((x) => x / n); });
    const att = Z.map((q) => {
      const row = new Float32Array(Z.length);
      let mx = -Infinity;
      for (let j = 0; j < Z.length; j++) { let s = 0; for (let i = 0; i < d; i++) s += q[i] * Z[j][i]; row[j] = s * 9; mx = Math.max(mx, row[j]); }
      let sum = 0;
      for (let j = 0; j < row.length; j++) { row[j] = Math.exp(row[j] - mx); sum += row[j]; }
      for (let j = 0; j < row.length; j++) row[j] /= sum;
      return row;
    });
    const stem = Z.map((z) => z.map((v) => 0.5 + v * 2.2));
    return { stem, att, T: Z.length };
  });
}

// ---------------------------------------------------------------- 8 · encoder

export const encoder: Lesson = {
  id: "encoder",
  title: "The audio encoder",
  chapter: "Encode",
  blurb: "A stack of convolutions and transformer layers turns the spectrogram into a sequence of vectors that describe what is being said, 50 per second.",
  rail: [5],
  rate: { value: "1.02 Mb/s", note: "1280 × 50/s · fp16 (Whisper large)" },
  tabs: {
    overview: `
      <p class="lead">The <b>encoder</b> reads the log-mel spectrogram and writes a <b>sequence of vectors</b>, one per time step, each describing the sound around that moment.</p>
      <p>In Whisper, two 1-D convolutions look at 3 frames at a time across all 80 bands. The second has <b>stride 2</b>, which halves the frame rate from 100/s to <b>50/s</b> (one vector per 20 ms). Sinusoidal position encodings are added, then <b>32 transformer blocks</b> (in large) let every frame attend to every other frame in the 30-second window.</p>
      <p>The panels run that stem <b>on your clip</b>: the input log-mel, the 64-channel conv output, and an attention map. <b>Hover</b> any panel to pick a frame and see which other frames it attends to.</p>`,
    hood: `
      <p><b>What's real here:</b> the log-mel, the convolutions (3-tap kernels, GELU, stride 2), the position encodings and the attention arithmetic all run on your audio.</p>
      <p><b>What isn't:</b> the weights. They're seeded random numbers, not trained ones, and the attention uses the features as their own queries and keys (<code>softmax(HHᵀ/τ)</code>) instead of learned projections. With no training, that still lights up frames that <i>sound alike</i>. A trained encoder learns to light up frames that <i>mean</i> alike.</p>
      <p>Other encoders: <b>wav2vec 2.0 / HuBERT / WavLM</b> skip the spectrogram and run 7 strided convolutions directly on the 16 kHz waveform (total stride 320 → 50 Hz), trained self-supervised by predicting masked frames. <b>BEATs</b> and <b>AudioMAE</b> cut the spectrogram into 16×16 patches like a vision transformer.</p>`,
    lost: `
      <p class="lostline"><b>Whatever the training objective didn't need.</b> Whisper was trained to output transcripts (680k hours of them), so its deep layers keep what predicts words and drop the rest: speaker identity, emotion, background, music.</p>
      <p>Probing studies on speech encoders find a pattern: early layers stay close to acoustics, middle layers carry phonetic and speaker information, and late layers specialise toward the objective. Which layer you tap matters.</p>
      <p class="lostline"><b>Time:</b> 50 Hz, one vector per 20 ms. Anything faster is blurred into a single vector.</p>
      <p class="lostline"><b>Length:</b> Whisper's encoder always sees exactly 30 s, padded or cut. Longer audio is chunked, and context across chunks is lost.</p>`,
    specs: [
      ["Whisper large-v3", "128 mel → 1280-d · 32 layers"],
      ["Conv stem", "k=3 ×2, 2nd stride 2, GELU"],
      ["Output rate", "50 Hz (20 ms) · 1500 per 30 s"],
      ["Params (encoder)", "≈ 635 M (large)"],
      ["wav2vec 2.0 / HuBERT", "waveform, stride 320 → 50 Hz, 768/1024-d"],
      ["Here", "64 ch, seeded weights, τ = 1/9"],
    ],
  },
  code: `import torch, whisper

model = whisper.load_model("large-v3")
audio = whisper.pad_or_trim(whisper.load_audio("clip.wav"))   # 30 s
mel = whisper.log_mel_spectrogram(audio, n_mels=128)          # (128, 3000)

with torch.no_grad():
    x = torch.nn.functional.gelu(model.encoder.conv1(mel[None]))
    x = torch.nn.functional.gelu(model.encoder.conv2(x))   # stride 2
    print(x.shape)                                          # (1, 1280, 1500)
    h = model.encoder(mel[None])                            # 32 blocks
print(h.shape)                                              # (1, 1500, 1280)`,
  mount(ctx) {
    const { root, audio } = ctx;
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const pIn = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "1 · log-mel in · 80 × 100/s"));
    const pSt = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "2 · conv stem · 64 × 50/s"));
    const pAt = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "3 · attention · 50 × 50"));
    row.append(pIn, pSt, pAt);
    const table = el("div", { class: "callout", style: "font-family:var(--mono);font-size:12px;line-height:1.7" });
    root.append(row, table);
    const I = surface(pIn), S = surface(pSt), A = surface(pAt);
    let enc = encode(audio), imIn = heatmap(melDisplay(mel16(audio).frames), 160), imSt = heatmap(enc.stem, 128), imAt = heatmap(enc.att.map((r) => { let m = 0; for (const v of r) m = Math.max(m, v); return r.map((v) => Math.sqrt(v / m)); }), enc.T);
    let sel = Math.floor(enc.T * 0.4);
    const refresh = () => {
      enc = encode(audio);
      imIn = heatmap(melDisplay(mel16(audio).frames), 160);
      imSt = heatmap(enc.stem, 128);
      imAt = heatmap(enc.att.map((r) => { let m = 0; for (const v of r) m = Math.max(m, v); return r.map((v) => Math.sqrt(v / m)); }), enc.T);
      sel = Math.min(sel, enc.T - 1);
      const d = audio.duration, T100 = mel16(audio).frames.length;
      table.innerHTML = `<b>your clip, ${d.toFixed(2)} s</b><br>
        waveform 16 kHz&nbsp;&nbsp; (${audio.mono(16000).length.toLocaleString()},)<br>
        log-mel&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (80, ${T100})&nbsp;&nbsp;→ Whisper pads to (80, 3000)<br>
        conv stem&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (${enc.T}, 64)&nbsp;&nbsp; here · (1500, 1280) in Whisper-large<br>
        HuBERT path&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; waveform → 7 convs, stride 5·2·2·2·2·2·2 = 320 → (${Math.floor(audio.mono(16000).length / 320)}, 768)`;
    };
    refresh();
    const off = audio.on(refresh);
    const pick = (s: typeof I, e: PointerEvent, scale: number) => { const r = s.canvas.getBoundingClientRect(); const u = (e.clientX - r.left - 10) / (r.width - 20); sel = Math.max(0, Math.min(enc.T - 1, Math.floor(u * enc.T * scale))); };
    I.canvas.addEventListener("pointermove", (e) => pick(I, e, 1));
    S.canvas.addEventListener("pointermove", (e) => pick(S, e, 1));
    A.canvas.addEventListener("pointermove", (e) => { const r = A.canvas.getBoundingClientRect(); const u = (e.clientY - r.top - 26) / (r.height - 36); sel = Math.max(0, Math.min(enc.T - 1, Math.floor(u * enc.T))); });
    const stop = loop(() => {
      const p = audio.position();
      if (p >= 0 && audio.playing === "clip") sel = Math.min(enc.T - 1, Math.floor((p / audio.duration) * enc.T));
      const box = (s: typeof I) => ({ x: 10, y: 26, w: s.w - 20, h: s.h - 36 });
      {
        const { g } = I; const b = box(I);
        g.clearRect(0, 0, I.w, I.h);
        drawImage(g, imIn, b.x, b.y, b.w, b.h);
        // receptive field of the selected output frame: 2 conv layers of k=3 → ±3 input frames around 2t
        const fx = b.x + ((sel * 2 - 3) / (enc.T * 2)) * b.w, fw = (7 / (enc.T * 2)) * b.w;
        g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.strokeRect(fx, b.y, Math.max(3, fw), b.h);
      }
      {
        const { g } = S; const b = box(S);
        g.clearRect(0, 0, S.w, S.h);
        drawImage(g, imSt, b.x, b.y, b.w, b.h, false);
        const fx = b.x + (sel / enc.T) * b.w;
        g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.strokeRect(fx, b.y, Math.max(2, b.w / enc.T), b.h);
      }
      {
        const { g } = A; const b = box(A);
        g.clearRect(0, 0, A.w, A.h);
        const side = Math.min(b.w, b.h);
        const ax = b.x + (b.w - side) / 2;
        drawImage(g, imAt, ax, b.y, side, side, false);
        const ry = b.y + (sel / enc.T) * side;
        g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.strokeRect(ax, ry, side, Math.max(2, side / enc.T));
        label(g, "query frame →", ax - 2, ry + 4, { align: "right", size: 9.5, color: PALETTE.rust, weight: 600 });
        label(g, "keys (all frames) →", ax + side, b.y + side + 10, { align: "right", size: 9.5, color: PALETTE.faint, weight: 600 });
      }
    });
    return () => { stop(); off(); I.dispose(); S.dispose(); A.dispose(); };
  },
  run(ctx) {
    const a = ctx.audio;
    const m = mel16(a).frames;
    ctx.log(`log-mel      (${m.length}, 80)`);
    const e = encode(a);
    ctx.log(`conv1 k=3    (${m.length}, 64)  GELU`);
    ctx.log(`conv2 k=3 s2 (${e.T}, 64)  GELU   ${(e.T / a.duration).toFixed(1)} frames/s`);
    ctx.log(`+ sinusoidal positions, attention (${e.T} × ${e.T})`);
    const f = Math.floor(e.T / 2);
    const top = [...e.att[f].keys()].filter((j) => Math.abs(j - f) > 3).sort((x, y) => e.att[f][y] - e.att[f][x]).slice(0, 3);
    ctx.log(`frame ${f} (${(f * 0.02).toFixed(2)} s) attends most to frames ${top.map((j) => `${j} (${(j * 0.02).toFixed(2)} s)`).join(", ")}`, "ok");
    ctx.log("Untrained: it finds frames that sound alike. Training makes it find frames that mean alike.", "dim");
  },
};

// ---------------------------------------------------------------- 9 · tokens

export const tokens: Lesson = {
  id: "tokens",
  title: "From vectors to tokens",
  chapter: "Encode",
  blurb: "Language models eat integers. Vector quantization snaps every frame to the nearest entry in a codebook, and residual quantization repeats that on what's left over.",
  rail: [6],
  rate: { value: "≈ 0.4–6 kb/s", note: "codes × log2(K) × frame rate" },
  tabs: {
    overview: `
      <p class="lead">To let a language model predict audio, the way it predicts words, audio has to become a sequence of <b>integers</b>.</p>
      <p><b>Vector quantization (VQ)</b> learns a <b>codebook</b> of <code>K</code> typical vectors. Each frame is replaced by the <i>index</i> of the nearest one. With K = 1024, every frame becomes a 10-bit number.</p>
      <p>One codebook is coarse. <b>Residual VQ (RVQ)</b> quantizes the frame, subtracts the chosen codeword, quantizes the <i>leftover</i> with a second codebook, and so on. Each stage adds detail, like successive decimal places.</p>
      <p>This panel trains real codebooks with k-means <b>on your clip's</b> log-mel frames. Each dot is a frame, projected to 2-D. Add stages and watch the error bars shrink, then press <b>Hear decode</b>.</p>`,
    hood: `
      <p>Two families of tokens:</p>
      <ul>
        <li><b>Semantic tokens</b>: k-means on a self-supervised encoder's features (HuBERT with K=500, w2v-BERT). They carry <i>what</i> was said, and you can't resynthesize the voice from them alone.</li>
        <li><b>Acoustic tokens</b>: from a neural codec (SoundStream, EnCodec, DAC) trained to <i>reconstruct</i> the waveform. RVQ with 8–32 codebooks of 1024 entries.</li>
      </ul>
      <p>Neural codecs learn the encoder, codebooks and decoder end-to-end, with adversarial losses so the output sounds real. What runs here is k-means on mel frames, which is the same idea with no learning and a Griffin-Lim decoder. That's why it sounds rough.</p>
      <p>Bitrate = <code>stages × log₂K × frames/s</code>. EnCodec at 24 kHz uses 75 frames/s; 8 codebooks × 10 bits × 75 = <b>6 kb/s</b>.</p>`,
    lost: `
      <p class="lostline"><b>Everything between codewords.</b> A frame becomes one of K possibilities. Only the codebook's typical sounds can be represented, and anything unusual gets snapped to its nearest typical neighbour.</p>
      <p class="lostline"><b>Rare sounds.</b> Codebooks are trained on a dataset. Sounds that were rare in training (a specific instrument, an animal call, a language not in the data) are represented badly.</p>
      <p>Dropping the later RVQ stages keeps the coarse content and loses the fine detail. That's how codecs offer several bitrates from one model.</p>`,
    specs: [
      ["HuBERT units", "K = 500 · 50 Hz · ≈ 450 b/s"],
      ["EnCodec 24 kHz", "75 Hz · ≤ 32 × 1024 · 1.5–24 kb/s"],
      ["DAC 44.1 kHz", "86 Hz · 9 × 1024 · 7.7 kb/s"],
      ["Mimi", "12.5 Hz · 8 × 2048 · 1.1 kb/s"],
      ["Here", "125 Hz · log-mel 80 · k-means"],
    ],
  },
  code: `import numpy as np
from sklearn.cluster import KMeans

frames = logmel.T                       # (T, 80)
residual, recon, codes = frames.copy(), 0, []
for stage in range(8):                  # residual VQ
    km = KMeans(n_clusters=64).fit(residual)
    idx = km.predict(residual)          # one integer per frame
    q = km.cluster_centers_[idx]
    codes.append(idx)
    recon = recon + q
    residual = frames - recon
    print(stage + 1, "stages  mse", np.mean(residual ** 2))`,
  mount(ctx) {
    const { root, audio } = ctx;
    let K = 64, stages = 2;
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const pS = el("div", { class: "panel", style: "flex:1.15" }, el("span", { class: "panel-title" }, "Frames (dots) and codewords (rings) · PCA"));
    const col = el("div", { class: "viz-col", style: "flex:1" });
    const pM = el("div", { class: "panel", style: "flex:1.2" }, el("span", { class: "panel-title" }, "Original vs decoded log-mel"));
    const pE = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Error after each stage"));
    col.append(pM, pE);
    row.append(pS, col);
    const strip = el("div", { class: "callout", style: "font-family:var(--mono);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" });
    root.append(row, strip);
    const sBits = stat("Bits / frame"), sRate = stat("Bitrate (125 fps)"), sMse = stat("Error kept");
    const stS = slider({ label: "RVQ stages", min: 1, max: 8, value: stages, onInput: (v) => { stages = v; } });
    root.append(controls(
      segmented("Codebook K", [["16", "16"], ["64", "64"], ["256", "256"]], "64", async (v) => { K = Number(v); await train(); }),
      stS,
      button("▶ Hear decode", async () => { ctx.log(`Decoding ${stages} stage(s) with Griffin-Lim…`, "dim"); await nextFrame(); audio.playSignal([toyDecode(codec, stages)], 16000); }, "btn primary"),
      button("▶ Original", () => audio.playClip(), "btn"),
    ), el("div", { class: "stat-row" }, sBits, sRate, sMse));
    const SC = surface(pS), MM = surface(pM), EE = surface(pE);
    let codec = toyCodec(audio, K);
    let proj = pca2(codec.frames), pts = codec.frames.map(proj), imOrig: HTMLCanvasElement | null = null;
    const imRec: (HTMLCanvasElement | null)[] = [];
    let melMax = 0;
    const scaleMel = (f: Float32Array) => f.map((v) => Math.max(0, (v - melMax + 6) / 6) * 0.96);
    async function train() {
      if (!codec || codec.K !== K) { strip.textContent = `training ${8} codebooks of ${K} on ${codec?.frames.length ?? "…"} frames…`; await nextFrame(); }
      codec = toyCodec(audio, K);
      proj = pca2(codec.frames);
      pts = codec.frames.map(proj);
      melMax = -Infinity;
      for (const f of codec.frames) for (const v of f) melMax = Math.max(melMax, v);
      imOrig = heatmap(codec.frames.map(scaleMel), 80);
      imRec.length = 0;
    }
    void train();
    const off = audio.on(() => void train());
    const stop = loop(() => {
      const q = codec.q;
      const s = Math.min(stages, q.recon.length);
      // scatter
      {
        const { g, w, h } = SC;
        g.clearRect(0, 0, w, h);
        let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
        for (const [x, y] of pts) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
        const X = (v: number) => 16 + ((v - mnx) / (mxx - mnx || 1)) * (w - 32);
        const Y = (v: number) => 30 + ((v - mny) / (mxy - mny || 1)) * (h - 46);
        const recon = q.recon[s - 1];
        const c0 = q.codes[0];
        for (let i = 0; i < pts.length; i += 1) {
          const [x, y] = pts[i];
          const [rx, ry] = proj(recon[i]);
          g.strokeStyle = "#c8553f55"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(rx), Y(ry)); g.stroke();
          g.fillStyle = rampColor(0.35 + 0.6 * ((c0[i] * 0.618) % 1));
          g.beginPath(); g.arc(X(x), Y(y), 2.4, 0, 7); g.fill();
        }
        for (const c of q.books[0]) { const [x, y] = proj(c); g.strokeStyle = PALETTE.navy; g.lineWidth = 1.6; g.beginPath(); g.arc(X(x), Y(y), 5, 0, 7); g.stroke(); }
        label(g, `stage-1 codebook: ${q.books[0].length} rings · red = error left after ${s} stage${s > 1 ? "s" : ""}`, 12, h - 6, { size: 10.5, color: PALETTE.muted, weight: 500 });
      }
      // mel compare
      {
        const { g, w, h } = MM;
        g.clearRect(0, 0, w, h);
        if (!imRec[s]) imRec[s] = heatmap(q.recon[s - 1].map(scaleMel), 80);
        const bh = (h - 40) / 2;
        if (imOrig) drawImage(g, imOrig, 10, 26, w - 20, bh);
        drawImage(g, imRec[s]!, 10, 32 + bh, w - 20, bh);
        label(g, "original", w - 14, 40, { align: "right", size: 10.5, color: "#fdf8ef", weight: 700 });
        label(g, `${s} stage${s > 1 ? "s" : ""} · ${s * Math.log2(K)} bits/frame`, w - 14, 46 + bh, { align: "right", size: 10.5, color: "#fdf8ef", weight: 700 });
      }
      // error bars
      {
        const { g, w, h } = EE;
        g.clearRect(0, 0, w, h);
        const base = q.baseMse;
        const bw = (w - 40) / 9;
        const H = h - 52;
        const bars = [base, ...q.mse];
        bars.forEach((m, i) => {
          const bh = (m / base) * H;
          roundRect(g, 20 + i * bw + 3, 28 + H - bh, bw - 6, bh, 3);
          g.fillStyle = i === 0 ? PALETTE.trace : i <= s ? PALETTE.teal : PALETTE.track; g.fill();
          label(g, i === 0 ? "0" : String(i), 20 + i * bw + bw / 2, h - 10, { align: "center", size: 10, mono: true, color: PALETTE.faint, weight: 400 });
        });
      }
      const bits = s * Math.log2(K);
      sBits.set(`${bits}`);
      sRate.set(fmtBits(bits * 125));
      sMse.set(`${((100 * q.mse[s - 1]) / q.baseMse).toFixed(1)} %`);
      const ids = Array.from({ length: Math.min(s, 4) }, (_, k) => `c${k + 1}: ${Array.from(q.codes[k].subarray(0, 40)).join(" ")}`);
      strip.textContent = ids.join("   ");
    });
    return () => { stop(); off(); SC.dispose(); MM.dispose(); EE.dispose(); };
  },
  async run(ctx) {
    const a = ctx.audio;
    for (const K of [16, 64, 256]) {
      ctx.log(`training RVQ, K=${K}…`, "dim");
      await nextFrame();
      const c = toyCodec(a, K);
      ctx.log(`K=${String(K).padStart(3)}  ` + c.q.mse.map((m, i) => `${i + 1}:${((100 * m) / c.q.baseMse).toFixed(0)}%`).join(" "));
    }
    const c = toyCodec(a, 64);
    ctx.log(`first frames, codebook 1: [${Array.from(c.q.codes[0].subarray(0, 16)).join(", ")}, …]`, "ok");
    ctx.log("Each list of integers is now something a language model could learn to predict.", "dim");
  },
};

// ---------------------------------------------------------------- 10 · projector

type ProjMode = "stack" | "qformer" | "codes";

export const projector: Lesson = {
  id: "projector",
  title: "The projector: audio into the LM",
  chapter: "Encode",
  blurb: "An adapter reshapes encoder output into vectors the size of a word embedding and slips them into the prompt. Its pooling factor decides how many tokens a second of audio costs.",
  rail: [7],
  rate: { value: "25 tok/s", note: "× 4096-d (Qwen2-Audio-style)" },
  tabs: {
    overview: `
      <p class="lead">A language model reads a sequence of <b>embeddings</b>, one per token, each a vector of maybe 4,096 numbers. Encoder output doesn't fit: wrong size, and too many per second.</p>
      <p>The <b>projector</b> (also called an adapter or connector) fixes both. The most common design:</p>
      <ul>
        <li><b>Stack</b> or pool <code>k</code> neighbouring encoder frames into one (50 Hz → 50/k Hz).</li>
        <li>Push the result through a small <b>MLP</b> into the LM's embedding size.</li>
        <li>Put the resulting "audio tokens" into the prompt between markers, next to ordinary text tokens.</li>
      </ul>
      <p>The LM is then fine-tuned (often with the encoder frozen) on audio-text pairs. Drag <b>k</b> and watch the token budget change.</p>`,
    hood: `
      <p>Three ways in:</p>
      <ul>
        <li><b>Pool + MLP</b>: LLaVA-style. Qwen2-Audio pools Whisper's 50 Hz output by 2 → <b>25 tokens/s</b>. Ultravox, LLaMA-Omni and others stack frames and use a 2-layer MLP.</li>
        <li><b>Q-Former</b>: a small transformer with a few learned query vectors that cross-attend to the encoder output and summarize it. SALMONN uses one query per ≈0.33 s window, over Whisper + BEATs features.</li>
        <li><b>Discrete codes</b>: no projector at all. The LM's vocabulary is extended with codec tokens, and each token gets an embedding row like any word. Moshi sums the embeddings of all codebooks in a frame into one input vector per 80 ms step.</li>
      </ul>`,
    lost: `
      <p class="lostline"><b>Temporal detail, again.</b> Pooling by k averages k frames. At 25 Hz, each audio token covers 40 ms; Q-Formers compress further.</p>
      <p class="lostline"><b>What the adapter wasn't trained on.</b> The projector and LM learn from paired data, mostly ASR transcripts and audio captions. If no training example ever asked about reverb, pitch or a cough, those features may reach the LM but go unused.</p>
      <p>The budget matters too. An hour at 25 tokens/s is 90,000 tokens, most of a 128k context. That's why long-audio understanding is still hard.</p>`,
    specs: [
      ["Qwen2-Audio", "Whisper-large-v3 · pool 2 · 25 Hz"],
      ["SALMONN", "Whisper + BEATs · window Q-Former"],
      ["Ultravox", "Whisper enc · stack 8 · MLP"],
      ["Moshi", "sum of 8 codebook embeddings · 12.5 Hz"],
      ["LM width", "3584 (Qwen2-7B) · 4096 (Llama-3-8B)"],
    ],
  },
  code: `import torch, torch.nn as nn

class Projector(nn.Module):
    def __init__(self, d_enc=1280, d_lm=4096, k=2):
        super().__init__()
        self.k = k
        self.mlp = nn.Sequential(nn.Linear(d_enc * k, d_lm),
                                 nn.GELU(), nn.Linear(d_lm, d_lm))
    def forward(self, h):                       # (B, T, 1280) at 50 Hz
        B, T, D = h.shape
        h = h[:, : T // self.k * self.k].reshape(B, T // self.k, D * self.k)
        return self.mlp(h)                      # (B, T/k, 4096)

audio_tok = Projector()(encoder_out)
inputs = torch.cat([embed(prompt_ids), audio_tok, embed(question_ids)], 1)`,
  mount(ctx) {
    const { root, audio } = ctx;
    let k = 2, mode: ProjMode = "stack";
    const p = el("div", { class: "panel", style: "flex:1" });
    root.append(p);
    const sTps = stat("Tokens / s"), s30 = stat("30 s clip"), sHr = stat("1 hour"), sCtx = stat("Hour vs 128k ctx");
    const kS = slider({ label: "Pool k", min: 1, max: 8, value: k, onInput: (v) => (k = v) });
    root.append(controls(segmented<ProjMode>("Connector", [["stack", "Stack + MLP"], ["qformer", "Q-Former"], ["codes", "Codec tokens"]], mode, (v) => (mode = v)), kS),
      el("div", { class: "stat-row" }, sTps, s30, sHr, sCtx));
    const S = surface(p);
    const stop = loop((t) => {
      const { g, w, h } = S;
      g.clearRect(0, 0, w, h);
      const enc = encode(audio).stem;
      const rate = mode === "stack" ? 50 / k : mode === "qformer" ? 3 : 12.5;
      const showN = Math.min(48, Math.floor((w - 40) / 13));
      const cw = (w - 40) / showN;
      // row A: encoder frames
      const yA = 34;
      label(g, mode === "codes" ? "CODEC FRAMES · 12.5 Hz · 8 CODEBOOKS EACH" : "ENCODER OUTPUT · 50 Hz · 1280-d", 20, yA - 8, { size: 10.5, color: PALETTE.navy, weight: 700 });
      const nA = mode === "codes" ? Math.ceil(showN / 4) : showN;
      const aw = mode === "codes" ? cw * 4 : cw;
      for (let i = 0; i < nA; i++) {
        const fr = enc[Math.min(enc.length - 1, i * (mode === "codes" ? 4 : 1))];
        const rows = mode === "codes" ? 8 : 10;
        for (let r = 0; r < rows; r++) {
          g.fillStyle = mode === "codes" ? rampColor(((fr[r * 5] * 9973 + r * 0.37) % 1 + 1) % 1 * 0.8 + 0.1) : rampColor(fr[r * 6] ?? 0.5);
          g.fillRect(20 + i * aw + 1, yA + r * 7, aw - 2, 6);
        }
      }
      // brackets
      const yB = yA + 92;
      const group = mode === "stack" ? k : mode === "qformer" ? 17 : 1;
      const nB = Math.floor(nA / (mode === "codes" ? 1 : group));
      label(g, mode === "stack" ? `STACK ${k} → MLP → 4096-d` : mode === "qformer" ? "Q-FORMER · 1 LEARNED QUERY PER 17 FRAMES (0.33 s)" : "EMBED EACH CODE, SUM THE 8 → 4096-d", 20, yB - 14, { size: 10.5, color: PALETTE.navy, weight: 700 });
      const pulse = (t * 0.6) % 1;
      for (let i = 0; i < Math.max(1, nB); i++) {
        const gx = 20 + i * group * aw, gw = group * aw;
        if (gx + gw > w - 10 && mode !== "qformer") break;
        g.strokeStyle = PALETTE.line; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(gx + 2, yA + 74); g.lineTo(gx + gw / 2, yB - 6); g.lineTo(gx + Math.min(gw, w - 30 - gx) - 2, yA + 74); g.stroke();
        const ex = gx + gw / 2 - Math.max(3, Math.min(gw - 4, 18)) / 2;
        const ew = Math.max(4, Math.min(gw - 4, 18));
        for (let r = 0; r < 14; r++) { g.fillStyle = rampColor(0.3 + 0.5 * Math.abs(Math.sin(i * 1.3 + r * 0.7))); g.fillRect(ex, yB + r * 4.5, ew, 3.8); }
        if (i === Math.floor(pulse * Math.max(1, nB))) { g.strokeStyle = PALETTE.orange; g.lineWidth = 2; g.strokeRect(ex - 2, yB - 2, ew + 4, 14 * 4.5 + 3); }
      }
      // row C: the prompt
      const yC = yB + 96;
      label(g, "WHAT THE LANGUAGE MODEL READS", 20, yC - 10, { size: 10.5, color: PALETTE.navy, weight: 700 });
      const toks: [string, "t" | "a" | "m"][] = [["<|user|>", "m"], ["<audio>", "m"]];
      const nAudio = Math.min(Math.max(1, nB), 14);
      for (let i = 0; i < nAudio; i++) toks.push(["", "a"]);
      if (nB > 14) toks.push(["…", "m"]);
      toks.push(["</audio>", "m"], ["What", "t"], ["is", "t"], ["this", "t"], ["sound", "t"], ["?", "t"]);
      let x = 20, y = yC;
      g.font = '500 11.5px "JetBrains Mono", monospace';
      for (const [s, kind] of toks) {
        const tw = kind === "a" ? 16 : g.measureText(s).width + 12;
        if (x + tw > w - 16) { x = 20; y += 30; }
        roundRect(g, x, y, tw, 22, 5);
        g.fillStyle = kind === "a" ? PALETTE.teal : kind === "m" ? "#efe3d1" : "#fdf9f1"; g.fill();
        g.strokeStyle = kind === "t" ? PALETTE.line : "transparent"; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = kind === "m" ? PALETTE.muted : PALETTE.navy;
        g.textAlign = "left"; g.textBaseline = "middle"; if (s) g.fillText(s, x + 6, y + 11.5);
        x += tw + 5;
      }
      label(g, `■ audio tokens  ·  ${Math.round(rate * audio.duration)} for your ${audio.duration.toFixed(1)} s clip`, 20, y + 42, { size: 11.5, color: PALETTE.tealDeep, weight: 600 });
      sTps.set(rate.toFixed(rate < 10 ? 1 : 0));
      s30.set(`${Math.round(rate * 30)} tok`);
      sHr.set(`${Math.round(rate * 3600).toLocaleString()} tok`);
      sCtx.set(`${Math.round((rate * 3600 * 100) / 128000)} %`);
      kS.style.opacity = mode === "stack" ? "1" : "0.35";
    });
    return () => { stop(); S.dispose(); };
  },
  run(ctx: Ctx) {
    const d = ctx.audio.duration;
    ctx.log(`clip ${d.toFixed(2)} s → encoder ${Math.round(d * 50)} frames @ 50 Hz × 1280`);
    for (const k of [1, 2, 4, 8]) ctx.log(`pool k=${k}  →  ${String(Math.round((d * 50) / k)).padStart(4)} audio tokens × 4096  ·  1 h = ${Math.round((3600 * 50) / k).toLocaleString()} tokens`);
    ctx.log(`Mimi/Moshi  →  ${Math.round(d * 12.5)} steps (8 codes each, summed)`);
    ctx.log("Fewer tokens is cheaper and longer context; more tokens keeps finer timing.", "ok");
  },
};
