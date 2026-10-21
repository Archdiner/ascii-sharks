import type { Lesson } from "../types";
import { RAIL } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, wave, rampColor } from "../ui/dom";
import { mel16, melDisplay } from "./shared";

const TARGET = ["sound", "microphone", "sampling", "frames", "mel", "encoder", "tokens", "projector", "layers", "head"];
const CAPTION = [
  "pressure waves",
  "a moving diaphragm",
  "48,000 numbers / s",
  "25 ms slices",
  "80 mel bands",
  "1,280-d vectors",
  "integers",
  "LM embeddings",
  "attention",
  "next token",
];

export const intro: Lesson = {
  id: "intro",
  intro: true,
  title: "How computers listen",
  chapter: "Start",
  blurb: "Follow a sound from the air in front of you to the last layer of a language model, one stage at a time, and keep count of what each stage loses.",
  rail: [],
  rate: { value: "∞ → 50 b/s", note: "air to text, roughly" },
  tabs: {
    overview: `
      <p class="lead">A voice assistant hears you, a captioner writes down what you said, a speech model talks back. Between your mouth and its answer, the sound gets turned into something else about ten times.</p>
      <p>This course goes through those stages in order. Each lesson has a live visual, a few things to change, and a <b>Try it yourself</b> snippet that runs on real audio when you press <b>▶</b>.</p>
      <h3>The route</h3>
      <ul>
        <li><b>Capture</b>: air pressure, the microphone, and the ADC (sampling and quantization).</li>
        <li><b>Represent</b>: frames, spectrograms, the mel scale, and an accounting of what gets thrown away.</li>
        <li><b>Encode</b>: the audio encoder, discrete tokens, and the projector that feeds a language model.</li>
        <li><b>Understand</b>: transformer layers and the LM head.</li>
        <li><b>Codecs</b>: Kyutai's <b>Mimi</b> codec and the <b>Moshi</b> full-duplex speech model.</li>
        <li><b>Beyond speech</b>: why sound is richer than speech, and where the field is now.</li>
      </ul>
      <p>Pick a sound in the bar below the stage, or turn on your mic. Press <kbd>Space</kbd> to play it.</p>`,
    hood: `
      <p>Nothing here is a mock-up. The audio is real: the sounds are synthesized sample by sample in your browser, and your microphone and uploaded files go through the same code.</p>
      <p>The DSP (FFT, STFT, mel filterbanks, Griffin-Lim phase reconstruction, k-means and residual vector quantization) is implemented in this site's TypeScript and runs on that audio.</p>
      <p>What isn't here is a trained neural network with billions of weights. When a lesson shows encoder activations, attention, or codec tokens, it says whether you're looking at <b>real arithmetic on your audio</b> or an <b>illustration</b> of what a trained model does.</p>`,
    lost: `
      <p class="lead">Every stage keeps less than the one before it.</p>
      <p>Machine listening is a long series of compressions. Some of them are physics (a microphone can't move infinitely fast), some are engineering (16 kHz is enough for speech), and some are choices about what the model cares about (words, not the room you said them in).</p>
      <p>Each lesson has a red <b>What's lost</b> tab. Lesson 7 lets you <i>hear</i> the losses stacked up, and the last chapter asks what a model built for speech misses about music, birds, rain and space.</p>`,
    specs: [
      ["Lessons", "16, in 6 chapters"],
      ["Audio", "Web Audio API, getUserMedia"],
      ["DSP", "TypeScript, no libraries"],
      ["Sounds", "7 synthesized + mic + upload"],
      ["Keys", "Space · R · ← →"],
    ],
  },
  code: `# The whole journey, as a sketch
import sounddevice as sd, numpy as np

x  = sd.rec(4 * 48000, samplerate=48000, channels=1)  # mic -> ADC
x  = resample(x, 48000, 16000)                        # speech rate
M  = log_mel(x, n_mels=80, hop=160)                   # 80 x 400
h  = encoder(M)                                       # 200 x 1280
z  = projector(h)                                     # 100 x 4096
y  = llm.generate(prompt + z)                         # text out
print(y)`,
  mount(ctx) {
    const { root, audio } = ctx;
    const wrap = el("div", { class: "panel", style: "flex:1" });
    root.append(wrap);
    const s = surface(wrap);
    const boxes: { x: number; y: number; w: number; h: number; i: number }[] = [];
    let hover = -1;
    s.canvas.style.cursor = "default";
    s.canvas.addEventListener("mousemove", (e) => {
      const r = s.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      hover = boxes.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h)?.i ?? -1;
      s.canvas.style.cursor = hover >= 0 ? "pointer" : "default";
    });
    s.canvas.addEventListener("mouseleave", () => (hover = -1));
    s.canvas.addEventListener("click", () => { if (hover >= 0) ctx.go(TARGET[hover]); });

    const td = new Float32Array(2048);
    const fd = new Float32Array(audio.analyser?.frequencyBinCount ?? 2048);
    root.append(el("div", { class: "callout", html: "<b>Click any stage</b> to jump to its lesson, or press <b>Start lesson 1</b>. Press <kbd>Space</kbd> to play the clip and watch the first stages react." }));

    const stop = loop((t) => {
      const { g, w, h } = s;
      g.clearRect(0, 0, w, h);
      const live = audio.live && audio.analyser;
      if (live) { audio.timeData(td); if (fd.length !== audio.analyser!.frequencyBinCount) return; audio.freqData(fd); }
      const cols = w < 640 ? 2 : 5;
      const rows = Math.ceil(RAIL.length / cols);
      const pad = 14, gap = 12;
      const bw = (w - pad * 2 - gap * (cols - 1)) / cols;
      const bh = Math.min(170, (h - pad * 2 - gap * (rows - 1)) / rows);
      const top = (h - (bh * rows + gap * (rows - 1))) / 2;
      boxes.length = 0;
      const mel = melDisplay(mel16(audio).frames);
      for (let i = 0; i < RAIL.length; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        const x = pad + c * (bw + gap), y = top + r * (bh + gap);
        boxes.push({ x, y, w: bw, h: bh, i });
        const on = hover === i;
        roundRect(g, x, y, bw, bh, 10);
        g.fillStyle = on ? "#fffaf2" : "#fbf5eb";
        g.fill();
        g.lineWidth = on ? 2 : 1.5;
        g.strokeStyle = on ? PALETTE.navy : PALETTE.lineSoft;
        g.stroke();
        label(g, String(i + 1).padStart(2, "0"), x + 10, y + 18, { mono: true, size: 10.5, color: PALETTE.faint, weight: 400 });
        label(g, RAIL[i].toUpperCase(), x + 32, y + 18, { size: 13, color: PALETTE.navy, weight: 700 });
        label(g, CAPTION[i], x + 10, y + bh - 10, { size: 12, color: PALETTE.muted, weight: 500 });
        const ix = x + 10, iy = y + 28, iw = bw - 20, ih = bh - 52;
        g.save();
        g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
        drawMini(g, i, ix, iy, iw, ih, t, live ? td : null, mel);
        g.restore();
        // connector arrow
        if (c < cols - 1 && i < RAIL.length - 1) {
          const ax = x + bw + 2, ay = y + bh / 2;
          g.strokeStyle = PALETTE.line; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + gap - 4, ay); g.stroke();
          const pulse = (t * 0.9 + i * 0.1) % 1;
          g.fillStyle = PALETTE.teal;
          g.beginPath(); g.arc(ax + pulse * (gap - 4), ay, 2, 0, 7); g.fill();
        }
      }
    });
    return () => { stop(); s.dispose(); };
  },
  run(ctx) {
    const a = ctx.audio;
    const c = a.clip;
    ctx.log(`clip: "${c.name}"  ${a.duration.toFixed(2)} s  ${c.sr} Hz  ${c.channels.length} ch`);
    ctx.log(`samples (ADC)        ${c.channels[0].length.toLocaleString()} per channel`);
    const m = mel16(a);
    ctx.log(`resample → 16 kHz    ${a.mono(16000).length.toLocaleString()} samples`);
    ctx.log(`log-mel              80 × ${m.frames.length} frames`);
    ctx.log(`encoder (stride 2)   ${Math.ceil(m.frames.length / 2)} × 1280  (Whisper-large shape)`);
    ctx.log(`projector (pool 2)   ${Math.ceil(m.frames.length / 4)} × 4096  LM tokens`);
    ctx.log("Each line holds fewer bits of the original sound than the line above it.", "ok");
  },
};

