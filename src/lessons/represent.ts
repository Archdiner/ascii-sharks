import type { Lesson } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, wave, segmented, toggle, button, controls, fmtHz, fmtBits, heatmap, RAMP, nextFrame } from "../ui/dom";
import { magSpectrum, hann, nextPow2 } from "../dsp/fft";
import { melBank, hzToMel, melToHz, whisperLogMel } from "../dsp/mel";
import { stft, magnitudes } from "../dsp/stft";
import { stat } from "./capture";
import { mel16, melDisplay, cached, specImage, drawImage, freqAxis, lossyChain, melFrac, type ChainOpts } from "./shared";

// ---------------------------------------------------------------- 5 · frames

export const frames: Lesson = {
  id: "frames",
  title: "Frames and the Fourier transform",
  chapter: "Represent",
  blurb: "Cut the waveform into short overlapping slices, then ask each slice which frequencies it contains. This is how most audio models first look at a signal.",
  rail: [3],
  rate: { value: "256 kb/s", note: "same samples, re-sliced" },
  tabs: {
    overview: `
      <p class="lead">A waveform tells you <i>when</i> but hides <i>what pitch</i>. The <b>Fourier transform</b> tells you what pitch but hides when.</p>
      <p>The compromise is to look at a short <b>frame</b> at a time. Speech models use <b>25 ms</b> frames, short enough that a vowel is roughly steady inside one, and step forward <b>10 ms</b> (the <b>hop</b>) between frames, so they overlap.</p>
      <p>Each frame is multiplied by a <b>window</b> (a smooth bump) so its edges fade to zero, then run through an FFT. The result shows how strong each frequency is in that 25 ms.</p>
      <p><b>Drag across the waveform</b> to move the frame, or press play and it follows along. With the Vowels sound, the peaks in the spectrum are the harmonics of the voice.</p>`,
    hood: `
      <p>An FFT of <code>N</code> samples gives <code>N/2 + 1</code> frequency bins spaced <code>sr / N</code> apart. A 25 ms frame at 16 kHz is 400 samples; Whisper zero-pads it to 512 for the FFT.</p>
      <p>There's a built-in trade-off, the <b>time–frequency uncertainty</b>: longer windows resolve pitch finely but blur fast events together, and short windows do the opposite. Try 10 ms against 100 ms on the Drum loop and then on the Piano chord.</p>
      <p>Without a window (<b>Rect</b>), the frame's hard edges smear energy across the whole spectrum. This is called <b>spectral leakage</b>.</p>`,
    lost: `
      <p class="lostline"><b>Phase, soon.</b> The FFT gives a magnitude <i>and</i> a phase for every bin. Almost every speech front end keeps only the magnitude. Phase carries the fine timing of the waveform, which matters for transients, for where a sound sits in space, and for turning the representation back into audio. Lesson 7 lets you hear it removed.</p>
      <p class="lostline"><b>Time resolution.</b> A 25 ms window can't tell apart two clicks 5 ms apart.</p>`,
    specs: [
      ["Whisper window", "25 ms · 400 samples @ 16 kHz"],
      ["Whisper hop", "10 ms · 160 samples → 100 frames/s"],
      ["FFT size", "512 (zero-padded)"],
      ["Bin spacing", "16000 / 512 = 31.25 Hz"],
      ["Window", "Hann"],
    ],
  },
  code: `import numpy as np

sr, win, hop = 16000, 400, 160          # 25 ms / 10 ms
w = np.hanning(win)

frames = [x[i:i+win] * w
          for i in range(0, len(x) - win, hop)]
spec = np.abs(np.fft.rfft(frames, n=512))   # (T, 257)

print(len(frames), "frames ->", spec.shape)
peak = spec.mean(0).argmax() * sr / 512
print("strongest bin ≈", peak, "Hz")`,
  mount(ctx) {
    const { root, audio } = ctx;
    let winMs = 25, kind: "hann" | "rect" = "hann", pos = 0.3, drag = false;
    const top = el("div", { class: "panel", style: "flex:0.8" }, el("span", { class: "panel-title" }, "Waveform · 16 kHz · drag to move the frame"));
    const row = el("div", { class: "viz-row", style: "flex:1.3" });
    const pf = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "One frame × window"));
    const ps = el("div", { class: "panel", style: "flex:1.4" }, el("span", { class: "panel-title" }, "Its spectrum (FFT magnitude)"));
    row.append(pf, ps);
    root.append(top, row);
    const sT = stat("Time resolution"), sF = stat("Bin spacing"), sN = stat("Frames (10 ms hop)"), sPk = stat("Strongest");
    root.append(controls(
      segmented("Window", [["10", "10 ms"], ["25", "25 ms"], ["50", "50 ms"], ["100", "100 ms"]], "25", (v) => (winMs = Number(v))),
      segmented("Shape", [["hann", "Hann"], ["rect", "Rect"]], kind, (v) => (kind = v as "hann" | "rect")),
    ), el("div", { class: "stat-row" }, sT, sF, sN, sPk));
    const A = surface(top), B = surface(pf), S = surface(ps);
    const setPos = (e: PointerEvent) => { const r = A.canvas.getBoundingClientRect(); pos = Math.max(0, Math.min(1, (e.clientX - r.left - 14) / (r.width - 28))); };
    A.canvas.style.cursor = "ew-resize";
    A.canvas.addEventListener("pointerdown", (e) => { drag = true; A.canvas.setPointerCapture(e.pointerId); setPos(e); });
    A.canvas.addEventListener("pointermove", (e) => drag && setPos(e));
    A.canvas.addEventListener("pointerup", () => (drag = false));
    const stop = loop(() => {
      const x = audio.mono(16000), sr = 16000;
      const p = audio.position();
      if (p >= 0 && audio.playing === "clip" && !drag) pos = Math.min(1, p / audio.duration);
      const n = Math.round((winMs / 1000) * sr);
      const start = Math.max(0, Math.min(x.length - n, Math.floor(pos * x.length - n / 2)));
      const frame = x.subarray(start, start + n);
      const w = kind === "hann" ? hann(n) : new Float32Array(n).fill(1);
      const nFft = Math.max(512, nextPow2(n));
      const mag = magSpectrum(frame, nFft, w);
      {
        const { g, w: W, h } = A;
        g.clearRect(0, 0, W, h);
        wave(g, x, 14, 24, W - 28, h - 30, PALETTE.navy2, 1, 0, x.length, 1.4);
        const fx = 14 + (start / x.length) * (W - 28), fw = Math.max(3, (n / x.length) * (W - 28));
        g.fillStyle = "#1aa3a133"; g.fillRect(fx, 22, fw, h - 26);
        g.strokeStyle = PALETTE.teal; g.lineWidth = 2; g.strokeRect(fx, 22, fw, h - 26);
        label(g, `${(start / sr).toFixed(3)} s`, fx + fw + 4, 34, { size: 10.5, mono: true, color: PALETTE.tealDeep, weight: 400 });
      }
      {
        const { g, w: W, h } = B;
        g.clearRect(0, 0, W, h);
        const y0 = 26, hh = h - 34;
        const raw = Array.from(frame);
        wave(g, raw, 12, y0, W - 24, hh, PALETTE.trace, 1.2, 0, raw.length, 1.4);
        const win = Array.from(frame, (v, i) => v * w[i]);
        wave(g, win, 12, y0, W - 24, hh, PALETTE.navy, 1.8, 0, win.length, 1.4);
        g.strokeStyle = PALETTE.teal; g.setLineDash([4, 3]); g.lineWidth = 1.2; g.beginPath();
        for (let i = 0; i < n; i++) { const px = 12 + (i / (n - 1)) * (W - 24), py = y0 + hh / 2 - w[i] * (hh / 2) * 0.95; i ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke(); g.setLineDash([]);
        label(g, `${n} samples`, W - 12, 18, { align: "right", size: 10.5, mono: true, color: PALETTE.faint, weight: 400 });
      }
      let peakBin = 1;
      {
        const { g, w: W, h } = S;
        g.clearRect(0, 0, W, h);
        const x0 = 34, y0 = 26, ww = W - 46, hh = h - 46;
        let mx = 1e-9; for (const v of mag) mx = Math.max(mx, v);
        for (let k = 2; k < mag.length; k++) if (mag[k] > mag[peakBin]) peakBin = k;
        g.strokeStyle = PALETTE.lineSoft; g.lineWidth = 1;
        for (let d = 0; d <= 80; d += 20) { const y = y0 + (d / 80) * hh; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + ww, y); g.stroke(); label(g, `-${d}`, x0 - 4, y + 3, { align: "right", size: 9.5, mono: true, color: PALETTE.faint, weight: 400 }); }
        g.beginPath();
        for (let k = 0; k < mag.length; k++) {
          const d = Math.max(-80, 20 * Math.log10(mag[k] / mx + 1e-12));
          const px = x0 + (k / (mag.length - 1)) * ww, py = y0 + (-d / 80) * hh;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.lineTo(x0 + ww, y0 + hh); g.lineTo(x0, y0 + hh); g.closePath();
        g.fillStyle = "#1aa3a12a"; g.fill();
        g.strokeStyle = PALETTE.tealDeep; g.lineWidth = 1.5; g.stroke();
        for (let f = 0; f <= 8000; f += 2000) label(g, f ? `${f / 1000}k` : "0", x0 + (f / 8000) * ww, y0 + hh + 14, { align: "center", size: 10, mono: true, color: PALETTE.faint, weight: 400 });
        const pkx = x0 + (peakBin / (mag.length - 1)) * ww;
        g.fillStyle = PALETTE.orange; g.beginPath(); g.arc(pkx, y0 + 4, 4, 0, 7); g.fill();
      }
      sT.set(`${winMs} ms`);
      sF.set(`${(sr / nFft).toFixed(1)} Hz`);
      sN.set(`${Math.max(0, Math.floor((x.length - n) / 160) + 1)}`);
      sPk.set(fmtHz((peakBin * sr) / nFft));
    });
    return () => { stop(); A.dispose(); B.dispose(); S.dispose(); };
  },
  run(ctx) {
    const x = ctx.audio.mono(16000);
    for (const [win, hop] of [[400, 160], [320, 320], [1024, 256]]) {
      const n = Math.floor((x.length - win) / hop) + 1;
      ctx.log(`win ${String(win).padStart(4)} hop ${String(hop).padStart(3)} → ${String(n).padStart(4)} frames · ${(16000 / hop).toFixed(1)} frames/s`);
    }
    const s = magnitudes(stft(x, 16000, 512, 160, 400));
    const avg = new Float32Array(257);
    for (const f of s) for (let k = 0; k < 257; k++) avg[k] += f[k];
    let pk = 1; for (let k = 2; k < 257; k++) if (avg[k] > avg[pk]) pk = k;
    ctx.log(`spec shape (${s.length}, 257); strongest bin ≈ ${Math.round((pk * 16000) / 512)} Hz`, "ok");
  },
};

