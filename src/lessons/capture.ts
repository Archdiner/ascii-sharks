import type { Lesson } from "../types";
import { el, surface, loop, PALETTE, label, roundRect, wave, slider, segmented, toggle, button, controls, fmtHz, fmtBits } from "../ui/dom";
import { resample, quantize, rms, db, mixMono } from "../dsp/signal";
import { magSpectrum, hann } from "../dsp/fft";
import { rng } from "../dsp/rand";

export function stat(name: string, cls = "") {
  const b = el("b", {}, "—");
  const s = el("div", { class: `stat ${cls}` }, el("small", {}, name), b);
  return Object.assign(s, { set: (v: string) => { b.textContent = v; } });
}

const C = 343; // speed of sound in air, m/s at 20 °C

// ---------------------------------------------------------------- 1 · sound

export const sound: Lesson = {
  id: "sound",
  title: "Sound is pressure",
  chapter: "Capture",
  blurb: "Before any computer is involved, sound is air pushing on air. Molecules bunch up and spread out, and the pattern travels at 343 m/s.",
  rail: [0],
  rate: { value: "analog", note: "continuous in time and level" },
  tabs: {
    overview: `
      <p class="lead">A sound is a travelling ripple in air pressure.</p>
      <p>A vibrating thing (a vocal fold, a string, a speaker cone) shoves the air next to it. That air shoves the next air, and a pattern of <b>compressions</b> (slightly higher pressure) and <b>rarefactions</b> (slightly lower) moves outward. The molecules themselves just jiggle in place.</p>
      <p>Two numbers describe a pure tone: <b>frequency</b>, how many compressions pass per second (pitch), and <b>amplitude</b>, how big the pressure swing is (loudness).</p>
      <p>Press <b>Play tone</b> and drag the sliders. Then turn on the <b>Mic</b> and talk: the dots become a real 42 ms snapshot of the air in your room.</p>`,
    hood: `
      <p>The swings are tiny. Normal speech is about <b>60 dB SPL</b>, a pressure swing of only <b>0.02 pascals</b> on top of an atmosphere of 101,325 Pa: about one part in five million.</p>
      <p>Wavelength is speed divided by frequency: <code>λ = 343 / f</code>. A 100 Hz hum is 3.4 m long; a 10 kHz hiss is 3.4 cm. That's why low sounds bend around corners and high sounds get blocked by your head (and why you can tell which side a sound came from).</p>
      <p>Real sounds are many frequencies at once. A voice has a fundamental around 85–255 Hz plus dozens of harmonics; their relative strengths are what makes an "ah" sound different from an "ee".</p>`,
    lost: `
      <p>Nothing has been lost yet. Air carries the whole thing: every frequency, in three dimensions, with the room's echoes arriving from every direction.</p>
      <p class="lostline"><b>Space is lost first.</b> In the next step, a microphone measures pressure at a single point. The direction a sound came from and the shape of the room only survive as faint echoes in that one signal. Two ears (or many mics) are needed to keep any of it.</p>`,
    specs: [
      ["Speed of sound", "343 m/s (20 °C air)"],
      ["Human hearing", "≈ 20 Hz – 20 kHz"],
      ["Speech energy", "≈ 100 Hz – 8 kHz"],
      ["0 dB SPL", "20 µPa (threshold)"],
      ["Conversation", "≈ 60 dB SPL · 0.02 Pa"],
      ["Pain", "≈ 130 dB SPL · 63 Pa"],
    ],
  },
  code: `import numpy as np

c   = 343.0                 # m/s
f   = 440.0                 # Hz  (concert A)
spl = 70                    # dB SPL

wavelength = c / f                        # metres
pressure   = 20e-6 * 10 ** (spl / 20)     # pascals

t = np.linspace(0, 0.01, 480)             # 10 ms
p = pressure * np.sin(2 * np.pi * f * t)  # the wave
print(wavelength, pressure)`,
  mount(ctx) {
    const { root, audio } = ctx;
    let f = 220, spl = 70;
    const panel = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Air molecules · a slice of the room"));
    root.append(panel);
    const s = surface(panel);
    const sWave = stat("Wavelength"), sPeriod = stat("Period"), sPa = stat("Pressure swing"), sMode = stat("Showing");
    const playBtn = button("▶ Play tone", () => {
      if (audio.playing === "tone") audio.stop();
      else audio.playTone(f, ampOf(spl));
    }, "btn primary");
    const ampOf = (d: number) => Math.min(0.5, 0.5 * 10 ** ((d - 90) / 20));
    const fS = slider({ label: "Frequency", min: Math.log(40), max: Math.log(4000), step: 0.001, value: Math.log(f), fmt: (v) => fmtHz(Math.exp(v)), onInput: (v) => { f = Math.exp(v); audio.setTone(f, ampOf(spl)); } });
    const aS = slider({ label: "Loudness", min: 30, max: 100, value: spl, fmt: (v) => `${v} dB SPL`, onInput: (v) => { spl = v; audio.setTone(f, ampOf(spl)); } });
    root.append(controls(playBtn, fS, aS), el("div", { class: "stat-row" }, sWave, sPeriod, sPa, sMode));
    const off = audio.on(() => { playBtn.textContent = audio.playing === "tone" ? "■ Stop tone" : "▶ Play tone"; });

    const td = new Float32Array(2048);
    const rand = rng(3);
    const N = 900;
    const base = Array.from({ length: N }, () => [rand(), rand()]);
    let phase = 0;
    const stop = loop((_t, dt) => {
      const { g, w, h } = s;
      g.clearRect(0, 0, w, h);
      const live = audio.live && audio.playing !== "tone";
      if (live) audio.timeData(td);
      const fieldH = h * 0.62, top = 30;
      // the field shows 4 wavelengths of the tone, slowed down so the eye can follow
      const lambda = C / f;
      const span = live ? (td.length / audio.sampleRate) * C : lambda * 4;
      phase += dt * 0.8;
      const disp = (xFrac: number) => {
        if (live) return td[Math.floor((1 - xFrac) * (td.length - 1))] * 4;
        const amp = Math.min(1, 10 ** ((spl - 100) / 40));
        return amp * Math.sin(2 * Math.PI * (xFrac * (span / lambda) - phase));
      };
      for (const [bx, by] of base) {
        const d = disp(bx);
        const px = 12 + bx * (w - 24) - d * Math.min(18, (w / (span / lambda)) * 0.08) * (live ? 1 : 1);
        const py = top + by * (fieldH - 10);
        g.fillStyle = PALETTE.navy2;
        g.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.min(1, 0.5 + d * 0.5));
        g.beginPath(); g.arc(px, py, 1.9, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      // speaker cone on the left
      g.fillStyle = PALETTE.navy;
      roundRect(g, 0, top + fieldH * 0.3, 7, fieldH * 0.4, 2); g.fill();
      // pressure trace
      const py = top + fieldH + 14, ph = h - py - 22;
      g.strokeStyle = PALETTE.lineSoft; g.lineWidth = 1;
      g.beginPath(); g.moveTo(12, py + ph / 2); g.lineTo(w - 12, py + ph / 2); g.stroke();
      const pts = Array.from({ length: 400 }, (_, i) => disp(i / 399));
      wave(g, pts, 12, py, w - 24, ph, PALETTE.teal, 2, 0, pts.length, 0.9);
      label(g, "PRESSURE", 12, py - 2, { size: 10.5, color: PALETTE.faint, weight: 700 });
      label(g, "+", w - 14, py + 10, { align: "right", color: PALETTE.faint });
      label(g, "−", w - 14, py + ph, { align: "right", color: PALETTE.faint });
      const spanTxt = span >= 1 ? `${span.toFixed(1)} m` : `${(span * 100).toFixed(0)} cm`;
      label(g, `← ${spanTxt} of air →`, w / 2, h - 6, { align: "center", size: 11.5, color: PALETTE.muted, weight: 500 });
      if (!live) label(g, "slowed down ≈ " + Math.round(f / 0.8).toLocaleString() + "×", w - 12, 20, { align: "right", size: 11, color: PALETTE.faint, weight: 500 });
      sWave.set(lambda >= 1 ? `${lambda.toFixed(2)} m` : `${(lambda * 100).toFixed(1)} cm`);
      sPeriod.set(`${(1000 / f).toFixed(2)} ms`);
      sPa.set(`${(20e-6 * 10 ** (spl / 20)).toPrecision(2)} Pa`);
      sMode.set(live ? (audio.micOn ? "your mic, live" : "the clip, live") : "pure tone");
    });
    return () => { stop(); off(); s.dispose(); };
  },
  run(ctx) {
    for (const f of [100, 440, 1000, 4000, 10000]) {
      ctx.log(`f = ${String(f).padStart(5)} Hz   λ = ${(C / f).toFixed(3).padStart(6)} m   T = ${(1000 / f).toFixed(3)} ms`);
    }
    for (const spl of [0, 40, 60, 70, 94, 120]) ctx.log(`${String(spl).padStart(3)} dB SPL  →  ${(20e-6 * 10 ** (spl / 20)).toExponential(2)} Pa`, "dim");
    ctx.log("94 dB SPL = 1 Pa is the standard level used to calibrate microphones.", "ok");
  },
};

// ---------------------------------------------------------------- 2 · microphone

type MicKind = "condenser" | "dynamic" | "mems";

export const microphone: Lesson = {
  id: "microphone",
  title: "The microphone",
  chapter: "Capture",
  blurb: "A thin membrane moves with the air, and that motion becomes a voltage. The phone in your pocket does this with a chip about a millimetre across.",
  rail: [1],
  rate: { value: "analog", note: "a voltage, ≈ millivolts" },
  tabs: {
    overview: `
      <p class="lead">A microphone turns motion into voltage.</p>
      <p>Every mic has a <b>diaphragm</b>, a membrane light enough for air pressure to push around. The type of mic depends on how that motion becomes electricity:</p>
      <ul>
        <li><b>Condenser</b>: the diaphragm is one plate of a capacitor. When the gap changes, the voltage changes.</li>
        <li><b>Dynamic</b>: the diaphragm drags a coil of wire through a magnet, which induces a current (a speaker running backwards).</li>
        <li><b>MEMS</b>: a condenser etched in silicon with its own amplifier on the chip. This is what's in phones, laptops and smart speakers.</li>
      </ul>
      <p>Turn on the <b>Mic</b> and watch the diaphragm and the voltage follow your voice.</p>`,
    hood: `
      <p>A MEMS mic is a silicon die with a membrane about 0.5 mm across and a few microns from a perforated backplate. Sound comes in through a hole in the package.</p>
      <p>Many MEMS mics are <b>digital</b>: there is an ADC inside the package that outputs a 1-bit <b>PDM</b> stream at around 3 MHz. The phone's codec chip filters and decimates that down to 48 kHz PCM, so in practice the microphone and the ADC (next lesson) are the same part.</p>
      <p>Phones and smart speakers use <b>arrays</b> of 2–7 of these. Time differences between mics let a beamformer steer toward your voice and away from the TV, before any model sees the audio.</p>`,
    lost: `
      <ul>
        <li class="lostline"><b>Direction:</b> one diaphragm measures pressure at one point. A single-channel model gets no spatial information.</li>
        <li class="lostline"><b>Extremes:</b> the diaphragm has mass, so it can't follow very high frequencies, and small capsules roll off the deep lows.</li>
        <li class="lostline"><b>Self-noise:</b> the electronics hiss at around 30 dB SPL (cheap MEMS) or below 10 dB (studio condensers). Anything quieter is gone.</li>
        <li class="lostline"><b>Clipping:</b> past the mic's acoustic overload point (≈120–135 dB SPL), the waveform flattens.</li>
      </ul>
      <p>Before the model, phones also apply <b>echo cancellation, noise suppression and auto-gain</b>. This site turns those off for your mic, because they remove sound on purpose.</p>`,
    specs: [
      ["MEMS diaphragm", "≈ 0.5 mm across"],
      ["Sensitivity", "≈ −38 dBV / Pa (analog MEMS)"],
      ["Self-noise", "≈ 29–35 dBA (MEMS)"],
      ["Overload", "≈ 120–135 dB SPL"],
      ["Digital MEMS out", "PDM, 1-bit, ≈ 1–3 MHz"],
      ["Your browser", "getUserMedia(), AGC/NS/AEC off"],
    ],
  },
  code: `import sounddevice as sd, numpy as np

sr = 48000
x = sd.rec(int(1.0 * sr), samplerate=sr, channels=1)
sd.wait()

rms  = np.sqrt(np.mean(x ** 2))
peak = np.max(np.abs(x))
print("level", 20 * np.log10(rms),  "dBFS")
print("peak ", 20 * np.log10(peak), "dBFS")
print("crest", 20 * np.log10(peak / rms), "dB")`,
  mount(ctx) {
    const { root, audio } = ctx;
    let kind: MicKind = "mems";
    const row = el("div", { class: "viz-row" });
    const left = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "Inside the capsule"));
    const right = el("div", { class: "panel" }, el("span", { class: "panel-title" }, "Output voltage"));
    row.append(left, right);
    const sLvl = stat("Level"), sPeak = stat("Peak"), sSrc = stat("Source");
    root.append(row, controls(segmented<MicKind>("Type", [["mems", "MEMS"], ["condenser", "Condenser"], ["dynamic", "Dynamic"]], kind, (v) => (kind = v)),
      button("● Use my mic", async () => { try { await audio.startMic(); } catch { ctx.log("Mic unavailable.", "warn"); } }, "btn"),
      button("▶ Play clip", () => audio.playClip(), "btn")), el("div", { class: "stat-row" }, sLvl, sPeak, sSrc));
    const a = surface(left), b = surface(right);
    const td = new Float32Array(2048);
    const hist: number[] = [];
    const stop = loop((t) => {
      const live = audio.live;
      if (live) audio.timeData(td); else for (let i = 0; i < td.length; i++) td[i] = 0.25 * Math.sin(i * 0.05 + t * 8) * (0.6 + 0.4 * Math.sin(t * 1.3));
      const r = rms(td);
      let pk = 0; for (const v of td) pk = Math.max(pk, Math.abs(v));
      const now = td[td.length - 1];
      // capsule
      {
        const { g, w, h } = a;
        g.clearRect(0, 0, w, h);
        const cx = w * 0.55, cy = h * 0.55, H = Math.min(h * 0.62, w * 0.7);
        const bend = Math.max(-1, Math.min(1, now * 3)) * H * 0.1;
        for (let k = 0; k < 5; k++) {
          const rr = 20 + k * 22 + ((t * 40) % 22);
          g.strokeStyle = PALETTE.faint; g.globalAlpha = Math.max(0, 1 - rr / 130); g.lineWidth = 1.5;
          g.beginPath(); g.arc(cx - H * 0.55 - 30, cy, rr, -0.5, 0.5); g.stroke();
        }
        g.globalAlpha = 1;
        const dia = (col: string, lw: number, x0: number) => {
          g.strokeStyle = col; g.lineWidth = lw;
          g.beginPath(); g.moveTo(x0, cy - H / 2); g.quadraticCurveTo(x0 + bend * 2, cy, x0, cy + H / 2); g.stroke();
        };
        if (kind === "dynamic") {
          g.fillStyle = PALETTE.trace; roundRect(g, cx + 20, cy - H * 0.22, H * 0.45, H * 0.44, 6); g.fill();
          g.fillStyle = PALETTE.navy2; roundRect(g, cx + 30, cy - H * 0.1, H * 0.4, H * 0.2, 3); g.fill();
          label(g, "MAGNET", cx + 30 + H * 0.2, cy + H * 0.35, { align: "center", size: 10.5, color: PALETTE.muted, weight: 700 });
          g.strokeStyle = PALETTE.orange; g.lineWidth = 3;
          for (let k = 0; k < 6; k++) { const x = cx + 8 + bend + k * 4; g.beginPath(); g.moveTo(x, cy - H * 0.16); g.lineTo(x, cy + H * 0.16); g.stroke(); }
          label(g, "COIL", cx + 18 + bend, cy - H * 0.2, { align: "center", size: 10.5, color: PALETTE.rust, weight: 700 });
          dia(PALETTE.teal, 3, cx - 10);
        } else {
          const gap = kind === "mems" ? H * 0.12 : H * 0.18;
          g.fillStyle = PALETTE.navy2;
          for (let k = 0; k < 14; k++) { const y = cy - H / 2 + (k * H) / 14; if (k % 2 === 0) g.fillRect(cx + gap, y, 8, H / 14 - 2); }
          label(g, "BACKPLATE", cx + gap + 14, cy - H / 2 - 6, { size: 10.5, color: PALETTE.muted, weight: 700 });
          dia(PALETTE.teal, 2.5, cx);
          label(g, "DIAPHRAGM", cx, cy + H / 2 + 16, { align: "center", size: 10.5, color: PALETTE.tealDeep, weight: 700 });
          g.strokeStyle = PALETTE.orange; g.setLineDash([3, 3]); g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(cx + bend, cy); g.lineTo(cx + gap, cy); g.stroke(); g.setLineDash([]);
          label(g, "gap → capacitance", cx + gap / 2, cy - 6, { align: "center", size: 10, color: PALETTE.rust, weight: 600 });
          if (kind === "mems") {
            g.strokeStyle = PALETTE.line; g.lineWidth = 1.5;
            roundRect(g, cx - H * 0.45, cy - H * 0.62, H * 1.05, H * 1.24, 8); g.stroke();
            g.fillStyle = PALETTE.navy; roundRect(g, cx + H * 0.3, cy + H * 0.2, H * 0.22, H * 0.28, 3); g.fill();
            label(g, "ASIC + ADC", cx + H * 0.41, cy + H * 0.56, { align: "center", size: 10, color: PALETTE.navy, weight: 700 });
            label(g, "silicon die ≈ 1 mm", cx + H * 0.08, cy - H * 0.66, { align: "center", size: 10.5, color: PALETTE.faint, weight: 600 });
          }
        }
      }
      // scope
      {
        const { g, w, h } = b;
        g.clearRect(0, 0, w, h);
        hist.push(r); if (hist.length > 300) hist.shift();
        const top = 28, sh = (h - top) * 0.6;
        g.strokeStyle = PALETTE.lineSoft; g.lineWidth = 1;
        for (let k = 0; k <= 4; k++) { const y = top + (k * sh) / 4; g.beginPath(); g.moveTo(10, y); g.lineTo(w - 10, y); g.stroke(); }
        wave(g, td, 10, top, w - 20, sh, PALETTE.navy, 1.6, td.length - 1024, td.length, 1.6);
        label(g, `${((1024 / audio.sampleRate) * 1000).toFixed(0)} ms`, w - 12, top + sh + 14, { align: "right", size: 10.5, mono: true, color: PALETTE.faint, weight: 400 });
        const my = top + sh + 26, mh = h - my - 8;
        label(g, "LEVEL OVER TIME", 10, my + 2, { size: 10.5, color: PALETTE.faint, weight: 700 });
        g.fillStyle = PALETTE.teal;
        hist.forEach((v, i) => {
          const d = Math.max(0, (db(v) + 70) / 70);
          g.fillRect(10 + (i / 300) * (w - 20), my + mh - d * (mh - 8), (w - 20) / 300 + 0.5, d * (mh - 8));
        });
      }
      sLvl.set(`${db(r).toFixed(1)} dBFS`);
      sPeak.set(`${db(pk).toFixed(1)} dBFS`);
      sSrc.set(audio.micOn ? "your mic" : audio.playing ? "clip" : "idle demo");
    });
    return () => { stop(); a.dispose(); b.dispose(); };
  },
  async run(ctx) {
    const a = ctx.audio;
    if (!a.live) { ctx.log("Nothing live. Playing the clip so there's something to measure…", "dim"); a.playClip(); }
    ctx.log("measuring 1.0 s …");
    const buf = new Float32Array(2048);
    let sum = 0, n = 0, peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      a.timeData(buf);
      for (const v of buf) { sum += v * v; n++; peak = Math.max(peak, Math.abs(v)); }
      await new Promise((r) => setTimeout(r, 40));
    }
    const r = Math.sqrt(sum / n);
    ctx.log(`level  ${db(r).toFixed(1)} dBFS`);
    ctx.log(`peak   ${db(peak).toFixed(1)} dBFS`);
    ctx.log(`crest  ${(db(peak) - db(r)).toFixed(1)} dB   (speech ≈ 12–20, a sine ≈ 3)`);
    ctx.log("dBFS = decibels below the loudest number the ADC can write. 0 dBFS is clipping.", "ok");
  },
};