function drawMini(g: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, h: number, t: number, td: Float32Array | null, mel: Float32Array[]) {
  const mid = y + h / 2;
  const sig = (u: number) => (td ? td[Math.floor(u * 1200) % td.length] * 2.2 : 0.6 * Math.sin(u * 18 + t * 4) * Math.sin(u * 3.1 + t));
  switch (i) {
    case 0: { // air particles
      for (let cx = 0; cx < 26; cx++) for (let cy = 0; cy < 6; cy++) {
        const u = cx / 26;
        const dx = sig(u) * 6;
        g.fillStyle = PALETTE.navy2;
        g.globalAlpha = 0.35 + 0.4 * Math.abs(sig(u));
        g.beginPath(); g.arc(x + u * w + dx + 4, y + 6 + (cy / 5) * (h - 12), 1.6, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 1: { // diaphragm
      const bend = sig(0.3) * w * 0.12;
      g.strokeStyle = PALETTE.line; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + w * 0.62, y + 4); g.lineTo(x + w * 0.62, y + h - 4); g.stroke();
      g.strokeStyle = PALETTE.teal; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x + w * 0.5, y + 4); g.quadraticCurveTo(x + w * 0.5 + bend, mid, x + w * 0.5, y + h - 4); g.stroke();
      for (let k = 0; k < 4; k++) { g.strokeStyle = PALETTE.faint; g.lineWidth = 1.2; g.beginPath(); g.arc(x + w * 0.1, mid, 8 + k * 9 + ((t * 20) % 9), -0.6, 0.6); g.stroke(); }
      break;
    }
    case 2: { // samples
      g.strokeStyle = PALETTE.lineSoft; g.beginPath(); g.moveTo(x, mid); g.lineTo(x + w, mid); g.stroke();
      for (let k = 0; k < 22; k++) {
        const u = k / 21, v = sig(u);
        const px = x + u * w, py = mid - v * h * 0.42;
        g.strokeStyle = PALETTE.trace; g.lineWidth = 1; g.beginPath(); g.moveTo(px, mid); g.lineTo(px, py); g.stroke();
        g.fillStyle = PALETTE.navy; g.beginPath(); g.arc(px, py, 2.2, 0, 7); g.fill();
      }
      break;
    }
    case 3: { // frames
      const arr = Array.from({ length: 200 }, (_, k) => sig(k / 200));
      wave(g, arr, x, y, w, h, PALETTE.navy2, 1.3);
      const n = 5, fw = w / 3.2;
      for (let k = 0; k < n; k++) {
        const fx = x + ((k * w) / n + t * 12) % w;
        g.strokeStyle = k === 2 ? PALETTE.teal : PALETTE.line; g.lineWidth = k === 2 ? 2 : 1;
        roundRect(g, fx, y + 4, fw, h - 8, 4); g.stroke();
      }
      break;
    }
    case 4: { // mel
      const T = Math.min(mel.length, 60), off = Math.floor((t * 30) % Math.max(1, mel.length - T));
      const cw = w / T, ch = h / 40;
      for (let f = 0; f < T; f++) for (let m = 0; m < 40; m++) {
        const v = mel[off + f]?.[m * 2] ?? 0;
        g.fillStyle = rampColor(v);
        g.fillRect(x + f * cw, y + h - (m + 1) * ch, cw + 0.5, ch + 0.5);
      }
      break;
    }
    case 5: { // encoder activations
      const C = 16, R = 7;
      for (let a = 0; a < C; a++) for (let b = 0; b < R; b++) {
        const v = 0.5 + 0.5 * Math.sin(a * 1.7 + b * 2.3 + t * 2 + Math.sin(a * b));
        g.fillStyle = rampColor(v * 0.9);
        roundRect(g, x + (a * w) / C + 1, y + (b * h) / R + 1, w / C - 2, h / R - 2, 2); g.fill();
      }
      break;
    }
    case 6: { // tokens
      const ids = [1423, 87, 1990, 412, 1023, 5, 777, 1650, 230, 1201, 64, 999];
      g.font = '500 11px "JetBrains Mono", monospace';
      for (let k = 0; k < 12; k++) {
        const cx = x + (k % 4) * (w / 4), cy = y + Math.floor(k / 4) * (h / 3);
        const lit = Math.floor(t * 3) % 12 === k;
        roundRect(g, cx + 2, cy + 3, w / 4 - 4, h / 3 - 6, 4);
        g.fillStyle = lit ? PALETTE.navy : "#efe3d1"; g.fill();
        g.fillStyle = lit ? "#fdf8ef" : PALETTE.navy;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(ids[(k + Math.floor(t)) % 12]), cx + w / 8, cy + h / 6);
      }
      break;
    }
    case 7: { // projector: narrow -> wide
      for (let k = 0; k < 6; k++) {
        const v = 0.3 + 0.6 * Math.abs(Math.sin(k + t));
        g.fillStyle = rampColor(v);
        g.fillRect(x + 4, y + 6 + k * ((h - 12) / 6), w * 0.25, (h - 12) / 6 - 3);
      }
      g.strokeStyle = PALETTE.line; g.beginPath(); g.moveTo(x + w * 0.32, y + 6); g.lineTo(x + w * 0.55, y + h * 0.15); g.moveTo(x + w * 0.32, y + h - 6); g.lineTo(x + w * 0.55, y + h * 0.85); g.stroke();
      for (let k = 0; k < 3; k++) {
        g.fillStyle = k === Math.floor(t * 2) % 3 ? PALETTE.teal : PALETTE.tealSoft;
        g.fillRect(x + w * 0.6, y + h * 0.15 + k * (h * 0.24), w * 0.38, h * 0.2);
      }
      break;
    }
    case 8: { // attention arcs
      const n = 10;
      for (let k = 0; k < n; k++) { g.fillStyle = k < 6 ? PALETTE.teal : PALETTE.navy; g.fillRect(x + (k * w) / n + 2, y + h - 12, w / n - 4, 10); }
      const q = 6 + (Math.floor(t * 1.5) % 4);
      for (let k = 0; k < q; k++) {
        const a = x + (k + 0.5) * (w / n), b = x + (q + 0.5) * (w / n);
        g.strokeStyle = PALETTE.teal; g.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin(k * 1.3 + q));
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(a, y + h - 14); g.quadraticCurveTo((a + b) / 2, y + h - 14 - (b - a) * 0.7, b, y + h - 14); g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 9: { // head: probability bars
      const words = ["hello", "hi", "hey", "yo", "ok"];
      const ps = [0.62, 0.18, 0.11, 0.06, 0.03];
      words.forEach((wd, k) => {
        const by = y + 2 + k * (h / 5);
        g.fillStyle = k === 0 ? PALETTE.navy : PALETTE.trace;
        g.fillRect(x + 42, by + 2, (w - 50) * ps[k] * (0.9 + 0.1 * Math.sin(t * 3 + k)), h / 5 - 6);
        label(g, wd, x, by + h / 10 + 3, { mono: true, size: 10.5, color: PALETTE.ink, weight: 400 });
      });
      break;
    }
  }
}