// ---------------------------------------------------------------- 6 · mel

type MelMode = "linear" | "mel80" | "mel128";

export const mel: Lesson = {
  id: "mel",
  title: "Spectrograms and the mel scale",
  chapter: "Represent",
  blurb: "Stack the frames side by side and you get a picture of sound. Squeeze its frequency axis the way your ear does and you get the log-mel spectrogram, the input to Whisper and most speech models.",
  rail: [4],
  rate: { value: "256 kb/s", note: "80 floats × 100 frames/s" },
  tabs: {
    overview: `
      <p class="lead">A <b>spectrogram</b> is the frames from the last lesson laid side by side: time left to right, frequency bottom to top, loudness as colour.</p>
      <p>Ears hear pitch roughly logarithmically: 100→200 Hz sounds like the same step as 1000→2000 Hz. The <b>mel scale</b> matches that, linear below about 1 kHz and logarithmic above.</p>
      <p>A <b>mel filterbank</b> is a set of overlapping triangles that are narrow at low frequencies and wide at high ones (see the right-hand panel). It sums the 257 FFT bins into <b>80 mel bands</b>. Then a <b>log</b> compresses loudness the way ears do.</p>
      <p>The result, the <b>log-mel spectrogram</b>, is 80 numbers every 10 ms. Whisper, most ASR systems and many TTS models start from it. Switch the modes and compare.</p>`,
    hood: `
      <p>Whisper's recipe exactly: 16 kHz audio → STFT (400-sample Hann, hop 160) → power → 80 Slaney mel filters from 0–8 kHz → <code>log10</code> → clamp to within 8 (i.e. <b>80 dB</b>) of the maximum → <code>(x + 4) / 4</code>. Whisper large-v3 uses <b>128</b> bands.</p>
      <p>This is what the Run button computes on your clip, in your browser.</p>
      <p>Turn on <b>Live</b> with your mic: the spectrogram scrolls in real time from the analyser. Whistle and you get one bright line. Say "sss" and you get a smear near the top. Hum and you get a ladder of harmonics.</p>`,
    lost: `
      <ul>
        <li class="lostline"><b>Phase:</b> gone. Only magnitudes go into the filterbank.</li>
        <li class="lostline"><b>Fine pitch at the top:</b> the highest mel bands are hundreds of Hz wide. Two notes a semitone apart up there land in the same band.</li>
        <li class="lostline"><b>Quiet detail:</b> anything more than 80 dB below the loudest moment is clamped to the floor.</li>
        <li class="lostline"><b>Above 8 kHz:</b> not represented at all for a 16 kHz model.</li>
      </ul>
      <p>That's 257 bins with phase reduced to 80 magnitudes. You can't get the waveform back exactly from this, only an approximation (next lesson).</p>`,
    specs: [
      ["Input", "16 kHz mono float32"],
      ["STFT", "Hann 400 · hop 160 · n_fft 400"],
      ["Mel bands", "80 (v1–v2) · 128 (large-v3)"],
      ["Range", "0 – 8 kHz, Slaney mel"],
      ["Frames", "100 / s · 3000 per 30 s"],
      ["Scaling", "log10, clamp max−8, (x+4)/4"],
    ],
  },
  code: `import torch, torchaudio

wav, sr = torchaudio.load("clip.wav")
wav = torchaudio.functional.resample(wav.mean(0), sr, 16000)

stft = torch.stft(wav, 400, 160, window=torch.hann_window(400),
                  return_complex=True)
power = stft.abs() ** 2                       # phase dropped here
mel = torchaudio.functional.melscale_fbanks(
        201, 0, 8000, 80, 16000, norm="slaney", mel_scale="slaney")
logmel = (mel.T @ power).clamp(min=1e-10).log10()
logmel = torch.maximum(logmel, logmel.max() - 8.0)
logmel = (logmel + 4.0) / 4.0
print(logmel.shape)                           # (80, T)`,
  mount(ctx) {
    const { root, audio } = ctx;
    let mode: MelMode = "mel80", live = false;
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const main = el("div", { class: "panel", style: "flex:4" }, el("span", { class: "panel-title" }, "Spectrogram"));
    const side = el("div", { class: "panel", style: "flex:1;min-width:110px" }, el("span", { class: "panel-title" }, "Filterbank"));
    row.append(main, side);
    root.append(row);
    const sShape = stat("Shape"), sBand = stat("Top band width"), sSrc = stat("Source");
    root.append(controls(
      segmented<MelMode>("View", [["linear", "Linear 257"], ["mel80", "Mel 80"], ["mel128", "Mel 128"]], mode, (v) => { mode = v; dirty = true; }),
      toggle("Live (mic / playback)", live, (v) => { live = v; if (v && !audio.live) audio.startMic().catch(() => ctx.log("Mic unavailable; play the clip instead.", "warn")); }),
    ), el("div", { class: "stat-row" }, sShape, sBand, sSrc));
    const M = surface(main), F = surface(side);
    let dirty = true, img: HTMLCanvasElement | null = null, T = 0, bins = 0;
    const off = audio.on(() => (dirty = true));
    const scroll = document.createElement("canvas");
    scroll.width = 600; scroll.height = 160;
    const sg = scroll.getContext("2d")!;
    sg.fillStyle = "#f9f2e5"; sg.fillRect(0, 0, 600, 160);
    const fd = new Float32Array(2048);
    const stop = loop(() => {
      const nM = mode === "mel128" ? 128 : 80;
      if (dirty) {
        dirty = false;
        const x = audio.mono(16000);
        if (mode === "linear") {
          const s = cached(`lin:${audio.clip.id}`, () => {
            const m = magnitudes(stft(x, 16000, 512, 160, 400));
            let mx = 1e-9; for (const f of m) for (const v of f) mx = Math.max(mx, v);
            return m.map((f) => f.map((v) => 1 + (20 * Math.log10(Math.max(v / mx, 1e-9))) / 80));
          });
          img = heatmap(s, 257); T = s.length; bins = 257;
        } else {
          const lm = nM === 80 ? mel16(audio) : cached(`mel128:${audio.clip.id}`, () => whisperLogMel(audio.mono(16000), 128));
          img = heatmap(melDisplay(lm.frames), nM * 2); T = lm.frames.length; bins = nM;
        }
      }
      const { g, w, h } = M;
      g.clearRect(0, 0, w, h);
      const x0 = 40, y0 = 34, ww = w - 52, hh = h - 52;
      const isLive = live && audio.live && audio.analyser;
      if (isLive) {
        audio.freqData(fd);
        const sr = audio.sampleRate, nb = fd.length;
        sg.drawImage(scroll, -2, 0);
        for (let y = 0; y < 160; y++) {
          const frac = (159 - y) / 159;
          const hz = mode === "linear" ? frac * 8000 : melToHz(frac * hzToMel(8000));
          const b = Math.min(nb - 1, Math.round((hz / (sr / 2)) * nb));
          const v = Math.max(0, Math.min(1, (fd[b] + 100) / 75));
          const ci = Math.round(v * 255) * 3;
          sg.fillStyle = `rgb(${RAMP[ci]},${RAMP[ci + 1]},${RAMP[ci + 2]})`;
          sg.fillRect(598, y, 2, 1);
        }
        drawImage(g, scroll, x0, y0, ww, hh);
        label(g, "LIVE", w - 14, 18, { align: "right", size: 11, color: PALETTE.red, weight: 700 });
      } else if (img) {
        drawImage(g, img, x0, y0, ww, hh);
        const p = audio.position();
        if (p >= 0 && audio.playing === "clip") { const px = x0 + (p / audio.duration) * ww; g.fillStyle = PALETTE.orange; g.fillRect(px - 1, y0, 2, hh); }
        label(g, `${T} frames × ${bins} ${mode === "linear" ? "bins" : "mel bands"}`, w - 14, 18, { align: "right", size: 11, mono: true, color: PALETTE.muted, weight: 400 });
      }
      // y-axis
      const ticks = [0, 250, 500, 1000, 2000, 4000, 8000];
      for (const t of ticks) {
        const frac = mode === "linear" ? t / 8000 : hzToMel(t) / hzToMel(8000);
        const py = y0 + hh - frac * hh;
        label(g, t >= 1000 ? `${t / 1000}k` : String(t), x0 - 5, py + 3, { align: "right", size: 9.5, mono: true, color: PALETTE.faint, weight: 400 });
        g.fillStyle = PALETTE.line; g.fillRect(x0 - 3, py, 3, 1);
      }
      label(g, isLive ? "time →" : `0 – ${audio.duration.toFixed(1)} s →`, x0, h - 6, { size: 10.5, color: PALETTE.faint, weight: 500 });
      // filterbank
      {
        const { g, w: W, h: H } = F;
        g.clearRect(0, 0, W, H);
        const bank = melBank(16000, 512, nM, 0, 8000);
        const fy0 = 40, fh = H - 58;
        const yOf = (hz: number) => fy0 + fh - (mode === "linear" ? hz / 8000 : hzToMel(hz) / hzToMel(8000)) * fh;
        // every 4th band, so each triangle stays readable; the rest sit between them
        const every = mode === "mel128" ? 6 : 4;
        for (let m = 0; m < nM; m += every) {
          const lo = bank.edges[m], c = bank.edges[m + 1], hi = bank.edges[m + 2];
          g.beginPath(); g.moveTo(8, yOf(lo)); g.lineTo(W - 10, yOf(c)); g.lineTo(8, yOf(hi)); g.closePath();
          g.fillStyle = (m / every) % 2 ? "#1aa3a133" : "#24304a22"; g.fill();
          g.strokeStyle = (m / every) % 2 ? PALETTE.teal : PALETTE.navy2; g.lineWidth = 1.2; g.stroke();
        }
        label(g, `1 of every ${every}`, W - 10, fy0 - 6 + 0, { align: "right", size: 9.5, color: PALETTE.faint, weight: 500 });
        label(g, "narrow ↓", W / 2, H - 22, { align: "center", size: 10, color: PALETTE.faint, weight: 600 });
        label(g, "wide ↑", W / 2, H - 8, { align: "center", size: 10, color: PALETTE.faint, weight: 600 });
        const top = bank.edges[nM + 1] - bank.edges[nM - 1];
        sBand.set(fmtHz(top / 2));
      }
      sShape.set(isLive ? "streaming" : `${bins} × ${T}`);
      sSrc.set(isLive ? (audio.micOn ? "mic" : "playback") : audio.clip.name);
    });
    return () => { stop(); off(); M.dispose(); F.dispose(); };
  },
  run(ctx) {
    const lm = mel16(ctx.audio);
    const fr = lm.frames;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const f of fr) for (const v of f) { mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
    ctx.log(`audio  ${ctx.audio.mono(16000).length} samples @ 16 kHz`);
    ctx.log(`logmel shape (80, ${fr.length})   ${(fr.length / ctx.audio.duration).toFixed(1)} frames/s`);
    ctx.log(`range  [${mn.toFixed(3)}, ${mx.toFixed(3)}]  mean ${(sum / (fr.length * 80)).toFixed(3)}`);
    const energy = new Float32Array(80);
    for (const f of fr) for (let m = 0; m < 80; m++) energy[m] += f[m];
    const top = [...energy.keys()].sort((a, b) => energy[b] - energy[a]).slice(0, 3);
    const bank = melBank(16000, 512, 80, 0, 8000);
    ctx.log(`loudest bands: ${top.map((m) => `#${m} (${fmtHz(bank.edges[m + 1])})`).join(", ")}`);
    ctx.log("This 80 × T matrix is all a Whisper-style encoder ever sees of your sound.", "ok");
  },
};

// ---------------------------------------------------------------- 7 · where sound gets lost

const STEPS: { key: keyof ChainOpts; name: string; note: string }[] = [
  { key: "mono", name: "Stereo → mono", note: "average the ears" },
  { key: "sr16", name: "48 → 16 kHz", note: "drop everything above 8 kHz" },
  { key: "phase", name: "Drop phase", note: "keep |STFT| only" },
  { key: "mel", name: "80 mel bands", note: "blur frequency" },
  { key: "pool", name: "80 ms frames", note: "blur time (12.5 Hz)" },
];

export const lost: Lesson = {
  id: "lost",
  title: "Where sound gets lost",
  chapter: "Represent",
  blurb: "Stack the losses up and listen. Each switch is a step real speech pipelines take, run on your clip and turned back into audio so you can hear what's left.",
  rail: [1, 2, 3, 4],
  rate: { value: "2.30 M → 256 k", note: "bits in, far less sound" },
  tabs: {
    overview: `
      <p class="lead">So far, each stage looked like a reasonable engineering choice. Stacked together, they remove a lot.</p>
      <p>Turn the switches on one at a time and press <b>Hear what's kept</b>. The bottom spectrogram shows what survives, and the empty hatched area is gone. Each step is applied to your clip, then the result is <b>rebuilt into sound</b> (phase is guessed with Griffin-Lim) so you can hear it.</p>
      <p>Try <b>Ping-pong</b> with only <i>Stereo → mono</i>: the motion disappears. Try <b>Birdsong</b> with <i>48 → 16 kHz</i>: half the song is gone. Try <b>Drum loop</b> with <i>80 ms frames</i>: the attacks go soft.</p>
      <p>A speech pipeline applies all of these by default, because speech <i>mostly</i> survives them.</p>`,
    hood: `
      <p>A model doesn't need to turn its input back into sound. But a representation that can't be turned back into the original has thrown information away, and listening to the reconstruction is a quick way to hear what's missing.</p>
      <p><b>Griffin-Lim</b> (1984) guesses phase by going back and forth between the time and frequency domains, keeping the known magnitudes each time. The "phasey", metallic sound you hear is its guess being wrong. Neural vocoders (HiFi-GAN, Vocos) make much better guesses, but they're still guessing.</p>
      <p>The bars on the right show the data rate at each stage. Notice that the bit rate drops much less than the sound does: a float32 log-mel frame takes 2,560 bits, but those bits describe a blurred picture.</p>`,
    lost: `
      <ul>
        <li class="lostline"><b>Mono:</b> direction, width, the room's left/right reflections.</li>
        <li class="lostline"><b>16 kHz:</b> sibilance, breath, cymbals, birds, air. Everything above 8 kHz.</li>
        <li class="lostline"><b>Phase:</b> sharpness of transients, the waveform's exact shape, inter-channel timing.</li>
        <li class="lostline"><b>Mel:</b> fine pitch above ~1 kHz, harmonic detail, close musical intervals.</li>
        <li class="lostline"><b>80 ms frames:</b> rhythm detail, attacks, flams, fast trills.</li>
      </ul>
      <p>What's left: roughly what was said, how loud, and the rough shape of the voice. That's what speech recognition needs, and about all it keeps.</p>`,
    specs: [
      ["Reconstruction", "Griffin-Lim, 16–28 iters"],
      ["STFT (48 k / 16 k)", "2048 / 512, hop ¼"],
      ["Mel step", "80 bands to Nyquist, inverted"],
      ["Pooling", "mean log-mel over 80 ms"],
      ["Mimi frame", "80 ms (12.5 Hz)"],
    ],
  },
  code: `import numpy as np, librosa

y = librosa.to_mono(stereo)                      # 1. mono
y = librosa.resample(y, orig_sr=48000, target_sr=16000)  # 2.
S = np.abs(librosa.stft(y, n_fft=512, hop_length=128))   # 3. no phase
M = librosa.feature.melspectrogram(S=S**2, sr=16000, n_mels=80)  # 4.

S_hat = librosa.feature.inverse.mel_to_stft(M, sr=16000, n_fft=512)
y_hat = librosa.griffinlim(S_hat, hop_length=128)  # guess the phase
sf.write("what_the_model_keeps.wav", y_hat, 16000)`,
  mount(ctx) {
    const { root, audio } = ctx;
    const opts: ChainOpts = { mono: true, sr16: true, phase: false, mel: false, pool: false };
    const row = el("div", { class: "viz-row", style: "flex:1" });
    const col = el("div", { class: "viz-col", style: "flex:3" });
    const pa = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Original"));
    const pb = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "What the model keeps"));
    col.append(pa, pb);
    const pl = el("div", { class: "panel", style: "flex:1.2;min-width:190px" }, el("span", { class: "panel-title" }, "Data rate ladder"));
    row.append(col, pl);
    root.append(row);
    const toggles = STEPS.map((s) => toggle(s.name, opts[s.key], (v) => { opts[s.key] = v; stale(); }, s.note));
    const hear = button("▶ Hear what's kept", () => void apply(true), "btn primary");
    root.append(controls(...toggles), controls(hear, button("▶ Original", () => audio.playClip(), "btn"), el("span", { class: "legend", id: "lost-status" }, "")));
    const A = surface(pa), B = surface(pb), L = surface(pl);
    let before: HTMLCanvasElement | null = null, after: HTMLCanvasElement | null = null, afterKey = "", busy = false;
    const status = root.querySelector<HTMLElement>("#lost-status")!;
    const key = () => `${audio.clip.id}|${STEPS.map((s) => +opts[s.key]).join("")}`;
    const stale = () => { status.textContent = key() === afterKey ? "" : "switches changed · press Hear to recompute"; };
    let result: { channels: Float32Array[]; sr: number } | null = null;
    async function apply(play: boolean) {
      if (busy) return;
      const k = key();
      if (k !== afterKey || !result) {
        busy = true;
        status.textContent = "computing…";
        await nextFrame();
        const t0 = performance.now();
        result = lossyChain(audio.clip, opts);
        after = specImage(result.channels[0], result.sr, 24000, 220);
        afterKey = k;
        busy = false;
        status.textContent = `rebuilt in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      }
      if (play && result) audio.playSignal(result.channels, result.sr);
    }
    const refreshBefore = () => { before = specImage(audio.clip.channels[0], audio.clip.sr, 24000, 220); void apply(false); };
    const off = audio.on(() => { if (!before || audio.clip.id !== afterKey.split("|")[0]) refreshBefore(); });
    refreshBefore();
    const stop = loop(() => {
      for (const [S, im, which] of [[A, before, "a"], [B, after, "b"]] as const) {
        const { g, w, h } = S;
        g.clearRect(0, 0, w, h);
        const x0 = 40, y0 = 34, ww = w - 50, hh = h - 42;
        if (im) drawImage(g, im, x0, y0, ww, hh);
        freqAxis(g, x0, y0, hh, 24000);
        if (which === "b" && opts.sr16 && afterKey) { const yy = y0 + hh - melFrac(8000, 24000) * hh; g.strokeStyle = PALETTE.red; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + ww, yy); g.stroke(); g.setLineDash([]); label(g, "8 kHz: nothing above", x0 + ww - 4, yy - 5, { align: "right", size: 11, color: PALETTE.red, weight: 700 }); }
        const p = audio.position();
        if (p >= 0 && audio.playing) { const px = x0 + (p / audio.duration) * ww; g.fillStyle = PALETTE.orange; g.fillRect(px - 1, y0, 2, hh); }
        const chans = which === "a" ? (audio.clip.channels[0] === audio.clip.channels[1] ? "mono" : "stereo") : opts.mono ? "mono" : "stereo";
        label(g, chans, w - 10, 16, { align: "right", size: 10.5, color: chans === "stereo" ? PALETTE.tealDeep : PALETTE.red, weight: 700 });
      }
      // ladder
      {
        const { g, w, h } = L;
        g.clearRect(0, 0, w, h);
        const rungs: [string, number, boolean][] = [
          ["48 k · 24-bit · stereo", 48000 * 24 * 2, false],
          ["48 k · 16-bit · mono", 48000 * 16, opts.mono],
          ["16 k · 16-bit · mono", 16000 * 16, opts.mono && opts.sr16],
          ["log-mel 80 × 100/s (f32)", 80 * 100 * 32, opts.mel],
          ["Whisper enc. 1280 × 50/s (f16)", 1280 * 50 * 16, false],
          ["Mimi tokens 8 × 12.5/s", 1100, false],
          ["HuBERT units 50/s", 50 * Math.log2(500), false],
          ["The transcript", 50, false],
        ];
        const y0 = 30, rh = Math.min(30, (h - y0 - 8) / rungs.length);
        const lo = Math.log10(30), hi = Math.log10(2.5e6);
        rungs.forEach(([name, bps, on], i) => {
          const y = y0 + i * rh;
          const bw = ((Math.log10(bps) - lo) / (hi - lo)) * (w - 20);
          roundRect(g, 10, y + 12, Math.max(4, bw), rh - 16, 3);
          g.fillStyle = on ? PALETTE.red : i >= 5 ? PALETTE.tealSoft : PALETTE.trace; g.fill();
          label(g, name, 10, y + 10, { size: 10.5, color: PALETTE.ink, weight: 600 });
          label(g, fmtBits(bps), w - 10, y + 10, { align: "right", size: 10, mono: true, color: PALETTE.navy, weight: 400 });
        });
      }
    });
    return () => { stop(); off(); A.dispose(); B.dispose(); L.dispose(); };
  },
  async run(ctx) {
    const a = ctx.audio;
    const c = a.clip;
    const L = c.channels[0], R = c.channels[1];
    let mid = 0, side = 0;
    for (let i = 0; i < L.length; i++) { mid += ((L[i] + R[i]) / 2) ** 2; side += ((L[i] - R[i]) / 2) ** 2; }
    ctx.log(`stereo side energy  ${((100 * side) / (mid + side || 1)).toFixed(1)} %  (lost by mono)`, side > mid * 0.05 ? "warn" : "info");
    const x = a.mono(c.sr);
    const spec = magnitudes(stft(x, c.sr, 2048, 1024));
    let tot = 0, hiE = 0;
    const cut = Math.floor((8000 / (c.sr / 2)) * 1024);
    for (const f of spec) for (let k = 0; k < f.length; k++) { const e = f[k] * f[k]; tot += e; if (k >= cut) hiE += e; }
    ctx.log(`energy above 8 kHz   ${((100 * hiE) / (tot || 1)).toFixed(1)} %  (lost by 16 kHz)`, hiE > tot * 0.05 ? "warn" : "info");
    ctx.log(`raw bits             ${fmtBits(c.sr * 24 * 2)}  →  log-mel ${fmtBits(80 * 100 * 32)}`);
    ctx.log("computing the full speech front end + Griffin-Lim…", "dim");
    await nextFrame();
    const out = lossyChain(c, { mono: true, sr16: true, phase: true, mel: true, pool: false });
    ctx.log(`rebuilt: ${out.channels[0].length} samples @ ${out.sr} Hz. Playing it now.`, "ok");
    a.playSignal(out.channels, out.sr);
  },
};