// ---------------------------------------------------------------- 3 · sampling

export const sampling: Lesson = {
  id: "sampling",
  title: "Sampling: time becomes a grid",
  chapter: "Capture",
  blurb: "The ADC measures the voltage at evenly spaced instants. Sample often enough and nothing is lost. Not often enough, and high pitches turn into wrong ones.",
  rail: [2],
  rate: { value: "2.30 Mb/s", note: "48 kHz × 24 bit × 2 ch" },
  tabs: {
    overview: `
      <p class="lead">An <b>analog-to-digital converter</b> (ADC) reads the mic voltage thousands of times a second.</p>
      <p>The number of readings per second is the <b>sample rate</b>. The <b>Nyquist–Shannon theorem</b> says a sample rate of <code>fs</code> captures every frequency below <code>fs / 2</code> (the <b>Nyquist frequency</b>) perfectly. The original wave can be rebuilt exactly from the dots.</p>
      <p>A frequency above Nyquist doesn't disappear. It <b>aliases</b>: the samples trace out a lower frequency that was never there. Drag the signal frequency past the red line and watch the dashed teal reconstruction fold back down.</p>
      <p>Pick the <b>Sweep</b> sound, set the rate to 8 kHz, turn the filter <b>off</b> and press <b>Hear it</b>. The sweep goes up, then comes back down.</p>`,
    hood: `
      <p>Real ADCs put an <b>anti-aliasing filter</b> in front, a low-pass that removes everything above Nyquist before sampling. With it, high sounds just disappear. Without it, they come back as wrong pitches. Toggle it to hear the difference.</p>
      <p>The folding rule: a tone at <code>f</code> sampled at <code>fs</code> shows up at <code>|f − fs·round(f/fs)|</code>.</p>
      <p>Common rates: <b>8 kHz</b> (telephone), <b>16 kHz</b> (almost every speech model: Whisper, wav2vec 2.0, HuBERT), <b>24 kHz</b> (Mimi, EnCodec, many TTS models), <b>44.1 kHz</b> (CD), <b>48 kHz</b> (video, browsers, phones).</p>`,
    lost: `
      <p class="lostline"><b>Everything above fs/2.</b> At 48 kHz that is above 24 kHz, which you can't hear anyway. But speech models usually <b>resample to 16 kHz</b>, which throws away everything above 8 kHz: the "s" and "sh" sibilance, cymbals, birdsong, the air and sparkle in a recording.</p>
      <p>Pick <b>Birdsong</b>, set 16 kHz with the filter on, and hear what a speech model is given.</p>`,
    specs: [
      ["Nyquist", "fs / 2"],
      ["Telephone", "8 kHz → 4 kHz band"],
      ["Speech models", "16 kHz → 8 kHz band"],
      ["Mimi / EnCodec", "24 kHz → 12 kHz band"],
      ["CD", "44.1 kHz → 22.05 kHz"],
      ["Browser default", "48 kHz"],
    ],
  },
  code: `import numpy as np
from scipy.signal import resample_poly

fs_in, fs = 48000, 16000
f = 11000                         # above the new Nyquist (8 kHz)

alias = abs(f - fs * round(f / fs))
print("heard as", alias, "Hz")    # 5000 Hz

y_bad  = x[::3]                          # no filter: aliases
y_good = resample_poly(x, 1, 3)          # low-pass first`,
  mount(ctx) {
    const { root, audio } = ctx;
    let f = 3000, fs = 16000, aa = true;
    const top = el("div", { class: "panel", style: "flex:1.5" }, el("span", { class: "panel-title" }, "2 ms of signal · dots are samples"));
    const bot = el("div", { class: "panel", style: "flex:1" }, el("span", { class: "panel-title" }, "Frequency line · where the tone lands"));
    root.append(top, bot);
    const fS = slider({ label: "Signal", min: 200, max: 30000, step: 50, value: f, fmt: fmtHz, onInput: (v) => (f = v) });
    const sS = slider({ label: "Sample rate", min: 4000, max: 48000, step: 1000, value: fs, fmt: fmtHz, onInput: (v) => (fs = v) });
    const sAlias = stat("Heard as"), sNyq = stat("Nyquist"), sRate = stat("Data rate");
    root.append(controls(fS, sS, toggle("Anti-alias filter", aa, (v) => (aa = v), "Low-pass before sampling")),
      controls(button("▶ Hear it", () => {
        const x = mixMono(audio.clip.channels);
        const y = resample(x, audio.clip.sr, fs, aa);
        audio.playSignal([y], fs);
        ctx.log(`Playing "${audio.clip.name}" sampled at ${fmtHz(fs)}, filter ${aa ? "on" : "off"}.`, "dim");
      }, "btn primary"), button("▶ Original", () => audio.playClip(), "btn"), el("div", { class: "stat-row" }, sAlias, sNyq, sRate)));
    const A = surface(top), B = surface(bot);
    const stop = loop(() => {
      const nyq = fs / 2;
      const k = Math.round(f / fs);
      const fa = Math.abs(f - k * fs);
      const sign = f - k * fs >= 0 ? 1 : -1;
      const filtered = aa && f > nyq;
      {
        const { g, w, h } = A;
        g.clearRect(0, 0, w, h);
        const T = 0.002, x0 = 14, ww = w - 28, mid = 24 + (h - 24) / 2, amp = (h - 50) / 2;
        g.strokeStyle = PALETTE.lineSoft; g.beginPath(); g.moveTo(x0, mid); g.lineTo(x0 + ww, mid); g.stroke();
        // continuous
        g.strokeStyle = filtered ? PALETTE.lineSoft : PALETTE.trace; g.lineWidth = 1.6; g.beginPath();
        const steps = Math.max(800, Math.ceil(ww * 2));
        for (let i = 0; i <= steps; i++) { const t = (i / steps) * T; const y = mid - Math.sin(2 * Math.PI * f * t) * amp; i ? g.lineTo(x0 + (i / steps) * ww, y) : g.moveTo(x0, y); }
        g.stroke();
        // reconstruction (what the samples imply)
        if (!filtered) {
          g.strokeStyle = f > nyq ? PALETTE.teal : PALETTE.tealDeep; g.lineWidth = 2.2; g.setLineDash(f > nyq ? [6, 4] : []);
          g.beginPath();
          for (let i = 0; i <= 600; i++) { const t = (i / 600) * T; const y = mid - sign * Math.sin(2 * Math.PI * fa * t) * amp; i ? g.lineTo(x0 + (i / 600) * ww, y) : g.moveTo(x0, y); }
          g.stroke(); g.setLineDash([]);
        }
        // samples
        const n = Math.floor(T * fs);
        for (let i = 0; i <= n; i++) {
          const t = i / fs, px = x0 + (t / T) * ww;
          const v = filtered ? 0 : Math.sin(2 * Math.PI * f * t);
          const py = mid - v * amp;
          g.strokeStyle = PALETTE.line; g.lineWidth = 1; g.beginPath(); g.moveTo(px, mid); g.lineTo(px, py); g.stroke();
          g.fillStyle = PALETTE.navy; g.beginPath(); g.arc(px, py, n > 60 ? 2.2 : 3.2, 0, 7); g.fill();
        }
        if (filtered) label(g, "the filter removed this tone before sampling: nothing left to record", w / 2, mid - 12, { align: "center", size: 13, color: PALETTE.red, weight: 600 });
        else if (f > nyq) label(g, `aliased: the dots trace ${fmtHz(fa)}, not ${fmtHz(f)}`, w - 14, 22, { align: "right", size: 12.5, color: PALETTE.red, weight: 700 });
      }
      {
        const { g, w, h } = B;
        g.clearRect(0, 0, w, h);
        const x0 = 18, ww = w - 36, y = h * 0.62, maxF = 32000;
        const X = (hz: number) => x0 + (hz / maxF) * ww;
        g.fillStyle = "#fbefe6"; g.fillRect(X(nyq), 24, ww - (X(nyq) - x0), y - 24);
        g.strokeStyle = PALETTE.navy; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + ww, y); g.stroke();
        for (let hz = 0; hz <= maxF; hz += 4000) { g.fillStyle = PALETTE.faint; g.fillRect(X(hz), y, 1, 5); label(g, `${hz / 1000}k`, X(hz), y + 17, { align: "center", size: 10, mono: true, weight: 400, color: PALETTE.faint }); }
        g.strokeStyle = PALETTE.red; g.lineWidth = 2; g.beginPath(); g.moveTo(X(nyq), 24); g.lineTo(X(nyq), y); g.stroke();
        label(g, `Nyquist ${fmtHz(nyq)}`, X(nyq) + 5, 36, { size: 11.5, color: PALETTE.red, weight: 700 });
        g.fillStyle = PALETTE.trace; g.beginPath(); g.arc(X(f), y - 12, 6, 0, 7); g.fill();
        label(g, "real", X(f), y - 22, { align: "center", size: 10.5, color: PALETTE.muted });
        if (!filtered) {
          g.fillStyle = f > nyq ? PALETTE.teal : PALETTE.tealDeep; g.beginPath(); g.arc(X(fa), y - 12, 6, 0, 7); g.fill();
          if (f > nyq) {
            g.strokeStyle = PALETTE.teal; g.lineWidth = 1.5; g.setLineDash([4, 3]);
            g.beginPath(); g.moveTo(X(f), y - 12); g.quadraticCurveTo((X(f) + X(fa)) / 2, y - 70, X(fa), y - 12); g.stroke(); g.setLineDash([]);
            label(g, "folds to", (X(f) + X(fa)) / 2, y - 48, { align: "center", size: 11, color: PALETTE.tealDeep, weight: 700 });
          }
        }
      }
      sAlias.set(filtered ? "silence" : fmtHz(fa));
      sNyq.set(fmtHz(nyq));
      sRate.set(fmtBits(fs * 24));
    });
    return () => { stop(); A.dispose(); B.dispose(); };
  },
  run(ctx) {
    const a = ctx.audio;
    const x = mixMono(a.clip.channels);
    const sr = a.clip.sr;
    const n = 4096, win = hann(n);
    const acc = new Float32Array(n / 2 + 1);
    for (let i = 0; i + n <= x.length; i += n / 2) { const m = magSpectrum(x.subarray(i, i + n), n, win); for (let k = 0; k < m.length; k++) acc[k] += m[k] * m[k]; }
    const total = acc.reduce((s, v) => s + v, 0) || 1;
    ctx.log(`"${a.clip.name}" at ${sr} Hz: share of energy above each Nyquist`);
    for (const fs of [8000, 16000, 24000, 44100]) {
      const from = Math.floor(((fs / 2) / sr) * n);
      let e = 0; for (let k = from; k < acc.length; k++) e += acc[k];
      const pct = (100 * e) / total;
      ctx.log(`  fs ${String(fs).padStart(5)} Hz → lose ${pct.toFixed(pct < 1 ? 2 : 1).padStart(5)} %  above ${fs / 2} Hz`, pct > 5 ? "warn" : "info");
    }
    ctx.log("Try Birdsong or Rain, then the Vowels. Speech survives 16 kHz; birds don't.", "ok");
  },
};

// ---------------------------------------------------------------- 4 · quantization

export const quantization: Lesson = {
  id: "quantization",
  title: "Quantization: level becomes a number",
  chapter: "Capture",
  blurb: "Each sample has to be stored as one of a fixed set of levels. Bits decide how many levels there are, and rounding to them adds noise.",
  rail: [2],
  rate: { value: "256 kb/s", note: "16 kHz × 16 bit × mono" },
  tabs: {
    overview: `
      <p class="lead">Sampling makes time discrete; quantization makes <b>level</b> discrete.</p>
      <p>With <code>N</code> bits, each sample gets one of <code>2ᴺ</code> levels: 8 bits gives 256 levels, 16 bits gives 65,536, 24 bits gives 16.7 million. The true value is rounded to the nearest level, and the difference is <b>quantization error</b>.</p>
      <p>Each extra bit adds about <b>6 dB</b> of signal-to-noise ratio: <code>SNR ≈ 6.02·N + 1.76 dB</code>. Drag the bits slider down and listen. At 8 bits you hear hiss, at 4 a gritty buzz, at 2 or 1 only the rhythm survives.</p>`,
    hood: `
      <p>Below about 6 bits, the error stops sounding like hiss and starts following the signal, which sounds like distortion. <b>Dither</b> fixes that: add a tiny bit of random noise <i>before</i> rounding, and the error becomes plain, signal-independent hiss again. Toggle it at 3–4 bits to hear it.</p>
      <p>Models don't use integers. The 16-bit integers are converted to <b>float32</b> in <code>[-1, 1)</code> by dividing by 32768, and every later stage does floating-point arithmetic.</p>
      <p>Telephone networks use 8-bit <b>μ-law</b>, which spaces levels logarithmically so quiet sounds get finer steps. WaveNet (2016) generated audio as a 256-way classification over μ-law levels, one of the first "audio tokens".</p>`,
    lost: `
      <p class="lostline"><b>Detail below the noise floor.</b> At 16 bits the noise floor is about 96 dB below full scale, quieter than any room. That loss is real but inaudible.</p>
      <p>The bigger losses come before and after this step. <b>Clipping</b> loses the peaks of anything louder than full scale, and the analog gain stage decides whether you clip or bury quiet sounds in noise.</p>
      <p>At this point the sound is a list of numbers. From here on, losses come from choices about how to represent it.</p>`,
    specs: [
      ["8-bit", "256 levels · ≈ 50 dB SNR"],
      ["16-bit (CD, models)", "65,536 levels · ≈ 98 dB"],
      ["24-bit (studio)", "16.7 M levels · ≈ 146 dB"],
      ["μ-law (telephony)", "8-bit, logarithmic"],
      ["float32 in models", "x / 32768 → [-1, 1)"],
    ],
  },
  code: `import numpy as np

def quantize(x, bits, dither=False):
    step = 2.0 / 2 ** bits
    if dither:                      # TPDF dither, 1 LSB
        x = x + (np.random.rand(*x.shape)
                 - np.random.rand(*x.shape)) * step
    idx = np.clip(np.floor((x + 1) / step), 0, 2 ** bits - 1)
    return -1 + (idx + 0.5) * step     # mid-rise levels

for bits in [2, 4, 8, 12, 16]:
    e = x - quantize(x, bits)
    snr = 10 * np.log10(np.sum(x**2) / np.sum(e**2))
    print(bits, "bits ->", round(snr, 1), "dB")`,
  mount(ctx) {
    const { root, audio } = ctx;
    let bits = 4, dither = false;
    const top = el("div", { class: "panel", style: "flex:1.6" }, el("span", { class: "panel-title" }, "6 ms of the clip · staircase = stored values"));
    const bot = el("div", { class: "panel", style: "flex:0.8" }, el("span", { class: "panel-title" }, "Error (true − stored) · magnified"));
    root.append(top, bot);
    const sLv = stat("Levels"), sSnr = stat("SNR (theory)"), sMeas = stat("SNR (this clip)"), sRate = stat("Mono @ 16 kHz");
    const bS = slider({ label: "Bits", min: 1, max: 16, value: bits, fmt: (v) => `${v} bit`, onInput: (v) => (bits = v) });
    root.append(controls(bS, toggle("Dither", dither, (v) => (dither = v)),
      button("▶ Hear it", () => {
        const x = audio.mono(audio.clip.sr);
        audio.playSignal([dq(x, bits, dither)], audio.clip.sr);
      }, "btn primary"), button("▶ Original", () => audio.playClip(), "btn")),
      el("div", { class: "stat-row" }, sLv, sSnr, sMeas, sRate));
    const A = surface(top), B = surface(bot);
    // zoom into the loudest 6 ms of the clip
    let x = audio.mono(audio.clip.sr), sr = audio.clip.sr, start = loudest(x, Math.floor(0.006 * sr));
    const off = audio.on(() => { x = audio.mono(audio.clip.sr); sr = audio.clip.sr; start = loudest(x, Math.floor(0.006 * sr)); });
    let lastKey = "", meas = 0;
    const stop = loop(() => {
      const n = Math.floor(0.006 * sr);
      const seg = x.subarray(start, start + n);
      const q = dq(seg, bits, dither, 1);
      const key = `${bits}|${dither}|${start}|${x.length}`;
      if (key !== lastKey) { lastKey = key; const full = dq(x, bits, dither, 1); let se = 0, ss = 0; for (let i = 0; i < x.length; i++) { ss += x[i] ** 2; se += (x[i] - full[i]) ** 2; } meas = 10 * Math.log10(ss / Math.max(se, 1e-20)); }
      {
        const { g, w, h } = A;
        g.clearRect(0, 0, w, h);
        const x0 = 14, ww = w - 28, y0 = 26, hh = h - 36;
        const levels = 2 ** bits;
        if (levels <= 64) {
          g.strokeStyle = PALETTE.lineSoft; g.lineWidth = 1;
          for (let l = 0; l <= levels; l++) { const y = y0 + (l / levels) * hh; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + ww, y); g.stroke(); }
        }
        wave(g, seg, x0, y0, ww, hh, PALETTE.trace, 2.2);
        g.strokeStyle = PALETTE.navy; g.lineWidth = 1.8; g.beginPath();
        for (let i = 0; i < q.length; i++) {
          const px = x0 + (i / q.length) * ww, nx = x0 + ((i + 1) / q.length) * ww, py = y0 + hh / 2 - q[i] * (hh / 2);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
          g.lineTo(nx, py);
        }
        g.stroke();
        label(g, `${levels.toLocaleString()} levels`, w - 14, 18, { align: "right", size: 12, color: PALETTE.navy, weight: 700 });
      }
      {
        const { g, w, h } = B;
        g.clearRect(0, 0, w, h);
        const e = seg.map((v, i) => v - q[i]);
        const step = 2 / 2 ** bits;
        wave(g, e, 14, 22, w - 28, h - 30, PALETTE.red, 1.4, 0, e.length, 1 / step);
        label(g, `±½ step = ±${(step / 2).toPrecision(2)}`, w - 14, 16, { align: "right", size: 11, mono: true, color: PALETTE.red, weight: 400 });
      }
      sLv.set((2 ** bits).toLocaleString());
      sSnr.set(`${(6.02 * bits + 1.76).toFixed(1)} dB`);
      sMeas.set(`${meas.toFixed(1)} dB`);
      sRate.set(fmtBits(16000 * bits));
    });
    return () => { stop(); off(); A.dispose(); B.dispose(); };
  },
  run(ctx) {
    const x = ctx.audio.mono(ctx.audio.clip.sr);
    let ss = 0; for (const v of x) ss += v * v;
    ctx.log(`"${ctx.audio.clip.name}", ${x.length.toLocaleString()} samples`);
    for (const b of [1, 2, 4, 8, 12, 16, 24]) {
      const q = quantize(x, b);
      let se = 0; for (let i = 0; i < x.length; i++) se += (x[i] - q[i]) ** 2;
      const snr = 10 * Math.log10(ss / Math.max(se, 1e-20));
      ctx.log(`${String(b).padStart(2)} bits → ${snr.toFixed(1).padStart(6)} dB   (theory ${(6.02 * b + 1.76).toFixed(1)})`);
    }
    ctx.log("Measured SNR falls short of theory when the clip doesn't use full scale: quiet signals waste the top bits.", "ok");
  },
};

function dq(x: Float32Array, bits: number, dither: boolean, seed = 1) {
  if (!dither) return quantize(x, bits);
  const r = rng(seed), step = 2 / 2 ** bits;
  return quantize(x.map((v) => v + (r() - r()) * step), bits);
}

function loudest(x: Float32Array, n: number) {
  let best = 0, bv = -1;
  for (let i = 0; i + n < x.length; i += Math.floor(n / 2)) { const r = rms(x, i, i + n); if (r > bv) { bv = r; best = i; } }
  return best;
}
